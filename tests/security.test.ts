import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  permission,
  operational,
  checkLimit,
  periodEnd,
  verifyWebhook,
  TenantStore,
} from '../server/core.js';
test('clinical and platform privileges are distinct; unknown roles deny by default', () => {
  assert.equal(permission('PLATFORM_ADMIN', 'clinical'), false);
  assert.equal(permission('ACCOUNTANT', 'clinical'), false);
  assert.equal(permission('RECEPTIONIST', 'billing'), true);
  assert.equal(permission('DOCTOR', 'clinical'), true);
  assert.equal(permission('DOCTOR', 'settings'), false);
});
test('trial expiry, paid grace and suspension are enforced at request time', () => {
  const now = new Date('2026-10-13T12:00:00Z');
  const sub = {
    status: 'TRIAL',
    endsAt: new Date('2026-10-12T12:00:00Z'),
    cancelAtPeriodEnd: false,
    plan: { graceDays: 3 },
  };
  assert.equal(operational({ status: 'ACTIVE' }, sub, now), false);
  assert.equal(operational({ status: 'ACTIVE' }, { ...sub, status: 'ACTIVE' }, now), true);
  assert.equal(operational({ status: 'SUSPENDED' }, { ...sub, status: 'ACTIVE' }, now), false);
  assert.equal(
    operational({ status: 'ACTIVE' }, { ...sub, status: 'ACTIVE', cancelAtPeriodEnd: true }, now),
    false,
  );
  assert.equal(operational({ status: 'ACTIVE' }, { ...sub, status: 'CANCELLED' }, now), false);
});
test('nullable limits remain unlimited and finite limits reject overflow', () => {
  checkLimit(null, 1000000);
  checkLimit(undefined, 1000000);
  checkLimit(2, 1);
  assert.throws(() => checkLimit(2, 2));
});
test('calendar periods clamp month ends without drifting into another month', () => {
  assert.equal(
    periodEnd(new Date('2026-01-31T12:00:00Z'), 'MONTHLY').toISOString(),
    '2026-02-28T12:00:00.000Z',
  );
  assert.equal(
    periodEnd(new Date('2024-02-29T12:00:00Z'), 'ANNUAL').toISOString(),
    '2025-02-28T12:00:00.000Z',
  );
});
test('webhook authentication binds the exact raw bytes', () => {
  const raw = Buffer.from('{"amount":99}');
  const secret = 'test-secret';
  const signature = createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(verifyWebhook(raw, signature, secret), true);
  assert.equal(verifyWebhook(Buffer.from('{ "amount":99}'), signature, secret), false);
  assert.equal(verifyWebhook(raw, 'a', secret), false);
  assert.equal(verifyWebhook(raw, signature, 'wrong'), false);
});
test('repository scope overrides malicious query and create tenant IDs', async () => {
  const calls: any[] = [];
  const tx: any = {
    patient: {
      findMany: async (q: any) => {
        calls.push(q);
        return [];
      },
      create: async (q: any) => {
        calls.push(q);
        return q.data;
      },
    },
  };
  const store = new TenantStore(tx, 'authorized-tenant');
  await store.list(
    'patient',
    { tenantId: 'victim-tenant' },
    { where: { tenantId: 'victim-tenant' } },
  );
  await store.create('patient', { tenantId: 'victim-tenant', name: 'Name' });
  assert.equal(calls[0].where.tenantId, 'authorized-tenant');
  assert.equal(calls[1].data.tenantId, 'authorized-tenant');
});

test('database diagnostics classify failures without exposing credentials or queries', async () => {
  const { databaseDiagnostic } = await import('../server/database-diagnostic.js');
  const error = { code: 'P2010', meta: { code: 18, message: 'Authentication failed for mongodb+srv://secret-user:secret-password@private.example/db' } };
  const diagnostic = databaseDiagnostic(error);
  assert.equal(diagnostic.reason, 'DATABASE_AUTH_FAILED');
  assert.equal(diagnostic.databaseCode, '18');
  assert(!JSON.stringify(diagnostic).includes('secret'));
  assert.equal(databaseDiagnostic({ message: 'Server selection timed out' }).reason, 'DATABASE_CONNECTION_FAILED');
});
