import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { api, money } from './api';
import { BillReceipt } from './bill-receipt';
import { billingLines, procedureCollections } from './billing-lines';

type Draft = { key: string; name: string; doctorId: string; charge: string; lab: string };
type Entry = { discount: string; collect: string; method: string; reference: string };
const emptyEntry: Entry = { discount: '', collect: '', method: 'CASH', reference: '' };
const paise = (s: string) => Math.round(Number(s || 0) * 100);

export function BillingDesk({ appointmentId, action, tick, close, zone, workspace }: any) {
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]), [entries, setEntries] = useState<Record<string, Entry>>({});
  const [checkoutKey, setCheckoutKey] = useState(() => crypto.randomUUID());
  useEffect(() => { let active = true; api(`/clinic/reception/${appointmentId}`).then(value => { if (active) { setData(value); setError(''); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [appointmentId, tick]);
  function editEntry(key: string, patch: Partial<Entry>) { setEntries(old => ({ ...old, [key]: { ...emptyEntry, ...old[key], ...patch } })); }
  function editDraft(key: string, patch: Partial<Draft>) { setDrafts(old => old.map(d => d.key === key ? { ...d, ...patch } : d)); }
  if (!data) return <section className="panel reception-billing"><button className="secondary" onClick={close}>Back to patients</button>{error ? <p role="alert">{error}</p> : <p role="status">Loading billing desk...</p>}</section>;
  const appointment = data.appointment, blocked = ['ABSENT', 'CANCELLED'].includes(appointment.status);
  const saved = billingLines(data.invoices, data.payments || []);
  const collections = procedureCollections(saved, data.payments || []);
  const fees = [
    { name: 'Consultant fee', amount: appointment.consultationPaise }, { name: 'Visiting consultant fee', amount: appointment.visitingConsultationPaise }, { name: 'Clinic fee', amount: appointment.clinicFeePaise },
  ];
  const rows: any[] = [
    ...saved.map(g => ({ ...g, key: `saved:${g.key}`, kind: 'saved', target: { invoiceIds: g.invoiceIds } })),
    ...fees.flatMap((fee, index) => Number(fee.amount) > 0 && !data.invoices.some((i: any) => i.description === fee.name) ? [{ key: `fee:${index}`, kind: 'fee', target: { feeIndex: index }, name: fee.name, doctorId: appointment.doctorId, gross: fee.amount, net: fee.amount, lab: 0, discount: 0, paid: 0, collected: 0, methods: '—' }] : []),
    ...drafts.map(d => ({ key: `line:${d.key}`, kind: 'draft', draft: d, target: { lineKey: d.key }, name: d.name, doctorId: d.doctorId, gross: paise(d.charge) + paise(d.lab), net: paise(d.charge) + paise(d.lab), lab: paise(d.lab), discount: 0, paid: 0, collected: 0, methods: '—' })),
  ];
  const invalid = rows.some(r => { const e = entries[r.key] || emptyEntry; return paise(e.discount) < 0 || paise(e.collect) < 0 || paise(e.discount) > r.net - r.paid || paise(e.collect) > r.net - r.paid - paise(e.discount); });
  const totals = rows.reduce((t, r) => { const e = entries[r.key] || emptyEntry; return { gross: t.gross + r.gross, discount: t.discount + r.discount + paise(e.discount), net: t.net + r.net - paise(e.discount), paid: t.paid + r.paid, collect: t.collect + paise(e.collect) }; }, { gross: 0, discount: 0, net: 0, paid: 0, collect: 0 });
  const changed = drafts.length > 0 || rows.some(r => r.kind === 'fee' || paise((entries[r.key] || emptyEntry).discount) || paise((entries[r.key] || emptyEntry).collect));
  const doctors = new Map(data.doctors.map((d: any) => [d.id, d.name]));
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      await action(() => api(`/clinic/reception/${appointmentId}/line-checkout`, 'POST', {
        checkoutKey, lines: drafts.map(d => ({ key: d.key, name: d.name.trim(), doctorId: d.doctorId, chargePaise: paise(d.charge), labChargePaise: paise(d.lab) })),
        settlements: rows.filter(r => r.kind !== 'saved' || paise((entries[r.key] || emptyEntry).discount) || paise((entries[r.key] || emptyEntry).collect)).map(r => { const e = entries[r.key] || emptyEntry; return { ...r.target, discountPaise: paise(e.discount), amountPaise: paise(e.collect), method: e.method, reference: e.reference }; }),
      }), 'Procedure payments saved', { reportError: false });
      setDrafts([]); setEntries({}); setCheckoutKey(crypto.randomUUID()); setData(await api(`/clinic/reception/${appointmentId}`));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="panel reception-billing procedure-billing" aria-label={`Billing desk for ${data.patient.name}`}>
    <header className="reception-bill-header"><div><h2>{data.patient.name}</h2><p>{data.patient.phone} · {new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium' }).format(new Date(appointment.startsAt))}</p></div><div className="procedure-toolbar"><button className="secondary small" disabled={!data.invoices.length} onClick={() => window.print()}>Print saved bill</button><button className="secondary icon-button" disabled={busy} aria-label="Close billing desk" onClick={close}><X size={17} /></button></div></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <form onSubmit={save}><fieldset className="reception-procedures" disabled={busy || blocked}>
      <div className="reception-section-heading"><div><h3>Procedure-wise billing</h3><p>Enter each procedure’s discount and collection separately. Paid amounts show saved receipts.</p></div><button type="button" className="secondary small" disabled={drafts.length >= 50} onClick={() => setDrafts(old => [...old, { key: crypto.randomUUID(), name: '', doctorId: appointment.doctorId, charge: '', lab: '' }])}><Plus size={15} />Add procedure</button></div>
      <datalist id="procedure-charge-master">{data.charges.map((c: any) => <option key={c.id} value={c.name} />)}</datalist>
      <div className="table-wrap"><table className="procedure-entry-table"><thead><tr><th>#</th><th>Procedure / Doctor</th><th>Charge / Lab ₹</th><th>Discount ₹<small>Additional</small></th><th>Net ₹</th><th>Paid ₹</th><th>Collect ₹</th><th>Method / Reference</th><th>Balance ₹</th><th aria-label="Remove procedure"></th></tr></thead><tbody>{rows.map((r, index) => {
        const e = entries[r.key] || emptyEntry, discount = paise(e.discount), collect = paise(e.collect), due = r.net - r.paid - discount;
        return <tr key={r.key} data-procedure={r.name} className={r.kind === 'draft' ? 'procedure-new' : ''}><td>{index + 1}</td><td>{r.kind === 'draft' ? <>
          <input required list="procedure-charge-master" maxLength={200} aria-label={`Procedure ${index + 1}`} placeholder="Choose or enter procedure" value={r.draft.name} onChange={event => { const charge = data.charges.find((c: any) => c.name === event.target.value); editDraft(r.draft.key, { name: event.target.value, ...(charge ? { charge: String(charge.pricePaise / 100), lab: String((charge.labChargePaise || 0) / 100) } : {}) }); }} />
          <select required aria-label={`Doctor ${index + 1}`} value={r.draft.doctorId} onChange={event => editDraft(r.draft.key, { doctorId: event.target.value })}><option value="">Select doctor</option>{data.doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </> : <><strong>{r.name}</strong><small>{String(doctors.get(r.doctorId) || (r.invoices?.some((i: any) => i.sessionId) ? doctors.get(appointment.doctorId) : '') || 'Visit charge')}</small>{r.discount > 0 && <small>Saved discount: {money(r.discount)}</small>}</>}</td>
          <td>{r.kind === 'draft' ? <><input required type="number" min="0" max="10000000" step="0.01" aria-label={`Charge ${index + 1}`} value={r.draft.charge} onChange={event => editDraft(r.draft.key, { charge: event.target.value })} /><input type="number" min="0" max="10000000" step="0.01" aria-label={`Lab charge ${index + 1}`} placeholder="Lab: 0" value={r.draft.lab} onChange={event => editDraft(r.draft.key, { lab: event.target.value })} /></> : <>{money(r.gross - r.lab)}{r.lab > 0 && <small>Lab: {money(r.lab)}</small>}</>}</td>
          <td><input type="number" min="0" max={(r.net - r.paid) / 100} step="0.01" aria-label={`Discount ${index + 1}`} placeholder="0" value={e.discount} onChange={event => editEntry(r.key, { discount: event.target.value })} /></td><td>{money(r.net - discount)}</td><td>{money(r.paid)}</td>
          <td><input type="number" min="0" max={Math.max(0, due) / 100} step="0.01" aria-label={`Collect ${index + 1}`} placeholder="0" value={e.collect} onChange={event => editEntry(r.key, { collect: event.target.value })} /><button type="button" className="text-button" disabled={due <= 0} aria-label={`Collect balance ${index + 1}`} onClick={() => editEntry(r.key, { collect: String(due / 100) })}>Balance</button>{r.collected > 0 && <small>Last: {money(r.collected)}</small>}</td>
          <td><select aria-label={`Payment method ${index + 1}`} value={e.method} onChange={event => editEntry(r.key, { method: event.target.value })}>{['CASH', 'UPI', 'CARD', 'BANK'].map(method => <option key={method} value={method}>{method}</option>)}</select><input maxLength={200} aria-label={`Payment reference ${index + 1}`} placeholder="Reference" value={e.reference} onChange={event => editEntry(r.key, { reference: event.target.value })} />{r.paid > 0 && <small>Paid by {r.methods}</small>}</td><td className={due - collect < 0 ? 'procedure-error' : ''}>{money(due - collect)}</td><td>{r.kind === 'draft' && <button type="button" className="text-button" aria-label={`Remove procedure ${index + 1}`} onClick={() => setDrafts(old => old.filter(d => d.key !== r.draft.key))}><Trash2 size={15} /></button>}</td></tr>;
      })}</tbody></table></div>
      {invalid && <p role="alert" className="error-banner">A procedure discount or collection exceeds that procedure’s unpaid balance.</p>}
      <div className="procedure-totals" aria-label="Bill summary"><span>Gross<strong>{money(totals.gross)}</strong></span><span>Discount<strong>{money(totals.discount)}</strong></span><span>Net<strong>{money(totals.net)}</strong></span><span>Already paid<strong>{money(totals.paid)}</strong></span><span>Collecting<strong>{money(totals.collect)}</strong></span><span>Balance<strong>{money(totals.net - totals.paid - totals.collect)}</strong></span><button className="primary" disabled={invalid || !changed}>{busy ? 'Saving...' : 'Save procedure payments'}</button></div>
    </fieldset></form>
    {blocked && <p>This appointment is {appointment.status.toLowerCase()}. Mark the patient present before billing.</p>}
    <details className="procedure-history"><summary>Payment history ({collections.length} collections)</summary><div className="table-wrap"><table><thead><tr><th>Procedure</th><th>Date</th><th>Method</th><th>Reference</th><th>Collected</th></tr></thead><tbody>{collections.map((p: any) => <tr key={p.id}><td>{p.name}</td><td>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(p.createdAt))}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{money(p.amountPaise)}</td></tr>)}</tbody></table></div></details>
    <BillReceipt data={data} workspace={workspace} zone={zone} />
  </section>;
}
