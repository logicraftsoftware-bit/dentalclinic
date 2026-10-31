import React from 'react';
import { money } from './api';
export type PaymentPart = { method: string; amount: string; reference: string };
export const splitPayload = (parts?: PaymentPart[]) => parts?.map(p => ({ method: p.method, amountPaise: Math.round(Number(p.amount) * 100), reference: p.reference }));
export function SplitPaymentFields({ parts, total, onChange }: { parts?: PaymentPart[]; total: number; onChange: (parts: PaymentPart[] | undefined) => void }) {
  const sum = parts?.reduce((n, p) => n + Math.round(Number(p.amount || 0) * 100), 0);
  return <div><label><input type="checkbox" checked={!!parts} onChange={e => onChange(e.target.checked ? [{ method: 'CASH', amount: '', reference: '' }, { method: 'CARD', amount: '', reference: '' }] : undefined)} />Split across payment methods</label>{parts && <>
    {parts.map((part, index) => <div className="form-fields" key={index}>
      <label>Payment method {index + 1}<select value={part.method} onChange={e => onChange(parts.map((p, i) => i === index ? { ...p, method: e.target.value } : p))}>{['CASH', 'CARD', 'UPI', 'BANK'].map(m => <option key={m}>{m}</option>)}</select></label>
      <label>Amount (₹)<input type="number" min="0.01" step="0.01" required value={part.amount} onChange={e => onChange(parts.map((p, i) => i === index ? { ...p, amount: e.target.value } : p))} /></label>
      <label>Payment reference<input maxLength={200} value={part.reference} onChange={e => onChange(parts.map((p, i) => i === index ? { ...p, reference: e.target.value } : p))} /></label>
      <button type="button" className="secondary small" disabled={parts.length <= 2} onClick={() => onChange(parts.filter((_, i) => i !== index))}>Remove method</button>
    </div>)}
    <button type="button" className="secondary small" disabled={parts.length >= 20} onClick={() => onChange([...parts, { method: 'UPI', amount: '', reference: '' }])}>Add payment method</button>
    <p aria-live="polite">Payment methods total: {money(sum || 0)} / {money(total)}</p>
    <input aria-label="Payment methods total validation" tabIndex={-1} style={{ opacity: 0, height: 1, width: 1 }} value="" onChange={() => {}} ref={el => el?.setCustomValidity(sum === total && parts.every(p => Number(p.amount) > 0) ? '' : 'Payment method amounts must equal the total paid amount.')} />
  </>}</div>;
}
