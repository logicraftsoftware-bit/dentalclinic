import test from 'node:test';
import assert from 'node:assert/strict';
import { billSettlements } from '../web/bill-settlement';
import { invoiceBillNumbers, formatBillNumber } from '../shared/bill-number';
import { categoryMetadata, categoryBills, categoryCollections, categoryReceipt } from '../shared/bill-categories';
import { billingLines } from '../web/billing-lines';
import { categoryPaymentPlan, initialCategoryPayment } from '../web/category-payment';

test('category collection requires an explicit amount and leaves the rest pending', () => {
  const value = initialCategoryPayment();
  assert.equal(value.amount, '');
  assert.equal(categoryPaymentPlan(320000, value).collect, 0);
  assert.equal(categoryPaymentPlan(320000, value).invalid, true);
  const partial = categoryPaymentPlan(320000, { ...value, amount: '800' });
  assert.equal(partial.invalid, false);
  assert.equal(partial.collect, 80000);
  assert.equal(partial.due - partial.collect, 240000);
  assert.equal(categoryPaymentPlan(320000, { ...value, status: 'PAID' }).collect, 320000);
});

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

test('bill numbers match printed bills and stay the same when later charges are added', () => {
  const first = { id: '11111111-abcd', appointmentId: 'abcdef12-visit', createdAt: '2026-10-29T20:00:00Z' };
  const later = { id: '22222222-abcd', appointmentId: first.appointmentId, createdAt: '2026-11-02T10:00:00Z' };
  const cancelled = { ...first, status: 'CANCELLED' };
  const numbered = invoiceBillNumbers([later, cancelled], 'Asia/Kolkata');
  assert.equal(numbered[0].billNumber, 'INV-20261030-ABCDEF12');
  assert.equal(numbered[1].billNumber, numbered[0].billNumber);
  assert.equal(formatBillNumber(first.appointmentId, first.createdAt), numbered[0].billNumber);
  assert.equal(invoiceBillNumbers([{ ...first, appointmentId: null }], 'Asia/Kolkata')[0].billNumber, 'INV-20261030-11111111');
});

test('category invoices keep multiple speciality procedures and lab charges together', () => {
  const base = { patientId: 'patient', appointmentId: 'abcdef12-visit', createdAt: '2026-10-30T08:00:00Z', status: 'UNPAID', paidPaise: 0, billNumber: 'INV-20261030-ABCDEF12' };
  const invoices = [
    { ...base, id: 'clinic', billCategory: 'CLINIC', description: 'Clinic fee', totalPaise: 30000 },
    { ...base, id: 'general', billCategory: 'GENERAL', description: 'Filling', totalPaise: 10000 },
    { ...base, id: 'special1', billCategory: 'SPECIALITY', description: 'Biopsy', totalPaise: 20000, paidPaise: 5000 },
    { ...base, id: 'special2', billCategory: 'SPECIALITY', description: 'Implant', totalPaise: 10000 },
    { ...base, id: 'lab', billCategory: 'SPECIALITY', description: 'Lab: Implant', totalPaise: 5000 },
  ];
  const bills = categoryBills(invoices), special = bills.find(b => b.billCategory === 'SPECIALITY');
  assert.equal(bills.length, 3); assert.equal(special.totalPaise, 35000); assert.equal(special.paidPaise, 5000);
  assert.equal(special.billNumber, 'INV-20261030-ABCDEF12-S');
  assert.deepEqual(special.invoiceIds, ['special1', 'special2', 'lab']);
  const payments = [{ id: 'p1', invoiceId: 'special1', amountPaise: 3000, method: 'UPI', reference: 'ref', idempotencyKey: 'checkout:special1', createdAt: base.createdAt },
    { id: 'p2', invoiceId: 'special2', amountPaise: 2000, method: 'UPI', reference: 'ref', idempotencyKey: 'checkout:special2', createdAt: base.createdAt }];
  const collections = categoryCollections(bills, payments);
  assert.equal(collections.length, 1); assert.equal(collections[0].amountPaise, 5000);
  const receipt = categoryReceipt({ billNumber: base.billNumber, invoices, payments, adjustments: [{ invoiceId: 'general' }] }, 'SPECIALITY');
  assert.equal(receipt.invoices.length, 3); assert.equal(receipt.payments.length, 2); assert.equal(receipt.adjustments.length, 0);
  assert.equal(receipt.billNumber, special.billNumber);
});

test('legacy categories resolve by master and saved category snapshots survive master changes', () => {
  const charges = [{ id: 'charge', name: 'Biopsy', chargeGroupId: 'group' }];
  const groups = [{ id: 'group', name: 'Surgery', groupName: 'Department of Oral Surgery' }];
  const legacy = { description: 'Lab: Biopsy - Tooth 11' };
  const snapshot = categoryMetadata(legacy, charges, groups);
  assert.equal(snapshot.billCategory, 'SPECIALITY'); assert.equal(snapshot.catalogItemId, 'charge');
  assert.equal(categoryMetadata({ ...legacy, ...snapshot }, charges, [{ ...groups[0], groupName: 'General dentistry' }]).billCategory, 'SPECIALITY');
  const source = '11111111-1111-4111-8111-111111111111:0:';
  assert.equal(billingLines([{ id: 'p', sourceKey: source + 'PROCEDURE', description: 'Biopsy', totalPaise: 100, paidPaise: 0, billCategory: 'SPECIALITY' },
    { id: 'l', sourceKey: source + 'LAB', description: 'Lab: Biopsy', totalPaise: 50, paidPaise: 0, billCategory: 'SPECIALITY' }], []).length, 1);
});
