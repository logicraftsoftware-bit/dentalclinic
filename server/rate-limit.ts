import type { RequestHandler } from 'express';
import { db, hash } from './core.js';
// Atomic increments share a counter across instances without raw database commands.
export function sharedRateLimit(scope: string, windowMs: number, limit: number): RequestHandler {
  return async (req, res, next) => {
    try {
      const slot = Math.floor(Date.now() / windowMs);
      const key = `${scope}:${hash(req.ip || req.socket.remoteAddress || 'unknown')}:${slot}`;
      let counter;
      try {
        counter = await db.rateBucket.upsert({
          where: { id: key },
          create: { id: key, count: 1, expiresAt: new Date((slot + 2) * windowMs) },
          update: { count: { increment: 1 } },
        });
      } catch (error: any) {
        // Concurrent first requests can both attempt creation; only the losing insert retries.
        if (error.code !== 'P2002') throw error;
        counter = await db.rateBucket.update({ where: { id: key }, data: { count: { increment: 1 } } });
      }
      if (counter.count > limit) {
        res.setHeader('Retry-After', Math.ceil(((slot + 1) * windowMs - Date.now()) / 1000));
        res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
        return;
      }
      next();
    } catch (error) { next(error); }
  };
}
