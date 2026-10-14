import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
if (process.env.NODE_ENV === 'production')
  throw new Error('Local restore verification must not run in production.');
const native = process.env.PG_BIN || (process.platform === 'win32' ? '.tools/pg-bin' : undefined);
if (!native) throw new Error('Set PG_BIN to your PostgreSQL binary directory.');
const ext = process.platform === 'win32' ? '.exe' : '';
const database = `restore_test_${randomUUID().replaceAll('-', '')}`;
const source = new URL(
  process.env.RESTORE_TEST_SOURCE_URL ||
    'postgresql://dentaflow:local-development-only@localhost:54329/dentaflow_utf8',
);
const sourceDatabase = decodeURIComponent(source.pathname.slice(1));
function databaseURL(name) {
  const url = new URL(source);
  url.pathname = `/${name}`;
  return url.toString();
}
const cliEnvironment = {
  ...process.env,
  PGHOST: source.hostname,
  PGPORT: source.port || '5432',
  PGUSER: decodeURIComponent(source.username),
  PGPASSWORD: decodeURIComponent(source.password),
};
const owner = new pg.Client({ connectionString: source.toString() });
await owner.connect();
const role = (
  await owner.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')
).rows[0];
if (!role.rolsuper && !role.rolbypassrls)
  throw new Error(
    'Full backup verification requires a privileged backup identity, not the application role.',
  );
await owner.query(
  `CREATE DATABASE "${database}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
);
await owner.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
const models = (
  await owner.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
).rows.map((row) => row.tablename);
const counts = [];
for (const model of models)
  counts.push({
    model,
    count: (
      await owner.query(`SELECT count(*)::int AS count FROM "${model.replaceAll('"', '""')}"`)
    ).rows[0].count,
  });
const finances = (
  await owner.query(
    'SELECT COALESCE(sum("totalPaise"),0)::text AS total,COALESCE(sum("paidPaise"),0)::text AS paid FROM "Invoice"',
  )
).rows[0];
const snapshot = (await owner.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
fs.mkdirSync('.tools/restore-tests', { recursive: true });
const dump = path.resolve('.tools/restore-tests', `${database}.dump`);
execFileSync(
  path.join(native, 'pg_dump' + ext),
  [
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--snapshot',
    snapshot,
    '--file',
    dump,
    sourceDatabase,
  ],
  { stdio: 'pipe', env: cliEnvironment },
);
await owner.query('COMMIT');
execFileSync(
  path.join(native, 'pg_restore' + ext),
  ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', database, dump],
  { stdio: 'pipe', env: cliEnvironment },
);
const restored = new pg.Client({ connectionString: databaseURL(database) });
await restored.connect();
for (const { model, count } of counts) {
  const actual = (
    await restored.query(`SELECT count(*)::int AS count FROM "${model.replaceAll('"', '""')}"`)
  ).rows[0].count;
  if (actual !== count) throw new Error(`${model} restore count mismatch.`);
}
const actual = (
  await restored.query(
    'SELECT COALESCE(sum("totalPaise"),0)::text AS total,COALESCE(sum("paidPaise"),0)::text AS paid FROM "Invoice"',
  )
).rows[0];
if (actual.total !== finances.total || actual.paid !== finances.paid)
  throw new Error('Restored financial totals do not match.');
const policies = await restored.query(
  `SELECT count(*)::int AS count FROM pg_policies WHERE policyname='tenant_isolation'`,
);
if (policies.rows[0].count !== 20) throw new Error('RLS policies did not restore.');
const forced = await restored.query(
  "SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity",
);
if (forced.rows[0].count !== 20) throw new Error('Restored RLS enforcement flags do not match.');
for (const d of (await restored.query('SELECT "storageKey",bytes FROM "Document"')).rows) {
  const localPath = path.resolve('storage', d.storageKey);
  if (!fs.existsSync(localPath) || fs.statSync(localPath).size !== d.bytes)
    throw new Error('Document metadata/file size mismatch.');
}
console.log(
  `Restore verified: ${models.length} table counts, invoice totals, 20 RLS policies and document file sizes. Isolated restore database retained: ${database}`,
);
await restored.end();
await owner.end();
