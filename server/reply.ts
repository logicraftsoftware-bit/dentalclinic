import { z } from 'zod';
import { assert, hash, type TenantStore } from './core.js';
export class Reply {
  code = 200;
  headers: Record<string, string> = {};
  body: any = null;
  kind: 'json' | 'send' = 'json';
  status(code: number) {
    this.code = code;
    return this;
  }
  json(body: any) {
    this.body = body;
    this.kind = 'json';
    return this;
  }
  send(body: any) {
    this.body = body;
    this.kind = 'send';
    return this;
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
    return this;
  }
  flush(res: any) {
    const bytes = this.kind === 'json' ? Buffer.byteLength(JSON.stringify(this.body)) : Buffer.isBuffer(this.body) ? this.body.length : Buffer.byteLength(String(this.body));
    assert(!process.env.VERCEL || bytes <= 4 * 1024 * 1024, 413, 'Response is too large. Narrow your query or export a smaller date range.');
    for (const [key, value] of Object.entries(this.headers)) res.setHeader(key, value);
    res.status(this.code);
    res[this.kind](this.body);
  }
}
export async function transactionalReply(
  req: any,
  store: TenantStore,
  fn: (reply: Reply) => Promise<any>,
) {
  const reply = new Reply();
  const key = req.get('idempotency-key');
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  let fingerprint = '';
  if (key && mutation) {
    z.string()
      .min(16)
      .max(100)
      .regex(/^[a-zA-Z0-9:_-]+$/)
      .parse(key);
    fingerprint = hash(
      JSON.stringify({
        path: req.originalUrl,
        method: req.method,
        body: req.body,
        file: req.file ? hash(req.file.buffer) : null,
      }),
    );
    const previous = (await store.list('idempotencyRecord', { key }))[0];
    if (previous) {
      assert(
        previous.fingerprint === fingerprint,
        409,
        'Idempotency key reused for a different request.',
      );
      reply.code = previous.status;
      reply.body = previous.body;
      reply.headers = previous.headers;
      return reply;
    }
  }
  await fn(reply);
  if (key && mutation && reply.kind === 'json' && reply.code < 400)
    await store.create('idempotencyRecord', {
      key,
      fingerprint,
      status: reply.code,
      body: JSON.parse(JSON.stringify(reply.body)),
      headers: reply.headers,
    });
  return reply;
}
