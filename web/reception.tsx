import { BillingDesk } from './procedure-billing';
import React, { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { api } from './api';
import { calendarDays, nextDay, shiftMonth } from './calendar-utils';


const statuses: Record<string, string> = { SCHEDULED: 'Awaiting', CHECKED_IN: 'Present', ABSENT: 'Absent', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const dateLabel = (date: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
export function Reception({ go, workspace, tick, action, route }: any) {
  const zone = workspace?.tenant?.settings?.timezone || 'Asia/Kolkata';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('date') || today;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) && !Number.isNaN(Date.parse(requested)) && new Date(requested).toISOString().slice(0, 10) === requested ? requested : today;
  const selected = route?.appointmentId || params.get('appointment') || '';
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
    if (selected) return;
    Promise.all([api(calendarUrl), api(dailyUrl)]).then(([calendar, daily]) => { if (active) { setResult({ url, data: { ...daily, calendarAppointments: calendar.appointments } }); setError(''); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url, tick, selected]);
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
  useEffect(() => { window.scrollTo(0, 0); }, [selected]);
  if (selected) return <div className="reception-page reception-full-page">
    <header className="calendar-page-heading"><div><button className="text-button" onClick={() => openDay(date)}><ChevronLeft size={18} />Back to reception</button><h1>Billing desk</h1><p>Treatment charges, discounts, payments and receipts.</p></div></header>
    <BillingDesk key={selected} appointmentId={selected} tick={tick} action={action} zone={zone} workspace={workspace} close={() => openDay(date)} />
  </div>;
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
          <div className="reception-patient-actions"><button className="secondary small" disabled={!!saving || a.status === 'CHECKED_IN' || a.clinicalRecordClosed || a.status === 'CANCELLED'} onClick={() => attendance(a, 'CHECKED_IN')}>Present</button><button className="secondary small" disabled={!!saving || a.status === 'ABSENT' || a.clinicalRecordClosed || a.status === 'CANCELLED'} onClick={() => attendance(a, 'ABSENT')}>Absent</button><button className="primary small" aria-label={`Billing for ${a.patientName}`} onClick={() => go(`/clinic/reception/billing/${a.id}?date=${date}`)}>Billing</button></div>
        </article>)}</div>}
      </section>
    </div></div>
  </div>;
}
