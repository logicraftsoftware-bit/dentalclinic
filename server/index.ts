import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { sharedRateLimit } from './rate-limit.js';
import { runJobs } from './jobs.js';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { ZodError } from 'zod';
import { ApiError, db, log, prod } from './core.js';
import { auth } from './auth.js';
import { clinicApi } from './clinic.js';
import { platformApi, billingApi, processWebhook } from './platform.js';

export const app = express();
app.disable('x-powered-by');
// Set a trusted proxy count only for your own reverse proxy, never accept arbitrary forwarded hosts.
if (prod) app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
        connectSrc: ["'self'", 'https://api.razorpay.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: prod ? [] : null,
      },
    },
  }),
);
app.use(
  '/api',
  sharedRateLimit('api', 60000, 300),
);
app.post(
  '/api/webhooks/razorpay',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res, next) =>
    processWebhook(
      req.body,
      req.get('x-razorpay-signature') || '',
      req.get('x-razorpay-event-id') || '',
    )
      .then((result) => res.json(result))
      .catch(next),
);
app.get('/api/cron/jobs', async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.get('authorization') || '');
  const expected = Buffer.from('Bearer ' + (secret || ''));
  if (!secret || secret.length < 32 || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.status(401).json({ error: 'Unauthorized cron request.' }); return; }
  try { res.json(await runJobs()); } catch (error) { next(error); }
});
app.use(express.json({ limit: '1mb' }), cookieParser());
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin');
    const expected = new URL(process.env.APP_URL || 'http://localhost:5173');
    const allowed =
      origin &&
      (() => {
        try {
          const u = new URL(origin);
          const base = process.env.BASE_DOMAIN || 'localhost';
          return (
            origin === expected.origin ||
            (!prod &&
              ['localhost', '127.0.0.1'].includes(u.hostname) &&
              ['localhost', '127.0.0.1'].includes(expected.hostname) &&
              u.protocol === expected.protocol &&
              u.port === expected.port) ||
            (u.protocol === expected.protocol &&
              u.port === expected.port &&
              u.hostname.endsWith(`.${base}`))
          );
        } catch {
          return false;
        }
      })();
    if (!allowed) {
      res.status(403).json({ error: 'Request origin is not authorized.' });
      return;
    }
  }
  next();
});
app.get('/api/health', async (_req, res) => {
  try {
    await db.$runCommandRaw({ ping: 1 });
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.get('/api/public/plans', (_req, res, next) =>
  db.plan
    .findMany({ where: { available: true }, orderBy: { monthlyPaise: 'asc' } })
    .then((rows) => res.json(rows))
    .catch(next),
);
app.get('/api/public/settings', (_req, res, next) =>
  db.platformSettings
    .findUnique({ where: { id: 'platform' } })
    .then((s) => res.json(s?.data || {}))
    .catch(next),
);
app.use(
  '/api/auth',
  sharedRateLimit('auth', 15 * 60000, 40),
  auth,
);
app.use('/api/clinic', clinicApi);
app.use('/api/platform', platformApi);
app.use('/api/subscription', billingApi);
app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
if (prod && !process.env.VERCEL) {
  app.use(
    '/assets',
    express.static(path.resolve('dist/assets'), { maxAge: '1y', immutable: true }),
  );
  app.use(express.static(path.resolve('dist')));
  app.get('*', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
}
app.use((error: any, _req: any, res: any, _next: any) => {
  if (res.headersSent) return _next(error);
  if (error.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Request body must contain valid JSON.' });
    return;
  }
  if (error.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.' });
    return;
  }
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    return;
  }
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error.code === 'P2002') {
    res.status(409).json({ error: 'A record already exists with those details.' });
    return;
  }
  if (['P2003', 'P2025'].includes(error.code)) {
    res.status(404).json({ error: 'Related record not found in your clinic.' });
    return;
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Document must be 3 MB or smaller.' });
    return;
  }
  log.error({ code: error.code, name: error.name }, 'Request failed');
  res.status(500).json({ error: 'The request could not be completed.' });
});
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  const server = app.listen(
    Number(process.env.PORT || 4000),
    process.env.HOST || (prod ? '0.0.0.0' : '127.0.0.1'),
    () => log.info({ port: process.env.PORT || 4000 }, 'DentaFlow API listening'),
  );
  const stop = () => server.close(() => db.$disconnect().then(() => process.exit(0)));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
