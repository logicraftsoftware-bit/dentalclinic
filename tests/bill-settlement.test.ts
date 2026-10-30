import test from 'node:test';
import assert from 'node:assert/strict';
import { billSettlements } from '../web/bill-settlement';

const rows = [
  { kind: 'saved', net: 30000, paid: 30000, target: { invoiceIds: ['paid'] } },
  { kind: 'saved', net: 100000, paid: 40000, target: { invoiceIds: ['partial'] } },
  { kind: 'draft', net: 20000, paid: 0, target: { lineKey: 'new' } },
];
test('whole bill payments skip paid charges and settle old balances before new treatments', () => {
  const plans = billSettlements(rows, 0, 70000, 'UPI', 'receipt');
  assert.deepEqual(plans.map(p => p.amountPaise), [60000, 10000]);
  assert.equal(plans[0].method, 'UPI');
  assert.equal(plans[1].reference, 'receipt');
  assert.equal(rows[1].paid, 40000);
});
test('bill discounts reconcile to the paise without changing historical payments', () => {
  const plans = billSettlements(rows, 10001, 69999, 'CASH', '');
  assert.equal(plans.reduce((s, p) => s + p.discountPaise, 0), 10001);
  assert.equal(plans.reduce((s, p) => s + p.amountPaise, 0), 69999);
  assert.deepEqual(plans.map(p => p.discountPaise), [7500, 2501]);
  assert.throws(() => billSettlements(rows, 0, 80001, 'CASH', ''));
  assert.throws(() => billSettlements(rows, -1, 0, 'CASH', ''));
});
test('unpaid new treatments are saved without creating a collection', () => {
  const plans = billSettlements(rows, 0, 0, 'CASH', '');
  assert.equal(plans.length, 1);
  assert.equal(plans[0].lineKey, 'new');
  assert.equal(plans[0].amountPaise, 0);
});
