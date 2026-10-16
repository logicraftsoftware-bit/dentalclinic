import React, { useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Stethoscope, ArrowDownToLine } from 'lucide-react';
import { api } from './api';
import { calendarDays, shiftMonth, nextDay, csvCell } from './calendar-utils';

const attendance: Record<string, string> = { SCHEDULED: 'Awaiting', CHECKED_IN: 'Checked in', ABSENT: 'Absent', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
const payments: Record<string, string> = { PENDING: 'Payment pending', PAID: 'Paid', PARTIAL: 'Partially paid', NOT_REQUIRED: 'Payment not required' };
const labelDate = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { ...options, timeZone: 'UTC' }).format(new Date(key + 'T12:00:00Z'));

export function AppointmentCalendar({ route, go, tick, action, modal, workspace }: any) {
  const zone = workspace?.tenant?.settings?.timezone || 'Asia/Kolkata';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get('month') || route.appointmentDate?.slice(0, 7) || today.slice(0, 7);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : today.slice(0, 7);
  const doctorFilter = params.get('doctor') || '';
  const branchFilter = params.get('branch') || '';
  const departmentFilter = params.get('department') || '';
  const days = calendarDays(month);
  const from = route.appointmentDate || days[0];
  const to = nextDay(route.appointmentDate || days[days.length - 1]);
  const url = `/clinic/appointment-calendar?from=${from}&to=${to}`;
  const [result, setResult] = useState<{ url: string; data: any } | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [payment, setPayment] = useState('');
  const [saving, setSaving] = useState('');
  useEffect(() => {
    let active = true;
    setError('');
    api(url).then(data => { if (active) setResult({ url, data }); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url, tick]);
  useEffect(() => { setSearch(''); setStatus(''); setPayment(''); }, [route.appointmentDate, route.doctorId]);
  const data = result?.url === url ? result.data : null;
  const doctors: any[] = data?.doctors || [];
  const branches: any[] = data?.branches || [];
  const doctorMap = new Map<string, any>(doctors.map(d => [d.id, d]));
  const branchMap = new Map<string, any>(branches.map(b => [b.id, b]));
  const visits: any[] = (data?.appointments || []).filter((a: any) =>
    (!doctorFilter || a.doctorId === doctorFilter) && (!branchFilter || a.branchId === branchFilter) &&
    (!departmentFilter || doctorMap.get(a.doctorId)?.specialty === departmentFilter));
  const dayVisits = visits.filter(a => a.date === route.appointmentDate);
  const selectedDoctor = doctorMap.get(route.doctorId);
  const roster = dayVisits.filter(a => a.doctorId === route.doctorId);
  const filtered = roster.filter(a => (!status || a.status === status) && (!payment || (a.paymentStatus || 'PENDING') === payment) &&
    `${a.patientName} ${a.patientPhone} ${a.patientId}`.toLowerCase().includes(search.trim().toLowerCase()));
  function pathFor(path: string, changes: Record<string, string> = {}) {
    const q = new URLSearchParams(window.location.search);
    q.set('month', month);
    for (const [key, value] of Object.entries(changes)) value ? q.set(key, value) : q.delete(key);
    return path + '?' + q.toString();
  }
  function filterChange(key: string, value: string) { go(pathFor('/clinic/appointments', { [key]: value })); }
  const schedule = () => go('/clinic/appointments/new');
  async function update(a: any, patch: any) {
    setSaving(a.id);
    try {
      const row = await action(() => api(`/clinic/appointments/${a.id}`, 'PATCH', patch), 'Appointment updated');
      setResult(previous => previous ? { ...previous, data: { ...previous.data, appointments: previous.data.appointments.map((old: any) => old.id === a.id ? { ...old, ...row } : old) } } : previous);
    } catch (e: any) { setError(e.message); } finally { setSaving(''); }
  }
  function followUp(a: any) {
    modal({ title: `Follow-up for ${a.patientName}`, fields: [
      { key: 'title', label: 'Follow-up reason', required: true },
      { key: 'dueAt', label: 'Due date & time', type: 'datetime-local', required: true },
    ], submit: (fields: any) => action(() => api('/clinic/followups', 'POST', { ...fields, patientId: a.patientId }), 'Follow-up scheduled') });
  }
  const time = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: data?.timezone || zone, hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  function exportCsv() {
    const rows = [['Date', 'Doctor', 'Time', 'Patient', 'Patient ID', 'Phone', 'Attendance', 'Payment status', 'Notes'], ...filtered.map(a => [route.appointmentDate, selectedDoctor?.name || 'Doctor', time(a.startsAt), a.patientName, a.patientId, a.patientPhone, attendance[a.status], payments[a.paymentStatus || 'PENDING'], a.notes])];
    const blob = new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = href; link.download = `appointments-${route.appointmentDate}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function exportPdf() {
    const title = document.title;
    document.title = `${selectedDoctor?.name || 'Doctor'} - ${route.appointmentDate}`;
    try { window.print(); } finally { document.title = title; }
  }
  const dateHeading = route.appointmentDate ? labelDate(route.appointmentDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const patientCount = new Set(roster.map(a => a.patientId)).size;
  return <div className="appointment-calendar">
    {!route.appointmentDate ? <>
      <header className="calendar-page-heading"><div><h1>Appointments</h1><p>See every doctor appointment across the clinic by date.</p></div><button className="primary" onClick={schedule}><Plus size={17} />Schedule appointment</button></header>
      <section className="panel calendar-panel">
        <div className="calendar-filters">
          <label>Doctor<select value={doctorFilter} onChange={e => filterChange('doctor', e.target.value)}><option value="">All doctors</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Branch<select value={branchFilter} onChange={e => filterChange('branch', e.target.value)}><option value="">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>Department<select value={departmentFilter} onChange={e => filterChange('department', e.target.value)}><option value="">All departments</option>{[...new Set(doctors.map(d => d.specialty).filter(Boolean))].sort().map(d => <option key={d} value={d}>{d}</option>)}</select></label>
          <button className="secondary" onClick={() => go(`/clinic/appointments?month=${month}`)}>Clear filters</button>
        </div>
        <p className="calendar-hint">Filter options reflect appointments in the displayed calendar.</p>
        <div className="calendar-month"><button className="secondary icon-button" aria-label="Previous month" onClick={() => go(pathFor('/clinic/appointments', { month: shiftMonth(month, -1) }))}><ChevronLeft size={20} /></button><h2>{labelDate(month + '-01', { month: 'long', year: 'numeric' })}</h2><div><button className="text-button" onClick={() => go(pathFor('/clinic/appointments', { month: today.slice(0, 7) }))}>Today</button><button className="secondary icon-button" aria-label="Next month" onClick={() => go(pathFor('/clinic/appointments', { month: shiftMonth(month, 1) }))}><ChevronRight size={20} /></button></div></div>
        <div className="calendar-legend"><span><i className="booked" />Booked date</span><span><i />No appointments</span></div>
        {error && <p role="alert" className="error-banner">{error}</p>}
        {!data ? <p role="status">Loading calendar...</p> : <div className="calendar-scroll"><div className="month-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d} className="calendar-weekday">{d}</div>)}
          {days.map(key => {
            const count = visits.filter(a => a.date === key).length;
            return <button key={key} aria-current={key === today ? 'date' : undefined} aria-label={`${key}, ${count} appointment${count === 1 ? '' : 's'}`} className={`calendar-day ${count ? 'booked' : ''} ${key.slice(0, 7) !== month ? 'outside' : ''} ${key === today ? 'today' : ''}`} onClick={() => go(pathFor(`/clinic/appointments/${key}`))}><strong>{Number(key.slice(-2))}</strong><span>{count ? `${count} appointment${count === 1 ? '' : 's'}` : 'No appointments'}</span></button>;
          })}
        </div></div>}
      </section>
    </> : <>
      <button className="text-button calendar-back" onClick={() => go(pathFor(route.doctorId ? `/clinic/appointments/${route.appointmentDate}` : '/clinic/appointments'))}><ChevronLeft size={18} />{route.doctorId ? 'Back to doctors' : 'Back to calendar'}</button>
      <header className="calendar-page-heading"><div><p className="calendar-eyebrow">{route.doctorId ? 'DAILY PATIENT LIST' : 'APPOINTMENT ROSTER'}</p><h1>{route.doctorId ? selectedDoctor?.name || 'Doctor appointments' : dateHeading}</h1><p>{route.doctorId ? `${dateHeading}${selectedDoctor?.specialty ? ' - ' + selectedDoctor.specialty : ''}` : `${dayVisits.length} appointment${dayVisits.length === 1 ? '' : 's'} across ${new Set(dayVisits.map(a => a.doctorId)).size} doctor${new Set(dayVisits.map(a => a.doctorId)).size === 1 ? '' : 's'}.`}</p></div>{route.doctorId ? <div className="calendar-export"><button className="secondary" onClick={exportCsv} disabled={!data}><ArrowDownToLine size={17} />Export CSV</button><button className="primary" onClick={exportPdf} disabled={!data}>Export PDF</button></div> : <button className="primary" onClick={schedule}><Plus size={17} />Schedule appointment</button>}</header>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {!data ? <p role="status">Loading appointments...</p> : !route.doctorId ? <div className="doctor-roster-grid">
        {[...new Set(dayVisits.map(a => a.doctorId))].map(id => {
          const doctor = doctorMap.get(id), entries = dayVisits.filter(a => a.doctorId === id);
          const branchNames = [...new Set(entries.map(a => branchMap.get(a.branchId)?.name).filter(Boolean))];
          return <button className="panel doctor-roster-card" key={id} onClick={() => go(pathFor(`/clinic/appointments/${route.appointmentDate}/${id}`))}><span className="doctor-roster-icon"><Stethoscope size={25} /></span><span className="doctor-roster-info"><strong>{doctor?.name || 'Doctor'}</strong><small>{doctor?.specialty || 'General Dentistry'}</small><small>{branchNames.join(', ') || 'No branch assigned'}</small></span><span className="doctor-roster-count"><strong>{new Set(entries.map(a => a.patientId)).size}</strong><small>{new Set(entries.map(a => a.patientId)).size === 1 ? 'patient' : 'patients'}</small></span><ChevronRight size={18} /></button>;
        })}
        {!dayVisits.length && <section className="panel calendar-empty"><CalendarDays size={30} /><h2>No appointments on this date</h2><button className="primary" onClick={schedule}>Schedule appointment</button></section>}
      </div> : <>
        <div className="panel calendar-colour-guide"><strong>Colour guide:</strong>{Object.entries(attendance).map(([key, label]) => <span key={key}><i className={`status-dot ${key.toLowerCase()}`} />{label}</span>)}{Object.entries(payments).map(([key, label]) => <span key={key}><i className={`status-dot payment-${key.toLowerCase()}`} />{label}</span>)}</div>
        <section className="panel daily-roster">
          <div className="roster-filters"><label><span className="sr-only">Search patients in roster</span><input placeholder="Search patient name, ID or phone number" value={search} onChange={e => setSearch(e.target.value)} /></label><label><span className="sr-only">Attendance filter</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">All attendance</option>{Object.entries(attendance).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label><span className="sr-only">Payment filter</span><select value={payment} onChange={e => setPayment(e.target.value)}><option value="">All payment statuses</option>{Object.entries(payments).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label></div>
          <p className="roster-count">Showing {filtered.length} of {roster.length} appointments for {patientCount} {patientCount === 1 ? 'patient' : 'patients'}</p>
          <div className="roster-entries">{filtered.map(a => <article className={`roster-entry ${a.status.toLowerCase()}`} key={a.id}>
            <time dateTime={a.startsAt}>{time(a.startsAt)}</time><div className="roster-patient"><strong>{a.patientName}</strong><small>{a.patientId.slice(0, 8)} - {a.patientPhone}</small>{a.notes && <small>{a.notes}</small>}</div>
            <span className={`attendance-pill ${a.status.toLowerCase()}`}>{attendance[a.status] || a.status}</span>
            <select className={`payment-select ${(a.paymentStatus || 'PENDING').toLowerCase()}`} aria-label={`Payment status for ${a.patientName}`} value={a.paymentStatus || 'PENDING'} disabled={!!saving} onChange={e => update(a, { paymentStatus: e.target.value })}>{Object.entries(payments).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
            <div className="roster-actions"><button className="secondary small" onClick={() => followUp(a)}>Follow-up</button><button className="secondary small" disabled={!!saving || a.status === 'CHECKED_IN'} onClick={() => update(a, { status: 'CHECKED_IN' })}>Check in</button><button className="secondary small roster-absent" disabled={!!saving || a.status === 'ABSENT'} onClick={() => update(a, { status: 'ABSENT' })}>Absent</button><select aria-label={`Attendance for ${a.patientName}`} value={a.status} disabled={!!saving} onChange={e => update(a, { status: e.target.value })}>{Object.entries(attendance).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></div>
          </article>)}</div>
          {!filtered.length && <p className="calendar-empty">No patients match these filters.</p>}
        </section>
      </>}
    </>}
  </div>;
}
