import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, money } from './api';
import { BillReceipt } from './bill-receipt';
import { billingLines, procedureCollections } from './billing-lines';
import { AdjustmentDialog, PatientCreditPanel } from './patient-credit';
import { FeeSelectionFields, initialFees } from './fee-selection';
import { billSettlements } from './bill-settlement';
import { chargeDepartments } from './charge-groups';

const paise = (value: string) => Math.round(Number(value || 0) * 100);
export function BillingDesk({ appointmentId, action, tick, close, zone, workspace }: any) {
  const [data, setData] = useState<any>(null), [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [fees, setFees] = useState(initialFees);
  const [status, setStatus] = useState('PAID'), [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH'), [reference, setReference] = useState(''), [discount, setDiscount] = useState('');
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  const [cancelling, setCancelling] = useState<any>(null);
  useEffect(() => {
    let active = true;
    Promise.all([api(`/clinic/reception/${appointmentId}`), api('/clinic/charge-groups')]).then(([value, gs]) => {
      if (active) { setData(value); setGroups(gs); setError(''); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [appointmentId, tick]);
  function resetPayment() { setFees(initialFees()); setStatus('PAID'); setAmount(''); setDiscount(''); setReference(''); }
  if (!data) return <section className="panel reception-billing"><button className="secondary" onClick={close}>Back to patients</button>{error ? <p role="alert">{error}</p> : <p role="status">Loading billing desk...</p>}</section>;
  const appointment = data.appointment, blocked = ['ABSENT', 'CANCELLED'].includes(appointment.status);
  const saved = billingLines(data.invoices.filter((i: any) => i.status !== 'CANCELLED'), data.payments || []);
  const cancelled = billingLines(data.invoices.filter((i: any) => i.status === 'CANCELLED'), data.payments || []);
  const collections = procedureCollections(billingLines(data.invoices, data.payments || []), data.payments || []);
  const visitFees = [
    { name: 'Consultant fee', amount: appointment.consultationPaise },
    { name: 'Visiting consultant fee', amount: appointment.visitingConsultationPaise },
    { name: 'Clinic fee', amount: appointment.clinicFeePaise },
  ];
  const drafts = fees.lines.map(line => {
    const charge = data.charges.find((c: any) => c.id === line.catalogItemId);
    return { key: line.key, name: charge?.name || '', doctorId: line.doctorId, chargePaise: charge?.pricePaise || 0, labChargePaise: charge?.labChargePaise || 0 };
  });
  const rows: any[] = [
    ...saved.map(g => ({ ...g, kind: 'saved', target: { invoiceIds: g.invoiceIds } })),
    ...visitFees.flatMap((fee, index) => Number(fee.amount) > 0 && !data.invoices.some((i: any) => i.description === fee.name) ? [{ key: `fee:${index}`, kind: 'fee', target: { feeIndex: index }, name: fee.name, doctorId: appointment.doctorId, gross: fee.amount, net: fee.amount, lab: 0, discount: 0, paid: 0 }] : []),
    ...drafts.map(d => ({ ...d, kind: 'draft', target: { lineKey: d.key }, gross: d.chargePaise + d.labChargePaise, net: d.chargePaise + d.labChargePaise, lab: d.labChargePaise, discount: 0, paid: 0 })),
  ];
  const totals = rows.reduce((t, r) => ({ gross: t.gross + r.gross, discount: t.discount + r.discount, net: t.net + r.net, paid: t.paid + r.paid }), { gross: 0, discount: 0, net: 0, paid: 0 });
  const outstanding = totals.net - totals.paid, additionalDiscount = paise(discount), due = outstanding - additionalDiscount;
  const collecting = status === 'PENDING' ? 0 : status === 'PAID' ? Math.max(0, due) : paise(amount);
  const invalid = ![additionalDiscount, collecting].every(Number.isSafeInteger) || additionalDiscount < 0 || additionalDiscount > outstanding || collecting < 0 || collecting > due || (status === 'PARTIAL' && (collecting <= 0 || collecting >= due));
  const changed = drafts.length > 0 || additionalDiscount > 0 || rows.some(r => r.kind === 'fee');
  const incomplete = (fees.general && !fees.lines.some(l => l.department === chargeDepartments[0])) || (fees.speciality && !fees.lines.some(l => l.department !== chargeDepartments[0]));
  const doctors = new Map(data.doctors.map((d: any) => [d.id, d.name]));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || invalid || incomplete || (!changed && !collecting)) return;
    setBusy(true); setError('');
    try {
      await action(() => api(`/clinic/reception/${appointmentId}/line-checkout`, 'POST', {
        checkoutKey, lines: drafts,
        settlements: billSettlements(rows, additionalDiscount, collecting, method, reference),
      }), collecting ? 'Bill payment saved' : 'Bill changes saved', { reportError: false });
      resetPayment(); setCheckoutKey(crypto.randomUUID()); setData(await api(`/clinic/reception/${appointmentId}`));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="panel reception-billing procedure-billing appointment-create" aria-label={`Billing desk for ${data.patient.name}`}>
    <header className="reception-bill-header"><div><h2>{data.patient.name}</h2><p>{data.patient.phone} · {new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium' }).format(new Date(appointment.startsAt))}</p></div><div className="procedure-toolbar"><button className="secondary small" disabled={!data.invoices.length} onClick={() => window.print()}>Print saved bill</button><button className="secondary icon-button" disabled={busy} aria-label="Close billing desk" onClick={close}><X size={17} /></button></div></header>
    <p aria-label="Bill number"><strong>Bill No: </strong>{data.invoices.length ? data.billNumber : 'Available after saving the bill'}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <form onSubmit={save}><fieldset className="reception-procedures" disabled={busy || blocked}>
      <div className="procedure-totals" aria-label="Bill summary">
        <div className="procedure-summary-heading"><span>Bill summary</span><small>{outstanding === 0 ? 'Paid' : totals.paid > 0 ? 'Part paid' : 'Unpaid'}</small></div>
        <dl className="procedure-summary-breakdown">
          <div><dt>Gross amount</dt><dd>{money(totals.gross)}</dd></div>
          <div><dt>Discount</dt><dd>{money(totals.discount)}</dd></div>
          <div><dt>Net amount</dt><dd>{money(totals.net)}</dd></div>
          <div><dt>Already paid</dt><dd>{money(totals.paid)}</dd></div>
        </dl>
        <div className="procedure-summary-checkout"><dl className="procedure-summary-payment"><div><dt>Remaining balance</dt><dd>{money(outstanding)}</dd></div></dl></div>
      </div>
      <fieldset><legend>Saved bill</legend>
        <div className="billing-saved-list">{rows.filter(r => r.kind !== 'draft').map(r => <article key={r.key} data-procedure={r.name} className="fee-selected-procedure">
          <div className="reception-section-heading"><div><strong>{r.name}</strong><small>{String(doctors.get(r.doctorId) || 'Visit charge')}</small></div><strong>{r.net === r.paid ? 'Paid' : r.paid > 0 ? 'Part paid' : 'Unpaid'}</strong></div>
          <p>Charge: {money(r.gross - r.lab)} · Lab: {money(r.lab)} · Net: {money(r.net)}</p>
          {r.discount > 0 && <p>Saved discount: {money(r.discount)}</p>}
          <p>Previously paid: <strong>{money(r.paid)}</strong> · Pending: <strong>{money(r.net - r.paid)}</strong></p>
          {r.paid > 0 && <p>Paid by {r.methods}</p>}
          {r.kind === 'saved' && <button type="button" className="secondary small" disabled={busy || changed} onClick={() => setCancelling(r)}>Cancel procedure</button>}
        </article>)}{!rows.length && <p>No saved charges for this appointment.</p>}</div>
      </fieldset>
      <FeeSelectionFields value={fees} onChange={setFees} charges={data.charges} groups={groups} doctors={data.doctors} showPayment={false} showClinicFee={false} />
      <fieldset><legend>Payment</legend>
        <p>Previously paid: <strong>{money(totals.paid)}</strong> · Outstanding balance: <strong>{money(outstanding)}</strong></p>
        {outstanding === 0 && !changed ? <p role="status">This bill is fully paid.</p> : <>
          <div className="form-fields">
            <label>Additional discount (₹)<input aria-label="Bill discount" type="number" min="0" max={outstanding / 100} step="0.01" value={discount} placeholder="0" onChange={e => setDiscount(e.target.value)} /></label>
            <label>Payment status<select aria-label="Payment status" value={status} onChange={e => { setStatus(e.target.value); setAmount(''); }}><option value="PAID">Paid</option><option value="PARTIAL">Part paid</option><option value="PENDING">Unpaid</option></select></label>
            <label>Payment mode<select aria-label="Payment mode" disabled={status === 'PENDING'} value={method} onChange={e => setMethod(e.target.value)}>{['CASH', 'UPI', 'CARD', 'BANK'].map(m => <option key={m} value={m}>{m === 'CASH' ? 'Cash' : m === 'CARD' ? 'Card' : m === 'BANK' ? 'Bank transfer' : m}</option>)}</select></label>
            <label>Paid amount (₹)<input aria-label="Paid amount (₹)" type="number" min={status === 'PARTIAL' ? '0.01' : '0'} max={Math.max(0, due - (status === 'PARTIAL' ? 1 : 0)) / 100} step="0.01" required disabled={status === 'PENDING'} value={status === 'PARTIAL' ? amount : collecting / 100} onChange={e => { setAmount(e.target.value); setStatus(paise(e.target.value) === due ? 'PAID' : 'PARTIAL'); }} /></label>
            <label>Payment reference<input aria-label="Payment reference" disabled={status === 'PENDING'} maxLength={200} value={reference} onChange={e => setReference(e.target.value)} /></label>
          </div>
          <p aria-live="polite">Balance after payment: <strong>{money(due - collecting)}</strong></p>
          <p>This payment covers the whole bill. Previously saved payments remain in the history below.</p>
        </>}
      </fieldset>
      {invalid && <p role="alert" className="error-banner">Enter a valid discount and payment within the outstanding balance.</p>}
      <div className="appointment-actions"><button type="button" className="secondary" onClick={close}>Back to reception</button><button className="primary" disabled={invalid || incomplete || (!changed && collecting === 0)}>{busy ? 'Saving...' : collecting > 0 ? 'Collect payment' : 'Save bill changes'}</button></div>
    </fieldset></form>
    {blocked && <p>This appointment is {appointment.status.toLowerCase()}. Mark the patient present before billing.</p>}
    <details className="procedure-history" open><summary>Payment history ({collections.length} collections)</summary><div className="table-wrap"><table><thead><tr><th>Procedure</th><th>Date</th><th>Method</th><th>Reference</th><th>Collected</th></tr></thead><tbody>{collections.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.createdAt))}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{money(p.amountPaise)}</td></tr>)}</tbody></table></div></details>
    {cancelled.length > 0 && <section className="procedure-cancelled"><h3>Cancelled procedures</h3>{cancelled.map(r => <p key={r.key}><strong>{r.name}</strong> — Cancelled · Original net {money(r.net)} · Paid amount moved to credit {money(r.paid)}<small>{data.adjustments?.find((e: any) => e.type === 'CANCEL' && r.invoiceIds.includes(e.invoiceId))?.reason}</small></p>)}</section>}
    <PatientCreditPanel disabled={busy || changed} patientId={data.patient.id} invoices={data.invoices} tick={tick} action={action} zone={zone} onChanged={async () => { setData(await api(`/clinic/reception/${appointmentId}`)); resetPayment(); setCheckoutKey(crypto.randomUUID()); }} />
    {cancelling && <AdjustmentDialog type="CANCEL" patientId={data.patient.id} procedure={cancelling} action={action} close={() => setCancelling(null)} onSaved={async () => { setData(await api(`/clinic/reception/${appointmentId}`)); resetPayment(); setCheckoutKey(crypto.randomUUID()); }} />}
    <BillReceipt data={data} workspace={workspace} zone={zone} />
  </section>;
}
