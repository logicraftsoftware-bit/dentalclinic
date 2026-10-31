import test from 'node:test';
import assert from 'node:assert/strict';
import { recordCheckoutPayment } from '../server/patient-payments';

test('split checkout saves separate method receipts and cumulative invoice balances', async () => {
  const receipts: any[] = [], updates: any[] = [];
  const ctx = { tenant: { id: 'tenant' }, store: {}, tx: {
    payment: { createMany: async ({ data }: any) => receipts.push(...data) },
    invoice: { update: async ({ data }: any) => updates.push(data) },
    clinicAudit: { createMany: async () => {} },
  } };
  const invoices = [{ id: 'invoice', totalPaise: 500000, paidPaise: 0, status: 'UNPAID' }];
  const payment = { amountPaise: 500000, splits: [{ amountPaise: 300000, method: 'CASH', reference: '' }, { amountPaise: 200000, method: 'CARD', reference: 'terminal' }] };
  const result = await recordCheckoutPayment(ctx, invoices, payment, 'checkout', { userId: 'user' });
  assert.deepEqual(receipts.map(p => [p.method, p.amountPaise]), [['CASH', 300000], ['CARD', 200000]]);
  assert.equal(new Set(receipts.map(p => p.idempotencyKey)).size, 2);
  assert.equal(result[0].paidPaise, 500000);
  assert.equal(result[0].status, 'PAID');
  await assert.rejects(recordCheckoutPayment(ctx, invoices, { ...payment, amountPaise: 400000 }, 'bad', {}), /must equal/);
  assert.equal(receipts.length, 2);
});

test('legacy sessions do not generate commission for lab or clinic receipts', async () => {
  const commissions: any[] = [];
  const ctx = { tenant: { id: 'tenant' }, store: { list: async () => [{ id: 'session', doctorId: 'doctor' }] }, tx: {
    doctor: { findMany: async () => [{ id: 'doctor', commissionPercent: 40 }] },
    payment: { createMany: async () => {} }, invoice: { update: async () => {} },
    commission: { createMany: async ({ data }: any) => commissions.push(...data) }, clinicAudit: { createMany: async () => {} },
  } };
  const invoices = [
    { id: 'procedure', description: 'Crown', chargeKind: 'PROCEDURE', totalPaise: 100000 },
    { id: 'lab', description: 'Lab: Crown', chargeKind: 'LAB', totalPaise: 20000 },
    { id: 'clinic', description: 'Clinic fee', chargeKind: 'VISIT', totalPaise: 30000 },
  ].map(i => ({ ...i, sessionId: 'session', paidPaise: 0, status: 'UNPAID' }));
  await recordCheckoutPayment(ctx, invoices, { amountPaise: 150000, method: 'CASH' }, 'checkout', {});
  assert.equal(commissions.length, 1);
  assert.equal(commissions[0].amountPaise, 40000);
});
