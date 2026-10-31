import test from 'node:test';
import assert from 'node:assert/strict';
import { accountReportSheets } from '../web/account-exports';

test('exported reports reconcile daily and method totals and keep credit separate from cash', () => {
  const totals = { collected: 123456, commission: 23456, clinic: 100000, outstanding: 5000 };
  const row = { ...totals, date: '2026-10-30', patient: '=Patient', doctor: 'Doctor', procedure: 'Filling', status: 'PARTIAL', receipts: [
    { date: '2026-10-30', method: 'CASH', amount: 23456 },
    { date: '2026-10-30', method: 'UPI', amount: 100000 },
    { date: '2026-10-30', method: 'CREDIT', amount: 2000 },
  ] };
  const sheets = accountReportSheets({ totals, rows: [row], doctors: [{ ...totals, label: 'Doctor' }], procedures: [{ ...totals, label: 'Filling' }], paymentMethods: [{ method: 'CASH', amount: 23456 }, { method: 'UPI', amount: 100000 }], activity: [] });
  assert.equal(sheets.length, 8);
  assert.deepEqual(sheets.find(s => s.name === 'Doctor wise')!.rows.at(-1), ['Total', '', '', '', '', '', 1234.56, 234.56, 1000]);
  assert.deepEqual(sheets.find(s => s.name === 'Daily collections')!.rows[0], ['2026-10-30', 234.56, 1000, 1234.56]);
  assert.deepEqual(sheets.find(s => s.name === 'Payment methods')!.rows.at(-1), ['Total', 1234.56]);
  assert.equal(sheets.find(s => s.name === 'Payment details')!.rows.length, 4);
  assert.equal(sheets.find(s => s.name === 'Payment details')!.rows.at(-1)!.at(-1), 1254.56);
  assert.equal(sheets.find(s => s.name === 'Invoice details')!.rows[0][2], '=Patient');
});

test('doctor and procedure exports contain every invoice detail with reconciled totals', () => {
  const row = { invoiceNumber: 'INV-20261031-12345678-G', date: '2026-10-31', patient: 'Patient', doctor: 'Doctor', procedure: 'Crown', kind: 'PROCEDURE', collected: 100000, commission: 40000, clinic: 60000, receipts: [] };
  const group = { ...row, label: 'Doctor', details: [row] };
  const sheets = accountReportSheets({ totals: row, rows: [row], doctors: [group], procedures: [{ ...group, label: 'Crown' }], paymentMethods: [], activity: [] });
  for (const name of ['Doctor wise', 'Procedure wise', 'Invoice details']) {
    const sheet = sheets.find(s => s.name === name)!;
    const column = sheet.headers.indexOf('Invoice number');
    assert.ok(sheet.rows.some(r => r[column] === row.invoiceNumber));
    assert.ok(sheet.rows.every(r => r.length === sheet.headers.length));
  }
});
