import { splitPayload } from './split-payment';
import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api, money } from './api';
import { BillReceipt } from './bill-receipt';
import { billingLines, procedureCollections } from './billing-lines';
import { AdjustmentDialog, PatientCreditPanel } from './patient-credit';
import { FeeSelectionFields, initialFees } from './fee-selection';
import { billSettlements } from './bill-settlement';
import { chargeDepartments } from './charge-groups';
import { billCategories, categoryLabels, categoryBillNumber, categoryReceipt, departmentCategory, type BillCategory } from '../shared/bill-categories';
import { CategoryPaymentFields, initialCategoryPayment, categoryPaymentPlan, type CategoryPayment } from './category-payment';
import { printPatientBill } from './print-bill';

const checkoutKeys = () => Object.fromEntries(billCategories.map(category => [category, crypto.randomUUID()]));
export function BillingDesk({ appointmentId, action, tick, close, zone, workspace }: any) {
  const [data, setData] = useState<any>(null), [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [fees, setFees] = useState(initialFees);
  const [payments, setPayments] = useState<Record<string, CategoryPayment>>({});
  const [keys, setKeys] = useState(checkoutKeys);
  const [cancelling, setCancelling] = useState<any>(null);
  useEffect(() => {
    let active = true;
    Promise.all([api(`/clinic/reception/${appointmentId}`), api('/clinic/charge-groups')]).then(([value, gs]) => {
      if (active) { setData(value); setGroups(gs); setError(''); }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [appointmentId, tick]);
  function resetAll() { setFees(initialFees()); setPayments({}); setKeys(checkoutKeys()); }
  if (!data) return <section className="panel reception-billing"><button className="secondary" onClick={close}>Back to patients</button>{error ? <p role="alert">{error}</p> : <p role="status">Loading billing desk...</p>}</section>;
  const appointment = data.appointment, blocked = ['ABSENT', 'CANCELLED'].includes(appointment.status);
  const saved = billingLines(data.invoices.filter((i: any) => i.status !== 'CANCELLED'), data.payments || []);
  const cancelled = billingLines(data.invoices.filter((i: any) => i.status === 'CANCELLED'), data.payments || []);
  const collections = procedureCollections(billingLines(data.invoices, data.payments || []), data.payments || []);
  const visitFees = [
    { name: 'Consultant fee', amount: appointment.consultationPaise },
    { name: 'Visiting consultant fee', amount: appointment.visitingConsultationPaise },
    { name: 'Clinic fee', amount: appointment.clinicFeePaise || (fees.clinicFee ? 30000 : 0) },
  ];
  const drafts = fees.lines.map(line => {
    const charge = data.charges.find((c: any) => c.id === line.catalogItemId);
    return { key: line.key, name: charge?.name || '', doctorId: line.doctorId, chargePaise: charge?.pricePaise || 0, labChargePaise: charge?.labChargePaise || 0,
      catalogItemId: line.catalogItemId, department: line.department, billCategory: departmentCategory(line.department) };
  });
  const rows: any[] = [
    ...saved.map(g => ({ ...g, kind: 'saved', target: { invoiceIds: g.invoiceIds } })),
    ...visitFees.flatMap((fee, index) => Number(fee.amount) > 0 && !data.invoices.some((i: any) => i.description === fee.name) ? [{ key: `fee:${index}`, kind: 'fee', billCategory: 'CLINIC', target: { feeIndex: index }, name: fee.name, doctorId: appointment.doctorId, gross: fee.amount, net: fee.amount, lab: 0, discount: 0, paid: 0 }] : []),
    ...drafts.map(d => ({ ...d, kind: 'draft', target: { lineKey: d.key }, gross: d.chargePaise + d.labChargePaise, net: d.chargePaise + d.labChargePaise, lab: d.labChargePaise, discount: 0, paid: 0 })),
  ];
  const totalOf = (items: any[]) => items.reduce((t, r) => ({ gross: t.gross + r.gross, discount: t.discount + r.discount, net: t.net + r.net, paid: t.paid + r.paid }), { gross: 0, discount: 0, net: 0, paid: 0 });
  const totals = totalOf(rows), outstanding = totals.net - totals.paid;
  const changed = fees.clinicFee || drafts.length > 0 || Object.values(payments).some(p => Number(p.discount) > 0);
  const doctors = new Map(data.doctors.map((d: any) => [d.id, d.name]));
  async function save(category: BillCategory, event: React.FormEvent) {
    event.preventDefault(); if (busy || blocked) return;
    const selected = rows.filter(r => r.billCategory === category), total = totalOf(selected);
    const payment = payments[category] || initialCategoryPayment(), plan = categoryPaymentPlan(total.net - total.paid, payment);
    const lines = drafts.filter(d => d.billCategory === category);
    if (plan.invalid || lines.some(d => !d.doctorId)) return;
    setBusy(true); setError('');
    try {
      await action(() => api(`/clinic/reception/${appointmentId}/line-checkout`, 'POST', {
        checkoutKey: keys[category], category, addClinicFee: category === 'CLINIC' && fees.clinicFee, lines: lines.map(({ billCategory, ...line }) => line),
        settlements: billSettlements(selected, plan.discount, plan.collect, payment.method, payment.reference, payment.status === 'PENDING' ? undefined : splitPayload(payment.splits)),
      }), `${categoryLabels[category]} bill saved`, { reportError: false });
      const savedKeys = new Set(lines.map(l => l.key));
      setFees(old => { const remaining = old.lines.filter(l => !savedKeys.has(l.key)); return { ...old, clinicFee: category === 'CLINIC' ? false : old.clinicFee, lines: remaining, general: remaining.some(l => l.department === chargeDepartments[0]), speciality: remaining.some(l => l.department !== chargeDepartments[0]) }; });
      setPayments(old => ({ ...old, [category]: initialCategoryPayment() }));
      setKeys(old => ({ ...old, [category]: crypto.randomUUID() }));
      setData(await api(`/clinic/reception/${appointmentId}`));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  async function print(category: BillCategory) {
    try { await printPatientBill({}, workspace, data.patient, [], categoryReceipt(data, category)); }
    catch (e: any) { setError(e.message); }
  }
  return <section className="panel reception-billing procedure-billing appointment-create" aria-label={`Billing desk for ${data.patient.name}`}>
    <header className="reception-bill-header"><div><h2>{data.patient.name}</h2><p>{data.patient.phone} · {new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium' }).format(new Date(appointment.startsAt))}</p></div><div className="procedure-toolbar"><button className="secondary small" disabled={!data.invoices.length} onClick={() => window.print()}>Print full visit</button><button className="secondary icon-button" disabled={busy} aria-label="Close billing desk" onClick={close}><X size={17} /></button></div></header>
    <p aria-label="Bill number"><strong>Visit bill: </strong>{data.invoices.length ? data.billNumber : 'Available after saving the bill'}</p>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="procedure-totals" aria-label="Bill summary">
      <div className="procedure-summary-heading"><span>All categories</span><small>{outstanding === 0 ? 'Paid' : totals.paid > 0 ? 'Part paid' : 'Unpaid'}</small></div>
      <dl className="procedure-summary-breakdown"><div><dt>Gross amount</dt><dd>{money(totals.gross)}</dd></div><div><dt>Discount</dt><dd>{money(totals.discount)}</dd></div><div><dt>Net amount</dt><dd>{money(totals.net)}</dd></div><div><dt>Already paid</dt><dd>{money(totals.paid)}</dd></div></dl>
      <div className="procedure-summary-checkout"><dl className="procedure-summary-payment"><div><dt>Remaining balance</dt><dd>{money(outstanding)}</dd></div></dl></div>
    </div>
    <fieldset disabled={busy || blocked} className="fee-section-wrapper"><FeeSelectionFields value={fees} onChange={setFees} charges={data.charges} groups={groups} doctors={data.doctors} showPayment={false} showClinicFee={!appointment.clinicFeePaise && !data.invoices.some((i: any) => i.description === 'Clinic fee')} /></fieldset>
    <div className="category-bills">{billCategories.map(category => {
      const selected = rows.filter(r => r.billCategory === category), total = totalOf(selected), balance = total.net - total.paid;
      const value = payments[category] || initialCategoryPayment(), plan = categoryPaymentPlan(balance, value);
      const newLines = drafts.filter(d => d.billCategory === category), unsaved = selected.some(r => r.kind !== 'saved');
      const savedInvoices = data.invoices.filter((i: any) => i.billCategory === category);
      const canSave = !plan.invalid && !newLines.some(d => !d.doctorId) && (unsaved || plan.collect + plan.discount > 0);
      return <section key={category} className="category-bill" aria-label={`${categoryLabels[category]} billing`}>
        <form onSubmit={event => save(category, event)}><fieldset disabled={busy || blocked}>
          <legend>{categoryLabels[category]} — Invoice & payment</legend>
          <div className="reception-section-heading"><div><p className="category-bill-number">Bill No: <strong>{savedInvoices.length ? categoryBillNumber(data.billNumber, category) : 'Available after saving'}</strong></p><p>{selected.length} {selected.length === 1 ? 'procedure' : 'procedures'} · {selected.length ? balance === 0 ? 'Paid' : total.paid ? 'Part paid' : 'Unpaid' : 'No charges'}</p></div><button type="button" className="secondary small" disabled={!savedInvoices.length} onClick={() => print(category)}>Print category bill</button></div>
          <dl className="category-bill-totals"><div><dt>Net amount</dt><dd>{money(total.net)}</dd></div><div><dt>Previously paid</dt><dd>{money(total.paid)}</dd></div><div><dt>Pending balance</dt><dd>{money(balance)}</dd></div></dl>
          <div className="billing-saved-list">{selected.map(r => <article key={r.key} data-procedure={r.name} className="fee-selected-procedure">
            <div className="reception-section-heading"><div><strong>{r.name}</strong><small>{String(doctors.get(r.doctorId) || 'Visit charge')}{r.kind === 'draft' ? ' · New treatment' : ''}</small></div><strong>{r.net === r.paid ? 'Paid' : r.paid > 0 ? 'Part paid' : 'Unpaid'}</strong></div>
            <p>Charge: {money(r.gross - r.lab)} · Lab: {money(r.lab)} · Net: {money(r.net)}</p>
            {r.discount > 0 && <p>Saved discount: {money(r.discount)}</p>}
            <p>Previously paid: <strong>{money(r.paid)}</strong> · Pending: <strong>{money(r.net - r.paid)}</strong></p>
            {r.paid > 0 && <p>Paid by {r.methods}</p>}
            {r.kind === 'saved' && <button type="button" className="secondary small" disabled={busy || changed} onClick={() => setCancelling(r)}>Cancel procedure</button>}
          </article>)}{!selected.length && <p>No charges in this category.</p>}</div>
          {balance > 0 && <fieldset className="category-payment-fields"><legend>Payment</legend><CategoryPaymentFields balance={balance} value={value} onChange={payment => setPayments(old => ({ ...old, [category]: payment }))} /><p>This payment applies only to {categoryLabels[category].toLowerCase()}. Pending amounts remain visible against each procedure.</p></fieldset>}
          {selected.length > 0 && (balance > 0 || unsaved) && <div className="appointment-actions"><button className="primary" disabled={!canSave}>{busy ? 'Saving...' : plan.collect > 0 ? 'Collect category payment' : 'Save category bill'}</button></div>}
        </fieldset></form>
      </section>;
    })}</div>
    {blocked && <p>This appointment is {appointment.status.toLowerCase()}. Mark the patient present before billing.</p>}
    <details className="procedure-history" open><summary>Payment history ({collections.length} collections)</summary><div className="table-wrap"><table><thead><tr><th>Procedure</th><th>Date</th><th>Method</th><th>Reference</th><th>Collected</th></tr></thead><tbody>{collections.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.createdAt))}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{money(p.amountPaise)}</td></tr>)}</tbody></table></div></details>
    {cancelled.length > 0 && <section className="procedure-cancelled"><h3>Cancelled procedures</h3>{cancelled.map(r => <p key={r.key}><strong>{r.name}</strong> — Cancelled · Original net {money(r.net)} · Paid amount moved to credit {money(r.paid)}<small>{data.adjustments?.find((e: any) => e.type === 'CANCEL' && r.invoiceIds.includes(e.invoiceId))?.reason}</small></p>)}</section>}
    <PatientCreditPanel disabled={busy || changed} patientId={data.patient.id} invoices={data.invoices} tick={tick} action={action} zone={zone} onChanged={async () => { setData(await api(`/clinic/reception/${appointmentId}`)); resetAll();  }} />
    {cancelling && <AdjustmentDialog type="CANCEL" patientId={data.patient.id} procedure={cancelling} action={action} close={() => setCancelling(null)} onSaved={async () => { setData(await api(`/clinic/reception/${appointmentId}`)); resetAll();  }} />}
    <BillReceipt data={data} workspace={workspace} zone={zone} />
  </section>;
}
