import React, { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, X } from 'lucide-react';
import { api, money } from './api';
import { calendarDays, nextDay, shiftMonth } from './calendar-utils';
import { VisitBilling } from './dental-workflow';

const statuses: Record<string, string> = { SCHEDULED: 'Awaiting', CHECKED_IN: 'Present', ABSENT: 'Absent', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
type Line = { key: string; name: string; doctorId: string; charge: string; lab: string };

function BillingDesk({ appointmentId, action, tick, modal, close, zone }: any) {
  const [data, setData] = useState<any>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [billKey, setBillKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    let active = true;
    api(`/clinic/reception/${appointmentId}`).then(value => { if (active) { setData(value); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [appointmentId, tick]);
  const addLine = () => setLines(old => [...old, { key: crypto.randomUUID(), name: '', doctorId: data.appointment.doctorId, charge: '', lab: '' }]);
  function edit(key: string, values: Partial<Line>) { setLines(old => old.map(line => line.key === key ? { ...line, ...values } : line)); }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await action(() => api(`/clinic/reception/${appointmentId}/bills`, 'POST', {
        billKey, lines: lines.map(line => ({ name: line.name.trim(), doctorId: line.doctorId, chargePaise: Math.round(Number(line.charge) * 100), labChargePaise: Math.round(Number(line.lab) * 100) })),
      }), 'Patient bill saved', { reportError: false });
      setLines([]); setBillKey(crypto.randomUUID());
      setData(await api(`/clinic/reception/${appointmentId}`));
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  if (!data) return <section className="panel reception-billing"><button className="secondary" onClick={close}>Back to patients</button>{error ? <p role="alert">{error}</p> : <p role="status">Loading billing desk...</p>}</section>;
  const appointment = data.appointment;
  const blocked = ['ABSENT', 'CANCELLED'].includes(appointment.status);
  const draftTotal = lines.reduce((n, line) => n + Math.round(Number(line.charge || 0) * 100) + Math.round(Number(line.lab || 0) * 100), 0);
  const unbilledVisitFee = [
    ['Consultant fee', appointment.consultationPaise], ['Visiting consultant fee', appointment.visitingConsultationPaise], ['Clinic fee', appointment.clinicFeePaise],
  ].reduce((sum: number, [description, amount]) => sum + (data.invoices.some((i: any) => i.description === description) ? 0 : Number(amount || 0)), 0);
  const doctorNames = new Map(data.doctors.map((d: any) => [d.id, d.name]));
  return <section className="panel reception-billing" aria-label={`Billing desk for ${data.patient.name}`}>
    <header className="reception-bill-header"><div><p className="calendar-eyebrow">BILLING DESK · STAFF VIEW</p><h2>{data.patient.name}</h2><p>{data.patient.phone} · {new Intl.DateTimeFormat('en-IN', { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(appointment.startsAt))}</p></div><button className="secondary icon-button" aria-label="Close billing desk" disabled={busy} onClick={close}><X size={18} /></button></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <form onSubmit={save}>
      <fieldset disabled={busy || blocked} className="reception-procedures">
        <div className="reception-section-heading"><div><h3>Procedures on this bill</h3><p>Add treatment charges and assign the treating doctor.</p></div><span>{lines.length} procedures · {new Set(lines.map(line => line.doctorId)).size} doctors</span></div>
        <div className="table-wrap"><table className="reception-procedure-table"><thead><tr><th>#</th><th>Procedure</th><th>Doctor</th><th>Charge (₹)</th><th className="reception-lab">Lab charge (₹)<small>Staff only</small></th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>
          {lines.map((line, index) => <tr key={line.key}><td>{index + 1}</td><td>
            <select aria-label={`Charge master ${index + 1}`} value="" onChange={e => { const charge = data.charges.find((c: any) => c.id === e.target.value); if (charge) edit(line.key, { name: charge.name, charge: String(charge.pricePaise / 100), lab: String((charge.labChargePaise || 0) / 100) }); }}><option value="">Choose from charge master</option>{data.charges.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input required maxLength={200} aria-label={`Procedure ${index + 1}`} placeholder="Treatment / procedure name" value={line.name} onChange={e => edit(line.key, { name: e.target.value })} />
          </td><td><select required aria-label={`Doctor ${index + 1}`} value={line.doctorId} onChange={e => edit(line.key, { doctorId: e.target.value })}><option value="">Select doctor</option>{data.doctors.map((d: any) => <option key={d.id} value={d.id}>{d.name} · {d.specialty}</option>)}</select></td>
            <td><input required type="number" min="0" max="10000000" step="0.01" aria-label={`Charge ${index + 1}`} value={line.charge} onChange={e => edit(line.key, { charge: e.target.value })} /></td>
            <td className="reception-lab"><input type="number" min="0" max="10000000" step="0.01" aria-label={`Lab charge ${index + 1}`} value={line.lab} onChange={e => edit(line.key, { lab: e.target.value })} /></td>
            <td><button type="button" className="text-button" aria-label={`Remove procedure ${index + 1}`} onClick={() => setLines(old => old.filter(row => row.key !== line.key))}><Trash2 size={17} /></button></td></tr>)}
        </tbody></table></div>
        {!lines.length && <p className="reception-empty">Add a procedure, or create the bill with just the selected appointment fee.</p>}
        <button type="button" className="secondary" disabled={lines.length >= 50} onClick={addLine}><Plus size={16} />Add procedure</button>
        <div className="reception-draft-total"><span>New procedure & lab charges</span><strong>{money(draftTotal)}</strong></div>
        {unbilledVisitFee > 0 && <div className="reception-draft-total"><span>Selected appointment fee</span><strong>{money(unbilledVisitFee)}</strong></div>}
        <div className="reception-draft-total"><strong>New bill total</strong><strong>{money(draftTotal + unbilledVisitFee)}</strong></div>
        <p className="muted">The selected appointment fee is added once. Saved charges appear below; add only procedures that have not already been billed.</p>
        <button className="primary" disabled={!lines.length && !unbilledVisitFee}>{busy ? 'Saving bill...' : 'Save bill'}</button>
      </fieldset>
    </form>
    {blocked && <p role="status">This patient is {statuses[appointment.status].toLowerCase()}. Mark the patient present to create a bill.</p>}
    {!!data.invoices.length && <details className="reception-saved-charges"><summary>Saved treatment & doctor details</summary>{data.invoices.map((i: any) => <p key={i.id}>{i.description} · {String(doctorNames.get(i.doctorId || (i.sessionId ? appointment.doctorId : '')) || (i.chargeKind === 'LAB' || i.description.startsWith('Lab:') ? 'Lab charge' : 'Visit charge'))} · {money(i.totalPaise)}</p>)}</details>}
    <VisitBilling invoices={data.invoices} modal={modal} action={action} emptyMessage="Save the bill above to record a payment." />
  </section>;
}

export function Reception({ go, workspace, tick, action, modal }: any) {
  const zone = workspace?.tenant?.settings?.timezone || 'Asia/Kolkata';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('date') || today;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) && new Date(requested).toISOString().slice(0, 10) === requested ? requested : today;
  const selected = params.get('appointment') || '';
  const [month, setMonth] = useState(date.slice(0, 7));
  const [result, setResult] = useState<any>(null), [error, setError] = useState('');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [saving, setSaving] = useState('');
  const days = calendarDays(month);
  const calendarUrl = `/clinic/appointment-calendar?from=${days[0]}&to=${nextDay(days[days.length - 1])}`;
  const dailyUrl = `/clinic/appointment-calendar?from=${date}&to=${nextDay(date)}`;
  const url = `${calendarUrl}|${dailyUrl}`;
  useEffect(() => { setMonth(date.slice(0, 7)); }, [date]);
  useEffect(() => {
    let active = true;
    Promise.all([api(calendarUrl), api(dailyUrl)]).then(([calendar, daily]) => { if (active) { setResult({ url, data: { ...daily, calendarAppointments: calendar.appointments } }); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url, tick]);
  const data = result?.url === url ? result.data : null;
  const patients = (data?.appointments || []).filter((a: any) => a.date === date);
  const visible = patients.filter((a: any) => (!filter || a.status === filter) && `${a.patientName} ${a.patientPhone}`.toLowerCase().includes(search.toLowerCase()));
  const doctorNames = new Map((data?.doctors || []).map((d: any) => [d.id, d.name]));
  function openDay(value: string) { go(`/clinic/reception?date=${value}`); }
  async function attendance(a: any, status: string) {
    if (saving) return;
    setSaving(a.id); setError('');
    try {
      const row = await action(() => api(`/clinic/appointments/${a.id}`, 'PATCH', { status }), `Patient marked ${status === 'CHECKED_IN' ? 'present' : 'absent'}`, { reportError: false });
      setResult((old: any) => old ? { ...old, data: { ...old.data, appointments: old.data.appointments.map((item: any) => item.id === a.id ? { ...item, ...row } : item) } } : old);
    } catch (e: any) { setError(e.message); } finally { setSaving(''); }
  }
  return <div className="reception-page">
    <header className="calendar-page-heading"><div><p className="calendar-eyebrow">RECEPTIONIST PANEL</p><h1>{workspace?.role === 'RECEPTIONIST' ? 'Receptionist panel' : 'Reception'}</h1><p>Daily patients, attendance and treatment billing.</p></div><button className="primary" onClick={() => go('/clinic/appointments/new')}><Plus size={17} />New appointment</button></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    <div className="reception-layout"><aside className="panel reception-calendar" aria-label="Reception calendar">
      <div className="reception-month"><button className="text-button" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button><strong>{new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`))}</strong><button className="text-button" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={18} /></button></div>
      <div className="reception-mini-calendar">{['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <span key={d}>{d}</span>)}{days.map(day => {
        const count = (data?.calendarAppointments || []).filter((a: any) => a.date === day).length;
        return <button key={day} className={`${day === date ? 'selected' : ''} ${day.slice(0, 7) !== month ? 'outside' : ''}`} aria-label={`${day}, ${count} appointments`} aria-pressed={day === date} onClick={() => openDay(day)}>{Number(day.slice(-2))}{count > 0 && <i />}</button>;
      })}</div>
      <button className="secondary" onClick={() => { setMonth(today.slice(0, 7)); openDay(today); }}><CalendarDays size={16} />Today</button>
      <label>Select date<input type="date" value={date} onChange={e => e.target.value && openDay(e.target.value)} /></label>
      <div className="reception-stats"><span>Appointments<strong>{patients.length}</strong></span><span>Present<strong>{patients.filter((a: any) => ['CHECKED_IN', 'COMPLETED'].includes(a.status)).length}</strong></span><span>Absent<strong>{patients.filter((a: any) => a.status === 'ABSENT').length}</strong></span></div>
    </aside><div className="reception-workspace">
      <section className="panel reception-patients"><div className="reception-section-heading"><div><h2>{date === today ? "Today's patients" : 'Patients'}</h2><p>{dateLabel(date)}</p></div><span>{patients.length} appointments</span></div>
        <div className="reception-filters"><input aria-label="Search reception patients" placeholder="Search patient or phone" value={search} onChange={e => setSearch(e.target.value)} /><select aria-label="Reception attendance filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All attendance</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
        {!data ? <p role="status">Loading patients...</p> : !visible.length ? <p className="reception-empty">No patients for this date or filter.</p> : <div className="reception-patient-list">{visible.map((a: any) => <article key={a.id} className={`reception-patient ${selected === a.id ? 'selected' : ''}`}>
          <time>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(a.startsAt))}</time><div className="reception-patient-name"><strong>{a.patientName}</strong><small>{a.patientPhone} · {String(doctorNames.get(a.doctorId) || 'Doctor')}</small></div>
          <span className={`attendance-pill ${a.status.toLowerCase()}`}>{statuses[a.status]}</span>
          <div className="reception-patient-actions"><button className="secondary small" disabled={!!saving || a.status === 'CHECKED_IN' || a.clinicalRecordClosed || a.status === 'CANCELLED'} onClick={() => attendance(a, 'CHECKED_IN')}>Present</button><button className="secondary small" disabled={!!saving || a.status === 'ABSENT' || a.clinicalRecordClosed || a.status === 'CANCELLED'} onClick={() => attendance(a, 'ABSENT')}>Absent</button><button className="primary small" aria-label={`Billing for ${a.patientName}`} onClick={() => go(`/clinic/reception?date=${date}&appointment=${a.id}`)}>Billing</button></div>
        </article>)}</div>}
      </section>
      {selected && <BillingDesk key={selected} appointmentId={selected} tick={tick} action={action} modal={modal} zone={zone} close={() => openDay(date)} />}
    </div></div>
  </div>;
}
