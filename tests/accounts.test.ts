import test from 'node:test';
import assert from 'node:assert/strict';
import { accountsReport } from '../server/accounts-report.js';

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
