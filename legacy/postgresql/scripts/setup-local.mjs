import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
const url = 'postgresql://dentaflow:local-development-only@localhost:54329/postgres';
const owner = new pg.Client({ connectionString: url });
await owner.connect();
try {
  await owner.query(
    `CREATE DATABASE dentaflow_utf8 ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
} catch (e) {
  if (e.code !== '42P04') throw e;
}
await owner.end();
const migrationURL =
  'postgresql://dentaflow:local-development-only@localhost:54329/dentaflow_utf8?schema=public';
execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: migrationURL },
});
const client = new pg.Client({ connectionString: migrationURL });
await client.connect();
// Isolated development credential only. Production uses your secret manager.
await client.query(
  `DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='dentaflow_runtime') THEN CREATE ROLE dentaflow_runtime LOGIN PASSWORD 'local-runtime-only' NOSUPERUSER NOBYPASSRLS; END IF; END $$;`,
);
await client.query(
  `GRANT CONNECT ON DATABASE dentaflow_utf8 TO dentaflow_runtime; GRANT USAGE ON SCHEMA public TO dentaflow_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO dentaflow_runtime; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO dentaflow_runtime; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO dentaflow_runtime;`,
);
await client.end();
let env = fs.existsSync('.env')
  ? fs.readFileSync('.env', 'utf8')
  : fs.readFileSync('.env.example', 'utf8');
env = env.replace(
  /^DATABASE_URL=.*$/m,
  'DATABASE_URL=postgresql://dentaflow_runtime:local-runtime-only@localhost:54329/dentaflow_utf8?schema=public',
);
fs.writeFileSync('.env', env);
console.log('Migrations applied. .env now uses a non-superuser RLS runtime role.');
