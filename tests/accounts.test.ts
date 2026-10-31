import test from 'node:test';
import assert from 'node:assert/strict';
import { accountDateRange, accountsReport } from '../server/accounts-report.js';

const at = (day: string) => new Date(`${day}T12:00:00Z`);
function fixture() {
  return {
    doctors: [{ id: 'd1', name: 'Same name', commissionPercent: 90 }, { id: 'd2', name: 'Same name' }], patients: [{ id: 'p1', name: 'Patient' }], sessions: [{ id: 's1', doctorId: 'd1' }],
    invoices: [
      { id: 'i1', patientId: 'p1', sessionId: 's1', description: 'Filling', totalPaise: 9000, discountPaise: 1000, paidPaise: 5000, createdAt: at('2026-09-01') },
      { id: 'i2', patientId: 'p1', doctorId: 'd2', description: 'Lab: Filling', chargeKind: 'LAB', totalPaise: 2000, paidPaise: 2000, createdAt: at('2026-10-01') },
    ],
    payments: [{ id: 'r1', invoiceId: 'i1', amountPaise: 3000, method: 'CASH', createdAt: at('2026-09-02') }, { id: 'r2', invoiceId: 'i1', amountPaise: 2000, method: 'UPI', createdAt: at('2026-10-02') }, { id: 'r3', invoiceId: 'i2', amountPaise: 2000, method: 'CASH', createdAt: at('2026-10-02') }],
    commissions: [{ paymentId: 'r1', amountPaise: 1200, status: 'PAID' }, { paymentId: 'r2', amountPaise: 800, status: 'ACCRUED' }],
  };
}
test('accounts reconciles receipts, historical commissions, lab and clinic share without merging same-name doctors', () => {
  const report = accountsReport(fixture(), {}, 'Asia/Kolkata');
  assert.equal(report.totals.gross, 12000); assert.equal(report.totals.discount, 1000); assert.equal(report.totals.net, 11000);
  assert.equal(report.totals.collected, 7000); assert.equal(report.totals.commission, 2000); assert.equal(report.totals.clinic, 5000);
  assert.equal(report.totals.paidCommission, 1200); assert.equal(report.totals.dueCommission, 800); assert.equal(report.totals.outstanding, 4000);
  assert.equal(report.doctors.length, 2); assert.equal(report.procedures.length, 2);
});
test('period includes receipts for older invoices without counting their billing again', () => {
  const report = accountsReport(fixture(), { from: '2026-10-01', to: '2026-10-31' }, 'Asia/Kolkata');
  assert.equal(report.totals.net, 2000); assert.equal(report.totals.collected, 4000); assert.equal(report.totals.commission, 800); assert.equal(report.totals.clinic, 3200); assert.equal(report.totals.outstanding, 0);
});
test('doctor and procedure filters intersect and empty reports have zero totals', () => {
  const report = accountsReport(fixture(), { doctorId: 'd1', procedure: 'Filling' }, 'Asia/Kolkata');
  assert.equal(report.rows.length, 1); assert.equal(report.totals.collected, 5000);
  assert.equal(accountsReport(fixture(), { doctorId: 'd2', procedure: 'Filling' }, 'Asia/Kolkata').totals.collected, 0);
});
test('date boundaries use clinic timezone', () => {
  const data = fixture(); data.payments[1].createdAt = new Date('2026-10-01T19:00:00Z');
  const report = accountsReport(data, { from: '2026-10-02', to: '2026-10-02', doctorId: 'd1' }, 'Asia/Kolkata');
  assert.equal(report.totals.collected, 2000);
});

test('payment method totals reconcile with filtered collections', () => {
  for (const filters of [{}, { from: '2026-10-01', to: '2026-10-31' }, { doctorId: 'd1', procedure: 'Filling' }, { doctorId: 'missing' }]) {
    const report = accountsReport(fixture(), filters, 'Asia/Kolkata');
    assert.equal(report.paymentMethods.reduce((n, method) => n + method.amount, 0), report.totals.collected);
  }
  const report = accountsReport(fixture(), { from: '2026-10-01', doctorId: 'd1' }, 'Asia/Kolkata');
  assert.deepEqual(report.paymentMethods, [{ method: 'UPI', amount: 2000 }, { method: 'CARD', amount: 0 }, { method: 'CASH', amount: 0 }]);
  const data = fixture(); data.payments[0].method = 'BANK_TRANSFER';
  assert.equal(accountsReport(data, {}, 'Asia/Kolkata').paymentMethods.find(m => m.method === 'BANK_TRANSFER')?.amount, 3000);
});

test('date presets use clinic days, inclusive seven days and clamped calendar months', () => {
  const now = new Date('2026-10-23T20:00:00Z');
  const range = (period: string) => accountDateRange(period, 'Asia/Kolkata', now);
  assert.deepEqual(range('all'), {});
  assert.deepEqual(range('today'), { from: '2026-10-24', to: '2026-10-24' });
  assert.deepEqual(range('yesterday'), { from: '2026-10-23', to: '2026-10-23' });
  assert.deepEqual(range('7days'), { from: '2026-10-18', to: '2026-10-24' });
  for (const [period, from] of [['1month', '2026-09-24'], ['3months', '2026-07-24'], ['6months', '2026-04-24']]) assert.deepEqual(range(period), { from, to: '2026-10-24' });
  assert.deepEqual(accountDateRange('1month', 'Asia/Kolkata', at('2026-03-31')), { from: '2026-02-28', to: '2026-03-31' });
  assert.equal(accountsReport(fixture(), { period: 'all', from: '2099-01-01' }, 'Asia/Kolkata').totals.collected, 7000);
});

test('cancellation and refund dates preserve original receipts and reconcile credit and commission recovery', () => {
  const data: any = fixture();
  data.invoices[0].status = 'CANCELLED';
  data.commissions[0].status = 'RECOVERY_DUE'; data.commissions[1].status = 'REVERSED';
  data.adjustments = [
    { id: 'c1', invoiceId: 'i1', patientId: 'p1', type: 'CANCEL', amountPaise: 5000, cancelledPaise: 9000, commissionReversalPaise: 2000, paidCommissionRecoveryPaise: 1200, createdAt: at('2026-11-01'), reason: 'Treatment cancelled', actorName: 'Reception' },
    { id: 'f1', invoiceId: 'i1', patientId: 'p1', sourceId: 'c1', type: 'REFUND', amountPaise: -1500, method: 'BANK', createdAt: at('2026-12-01'), reason: 'Partial refund', actorName: 'Reception' },
  ];
  const all = accountsReport(data, {}, 'Asia/Kolkata');
  assert.equal(all.totals.net, 2000); assert.equal(all.totals.cancelled, 9000);
  assert.equal(all.totals.collected, 7000); assert.equal(all.totals.refunds, 1500); assert.equal(all.totals.netCash, 5500);
  assert.equal(all.totals.patientCredit, 3500); assert.equal(all.totals.outstanding, 0);
  assert.equal(all.totals.commission, 0); assert.equal(all.totals.commissionRecovery, 1200);
  assert.equal(all.totals.clinic, 2000, 'Refund discharges credit liability, not treatment revenue twice');
  const cancellationMonth = accountsReport(data, { from: '2026-11-01', to: '2026-11-30' }, 'Asia/Kolkata');
  assert.equal(cancellationMonth.totals.cancelled, 9000); assert.equal(cancellationMonth.totals.net, -9000);
  assert.equal(cancellationMonth.totals.commissionReversed, 2000); assert.equal(cancellationMonth.totals.collected, 0);
  const refundMonth = accountsReport(data, { from: '2026-12-01', to: '2026-12-31' }, 'Asia/Kolkata');
  assert.equal(refundMonth.totals.refunds, 1500); assert.equal(refundMonth.totals.netCash, -1500); assert.equal(refundMonth.totals.cancelled, 0);
  assert.equal(refundMonth.activity[0].sourceInvoiceId, 'i1');
  assert.equal(accountsReport(data, { doctorId: 'd2' }, 'Asia/Kolkata').activity.length, 0);
});

test('lab and clinic charges exclude even historical commissions and retain doctor invoice detail', () => {
  const data: any = fixture();
  data.invoices[1].sessionId = 's1';
  data.invoices.push({ id: 'visit', patientId: 'p1', sessionId: 's1', doctorId: 'd1', chargeKind: 'VISIT', description: 'Clinic fee', totalPaise: 30000, paidPaise: 30000, createdAt: at('2026-10-01') });
  data.payments.push({ id: 'visit-payment', invoiceId: 'visit', amountPaise: 30000, method: 'CASH', createdAt: at('2026-10-02') });
  data.commissions.push({ paymentId: 'r3', amountPaise: 800, status: 'PAID' }, { paymentId: 'visit-payment', amountPaise: 12000, status: 'ACCRUED' });
  const report = accountsReport(data, {}, 'Asia/Kolkata');
  assert.equal(report.totals.commission, 2000);
  assert.equal(report.totals.paidCommission, 1200);
  assert.equal(report.totals.dueCommission, 800);
  assert.equal(report.totals.collected, report.totals.clinic + report.totals.commission);
  const doctor = report.doctors.find(d => d.id === 'd1')!;
  assert.equal(doctor.details.length, 3);
  assert.ok(doctor.details.every((r: any) => r.invoiceNumber.startsWith('INV-')));
  assert.equal(doctor.details.find((r: any) => r.id === 'i2').commission, 0);
});
