import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.17' }, replSet: { count: 1, storageEngine: 'wiredTiger' } });
const env = { ...process.env, DATABASE_URL: mongo.getUri('dentaflow_test'), NODE_ENV: 'development', APP_URL: 'http://localhost:5173', BASE_DOMAIN: 'localhost', PLATFORM_ADMIN_PASSWORD: '', SEED_DEMO: 'false', SMTP_HOST: '', VERCEL: '', S3_BUCKET: '', STORAGE_PATH: '.tools/mongo-test-storage' };
function run(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code})`)));
  });
}
try {
  await run('node_modules/prisma/build/index.js', ['db', 'push']);
  await run('node_modules/tsx/dist/cli.mjs', ['scripts/mongo-indexes.ts']);
  await run('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts']);
  // Simulate an existing deployment that has not run db:push for the new masters yet.
  // This database was just created by this runner and is always an isolated localhost replica set.
  const { PrismaClient } = await import('@prisma/client');
  const setup = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
  try { for (const collection of ['Speciality', 'ChargeGroup', 'DentalEncounter', 'InternalReferral']) await setup.$runCommandRaw({ drop: collection }); }
  finally { await setup.$disconnect(); }
  await run('node_modules/tsx/dist/cli.mjs', ['--test', 'tests/security.test.ts', 'tests/time.test.ts', 'tests/routes.test.ts', 'tests/api-cache.test.ts', 'tests/calendar.test.ts']);
  await run('node_modules/tsx/dist/cli.mjs', ['--test', 'tests/integration.ts']);
  if (process.argv.includes('--browser')) await run('node_modules/@playwright/test/cli.js', ['test']);
} finally { await mongo.stop(); }
