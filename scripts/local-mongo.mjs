import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { mkdir, unlink, access } from 'node:fs/promises';
import path from 'node:path';
const stopFile = path.resolve('.tools/mongo-stop');
await unlink(stopFile).catch(() => {});
const dbPath = path.resolve('.local-mongo');
await mkdir(dbPath, { recursive: true });
const mongo = await MongoMemoryReplSet.create({ binary: { version: '8.0.17' }, instanceOpts: [{ port: 27019, dbPath }], replSet: { count: 1, name: 'rs0', storageEngine: 'wiredTiger' } });
console.log('Local MongoDB replica set ready at mongodb://127.0.0.1:27019/dentalclinic?replicaSet=rs0');
const stop = async () => { await mongo.stop({ doCleanup: false }); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);

const timer = setInterval(async () => { try { await access(stopFile); clearInterval(timer); await unlink(stopFile); await stop(); } catch {} }, 500);
