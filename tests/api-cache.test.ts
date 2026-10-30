import test from 'node:test';
import assert from 'node:assert/strict';
import { api, clearApiReads, primeApiRead } from '../web/api.js';

test('API reads share requests, reuse results, and invalidate across mutations and failures', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let fail = false;
  globalThis.fetch = (async () => {
    calls++;
    return new Response(JSON.stringify(fail ? { error: 'Unavailable' } : { version: calls }), {
      status: fail ? 503 : 200, headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    clearApiReads();
    const [first, second] = await Promise.all([api('/clinic/patients'), api('/clinic/patients')]);
    assert.deepEqual(first, second);
    assert.equal(calls, 1);
    assert.deepEqual(await api('/clinic/patients'), first);
    assert.equal(calls, 1);
    await api('/clinic/patients', 'POST', { name: 'New patient' });
    await api('/clinic/patients');
    assert.equal(calls, 3);
    // Signing out or changing authentication is a mutation too: no previous clinic data survives.
    await api('/auth/logout', 'POST', {});
    await api('/clinic/patients');
    assert.equal(calls, 5);
    fail = true;
    await assert.rejects(api('/clinic/doctors'), /Unavailable/);
    fail = false;
    await api('/clinic/doctors');
    assert.equal(calls, 7);
    primeApiRead('/clinic/workspace', { tenant: { id: 'current-clinic' } });
    assert.deepEqual(await api('/clinic/workspace'), { tenant: { id: 'current-clinic' } });
    assert.equal(calls, 7);
    await api('/auth/logout', 'POST', {});
    await api('/clinic/workspace');
    assert.equal(calls, 9);
    globalThis.fetch = (async () => new Response('A server error has occurred', { status: 500, headers: { 'Content-Type': 'text/plain' } })) as typeof fetch;
    await assert.rejects(api('/auth/login', 'POST', {}), /server is temporarily unavailable/);
    globalThis.fetch = (async () => new Response('{"incomplete":', { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch;
    await assert.rejects(api('/auth/me'), /incomplete data/);
  } finally { globalThis.fetch = originalFetch; clearApiReads(); }
});
