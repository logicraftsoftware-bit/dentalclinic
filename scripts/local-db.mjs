import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
const databaseDir = '.local-db';
const pg = new EmbeddedPostgres({
  databaseDir,
  user: 'dentaflow',
  password: 'local-development-only',
  port: 54329,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
if (!fs.existsSync(`${databaseDir}/PG_VERSION`)) await pg.initialise();
await pg.start();
const client = pg.getPgClient('postgres');
await client.connect();
try {
  await client.query(
    `CREATE DATABASE dentaflow_utf8 ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`,
  );
} catch (error) {
  if (error.code !== '42P04') throw error;
} finally {
  await client.end();
}
console.log('Local PostgreSQL ready on port 54329. Keep this terminal open.');
async function stop() {
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60000);
