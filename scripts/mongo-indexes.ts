import { db } from '../server/core.js';
try {
  await db.$runCommandRaw({ createIndexes: 'RateBucket', indexes: [{ key: { expiresAt: 1 }, name: 'rate_expiry', expireAfterSeconds: 0 }] });
  console.log('MongoDB maintenance indexes configured.');
} finally { await db.$disconnect(); }
