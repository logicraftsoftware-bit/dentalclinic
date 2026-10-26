import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { api, money } from './api';
import { billingLines } from './billing-lines';

const labels: Record<string, string> = { CANCEL: 'Procedure cancelled / credit added', CREDIT_USE: 'Credit used', REFUND: 'Refund recorded' };
export function AdjustmentDialog({ type, patientId, procedure, maximum, action, onSaved, close }: any) {
  const [reason, setReason] = useState(''), [amount, setAmount] = useState(''), [method, setMethod] = useState('CASH'), [reference, setReference] = useState('');
  const [requestKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const cancelling = type === 'CANCEL';
  const title = cancelling ? 'Cancel procedure' : type === 'REFUND' ? 'Record refund' : 'Use patient credit';
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      const url = cancelling ? '/clinic/procedure-cancellations' : `/clinic/patient-credits/${patientId}/${type === 'REFUND' ? 'refund' : 'apply'}`;
      const body = { requestKey, reason, ...(cancelling ? { invoiceIds: procedure.invoiceIds } : { amountPaise: Math.round(Number(amount) * 100), ...(type === 'REFUND' ? { method, reference } : { invoiceIds: procedure.invoiceIds }) }) };
      await action(() => api(url, 'POST', body), cancelling ? 'Procedure cancelled; paid amount retained as patient credit' : type === 'REFUND' ? 'Refund recorded' : 'Patient credit applied', { reportError: false });
      await onSaved(); close();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return createPortal(<div className="modal-backdrop"><section className="modal adjustment-dialog" role="dialog" aria-modal="true" aria-label={title}><form onSubmit={submit}>
    <div className="panel-heading"><h2>{title}</h2><button type="button" className="secondary small" disabled={busy} onClick={close}>Close</button></div>
    <fieldset disabled={busy}>
      {procedure && <p><strong>{procedure.name}</strong></p>}
      {cancelling ? <p>The procedure and its lab charge will be cancelled. Original bills and receipts remain in the history. {money(procedure.paid)} will be added to this patient's credit.</p> : <label>Amount (INR)<input required type="number" min="0.01" max={maximum / 100} step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /><small>Maximum: {money(maximum)}</small></label>}
      <label>{cancelling ? 'Cancellation reason' : type === 'REFUND' ? 'Refund reason' : 'Credit use reason'}<textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {type === 'REFUND' && <><label>Refund payment mode<select value={method} onChange={e => setMethod(e.target.value)}>{['CASH', 'UPI', 'CARD', 'BANK'].map(value => <option key={value}>{value}</option>)}</select></label><label>Refund reference<input maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label><p>Record the refund after returning the amount to the patient through the selected payment mode.</p></>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      <button className="primary" disabled={busy}>{busy ? 'Saving...' : title}</button>
    </fieldset>
  </form></section></div>, document.body);
}

export function PatientCreditPanel({ patientId, invoices = [], tick, action, onChanged, disabled = false, zone = 'Asia/Kolkata' }: any) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<any>(null), [target, setTarget] = useState('');
  useEffect(() => {
    let active = true;
    api(`/clinic/patient-credits/${patientId}`).then(result => { if (active) { setData(result); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [patientId, tick, revision]);
  const procedures = billingLines(invoices.filter((i: any) => i.status !== 'CANCELLED' && i.totalPaise > i.paidPaise), []);
  const selected = procedures.find(p => p.key === target);
  async function saved() { setRevision(n => n + 1); if (onChanged) await onChanged(); }
  return <section className="patient-credit-panel" aria-label="Patient credit and refunds">
    <div className="reception-section-heading"><div><h3>Patient credit & refunds</h3><p>Available patient credit: <strong>{money(data?.balancePaise || 0)}</strong></p></div><button type="button" className="secondary small" disabled={disabled || !data?.balancePaise} onClick={() => setDialog({ type: 'REFUND' })}>Refund patient credit</button></div>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!!data?.balancePaise && procedures.length > 0 && <div className="patient-credit-apply"><label>Use credit for a procedure<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Select an unpaid procedure</option>{procedures.map(p => <option key={p.key} value={p.key}>{p.name} — {money(p.net - p.paid)} due</option>)}</select></label><button type="button" className="secondary small" disabled={disabled || !selected} onClick={() => setDialog({ type: 'CREDIT_USE', procedure: selected })}>Use patient credit</button></div>}
    {!!data?.entries.length && <details className="procedure-history"><summary>Cancellation, credit & refund history ({data.entries.length})</summary><div className="table-wrap"><table><thead><tr><th>Date / User</th><th>Action / Procedure</th><th>Reason</th><th>Cancelled bill</th><th>Credit movement</th><th>Mode / Reference</th></tr></thead><tbody>{data.entries.map((e: any) => <tr key={e.id}><td>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(e.createdAt))}<small>{e.actorName}</small></td><td>{labels[e.type]}<small>{(data.invoices || invoices).find((i: any) => i.id === e.invoiceId)?.description || e.invoiceId.slice(0, 8)}</small><small>Record {e.id.slice(0, 8).toUpperCase()}</small></td><td>{e.reason}</td><td>{e.type === 'CANCEL' ? money(e.cancelledPaise) : '—'}</td><td>{money(e.amountPaise)}</td><td>{e.method}<small>{e.reference}</small></td></tr>)}</tbody></table></div></details>}
    {dialog && <AdjustmentDialog {...dialog} patientId={patientId} maximum={Math.min(data.balancePaise, dialog.procedure ? dialog.procedure.net - dialog.procedure.paid : data.balancePaise)} action={action} onSaved={saved} close={() => setDialog(null)} />}
  </section>;
}
