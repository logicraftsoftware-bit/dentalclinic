import type { RequestHandler } from 'express';
import { db, hash } from './core.js';
// One atomic counter shared by every function instance. Never store raw client IPs.
export function sharedRateLimit(scope: string, windowMs: number, limit: number): RequestHandler {
  return async (req, res, next) => {
    try {
      const slot = Math.floor(Date.now() / windowMs);
      const key = `${scope}:${hash(req.ip || req.socket.remoteAddress || 'unknown')}:${slot}`;
      const result: any = await db.$runCommandRaw({ findAndModify: 'RateBucket', query: { _id: key }, update: { $inc: { count: 1 }, $setOnInsert: { expiresAt: { $date: new Date((slot + 2) * windowMs).toISOString() } } }, upsert: true, new: true });
      const count = result.value?.count;
      if (typeof count !== 'number') throw new Error('Rate counter unavailable');
      if (count > limit) { res.setHeader('Retry-After', Math.ceil(((slot + 1) * windowMs - Date.now()) / 1000)); res.status(429).json({ error: 'Too many requests. Please try again shortly.' }); return; }
      next();
    } catch (error) { next(error); }
  };
}
