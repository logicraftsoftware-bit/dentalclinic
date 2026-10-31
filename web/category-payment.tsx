import { SplitPaymentFields, splitPayload, type PaymentPart } from './split-payment';
import React, { useState } from 'react';
import { api, money } from './api';
import { categoryLabels, type BillCategory } from '../shared/bill-categories';
import { billingLines } from './billing-lines';

export type CategoryPayment = { splits?: PaymentPart[]; status: string; amount: string; method: string; reference: string; discount: string };
export const initialCategoryPayment = (): CategoryPayment => ({ status: 'PARTIAL', amount: '', method: 'CASH', reference: '', discount: '' });
const paise = (value: string) => Math.round(Number(value || 0) * 100);
export function categoryPaymentPlan(balance: number, value: CategoryPayment) {
  const discount = paise(value.discount), due = balance - discount;
  const collect = value.status === 'PENDING' ? 0 : value.status === 'PAID' ? Math.max(0, due) : paise(value.amount);
  const invalid = ![discount, collect].every(Number.isSafeInteger) || discount < 0 || discount > balance || collect < 0 || collect > due || (value.status === 'PARTIAL' && (collect <= 0 || collect >= due));
  return { discount, due, collect, invalid };
}
export function CategoryPaymentFields({ balance, value, onChange }: { balance: number; value: CategoryPayment; onChange: (value: CategoryPayment) => void }) {
  const plan = categoryPaymentPlan(balance, value);
  const update = (patch: Partial<CategoryPayment>) => onChange({ ...value, ...patch });
  return <><div className="form-fields">
    <label>Additional discount (₹)<input aria-label="Bill discount" type="number" min="0" max={balance / 100} step="0.01" value={value.discount} placeholder="0" onChange={e => update({ discount: e.target.value })} /></label>
    <label>Payment status<select aria-label="Payment status" value={value.status} onChange={e => update({ status: e.target.value, amount: '' })}><option value="PAID">Paid</option><option value="PARTIAL">Part paid</option><option value="PENDING">Unpaid</option></select></label>
    {!value.splits && <label>Payment mode<select aria-label="Payment mode" disabled={value.status === 'PENDING'} value={value.method} onChange={e => update({ method: e.target.value })}>{['CASH', 'UPI', 'CARD', 'BANK'].map(method => <option key={method} value={method}>{method === 'CASH' ? 'Cash' : method === 'CARD' ? 'Card' : method === 'BANK' ? 'Bank transfer' : method}</option>)}</select></label>}
    <label>Paid amount (₹)<input aria-label="Paid amount (₹)" type="number" min={value.status === 'PARTIAL' ? '0.01' : '0'} max={Math.max(0, plan.due - (value.status === 'PARTIAL' ? 1 : 0)) / 100} step="0.01" required disabled={value.status === 'PENDING'} value={value.status === 'PARTIAL' ? value.amount : plan.collect / 100} onChange={e => update({ amount: e.target.value, status: paise(e.target.value) === plan.due ? 'PAID' : 'PARTIAL' })} /></label>
    {!value.splits && <label>Payment reference<input aria-label="Payment reference" disabled={value.status === 'PENDING'} maxLength={200} value={value.reference} onChange={e => update({ reference: e.target.value })} /></label>}
  </div>{value.status !== 'PENDING' && <SplitPaymentFields parts={value.splits} total={plan.collect} onChange={splits => update({ splits })} />}<p aria-live="polite">Balance after payment: <strong>{money(plan.due - plan.collect)}</strong></p>
  {plan.invalid && <p role="alert" className="error-banner">Enter a valid payment and discount within this category balance.</p>}</>;
}

export function CategoryPaymentDialog({ bill, action, close }: any) {
  const [value, setValue] = useState(initialCategoryPayment), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [checkoutKey] = useState(() => crypto.randomUUID());
  const balance = bill.totalPaise - bill.paidPaise, plan = categoryPaymentPlan(balance, value);
  return <div className="modal-backdrop"><section className="modal appointment-create" role="dialog" aria-modal="true" aria-label="Category payment">
    <div className="panel-heading"><div><h2>{categoryLabels[bill.billCategory as BillCategory]}</h2><p>Bill No: {bill.billNumber}</p></div><button type="button" className="secondary small" disabled={busy} onClick={close}>Close</button></div>
    <p>Previously paid: {money(bill.paidPaise)} · Pending: {money(balance)}</p>
    {billingLines(bill.invoices || [], []).map(row => <div className="fee-selected-procedure" key={row.key}><strong>{row.name}</strong><p>Net: {money(row.net)} · Paid: {money(row.paid)} · Pending: {money(row.net - row.paid)}</p></div>)}
    {error && <p role="alert" className="error-banner">{error}</p>}
    <form onSubmit={async event => { event.preventDefault(); if (busy || plan.invalid) return; setBusy(true); setError(''); try {
      await action(() => api('/clinic/category-payments', 'POST', { checkoutKey, category: bill.billCategory, invoiceIds: bill.invoiceIds, amountPaise: plan.collect, discountPaise: plan.discount, splits: value.status === 'PENDING' ? undefined : splitPayload(value.splits), method: value.method, reference: value.reference }), 'Category payment saved', { reportError: false }); close();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>
      <fieldset disabled={busy}><legend>Category payment</legend><CategoryPaymentFields balance={balance} value={value} onChange={setValue} /></fieldset>
      <button className="primary" disabled={busy || plan.invalid || plan.collect + plan.discount === 0}>{busy ? 'Saving...' : 'Collect category payment'}</button>
    </form>
  </section></div>;
}
