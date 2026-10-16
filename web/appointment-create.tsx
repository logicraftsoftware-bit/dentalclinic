import React, { useEffect, useState } from 'react';
import { api, money } from './api';

export function AppointmentCreate({ go, action, workspace }: any) {
  const [mode, setMode] = useState('existing');
  const [query, setQuery] = useState('');
  const [patientSearchOpen, setPatientSearchOpen] = useState(false);
  const [patientsLoading, setPatientsLoading] = useState(false);
  const [patients, setPatients] = useState<any[]>([]);
  const [patient, setPatient] = useState<any>(null);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [doctorQuery, setDoctorQuery] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [branchId, setBranchId] = useState(workspace?.branchId || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [time, setTime] = useState('');
  const [clinicFee, setClinicFee] = useState(true);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const doctor = doctors.find(d => d.id === doctorId);
  useEffect(() => {
    let active = true;
    Promise.all([api('/clinic/doctors'), api('/clinic/branches')]).then(([ds, bs]) => {
      if (active) { setDoctors(ds.filter((d: any) => d.active)); setBranches(bs.filter((b: any) => b.active)); setReady(true); }
    }).catch(e => { if (active) setError(e.message); });
    const id = new URLSearchParams(window.location.search).get('patientId');
    if (id) api(`/clinic/patients/${id}`).then(p => { if (active) { setPatient(p); setQuery(p.name); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setPatients([]);
    if (mode !== 'existing' || patient || !patientSearchOpen) return;
    setPatientsLoading(true);
    const timer = setTimeout(() => {
      api(`/clinic/patients?q=${encodeURIComponent(query.trim())}`).then(rows => { if (active) { setPatients(rows); setPatientsLoading(false); } }).catch(e => { if (active) { setError(e.message); setPatientsLoading(false); } });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, mode, patient, patientSearchOpen]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!doctor || (mode === 'existing' && !patient)) { setError('Select a patient and doctor from the search results.'); return; }
    setBusy(true); setError('');
    try {
      let selected = patient;
      if (mode === 'new') {
        selected = await api('/clinic/patients', 'POST', { name: name.trim(), phone: phone.trim(), doctorId, ...(branchId ? { branchId } : {}) });
        // Keep the created patient selected if scheduling fails, so retrying cannot create a duplicate.
        setPatient(selected); setQuery(selected.name); setMode('existing');
      }
      await action(() => api('/clinic/appointments', 'POST', {
        patientId: selected.id, doctorId, ...(branchId ? { branchId } : {}),
        startsAt: new Date(`${date}T${time}`).toISOString(), durationMinutes: 30,
        useClinicFee: clinicFee, notes: notes.trim(),
      }), 'Appointment created');
      go('/clinic/appointments');
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const matches = doctors.filter(d => d.name.toLowerCase().includes(doctorQuery.trim().toLowerCase()));
  return <section className="panel appointment-create">
    <div className="page-heading"><div><h1>Create appointment</h1><p>Select the patient, doctor and visit details.</p></div><button type="button" className="secondary" onClick={() => go('/clinic/appointments')}>Back to appointments</button></div>
    {error && <p role="alert" className="appointment-error">{error}</p>}
    <form onSubmit={submit}>
      <fieldset disabled={busy || !ready}>
        <legend>Patient</legend>
        <div className="appointment-modes">
          <label><input type="radio" name="patientMode" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing patient</label>
          <label><input type="radio" name="patientMode" checked={mode === 'new'} onChange={() => setMode('new')} /> New patient</label>
        </div>
        {mode === 'existing' ? <div>
          <label>Search patient by name or phone number<input value={query} onFocus={() => setPatientSearchOpen(true)} onChange={e => { setQuery(e.target.value); setPatient(null); }} placeholder="Enter name or phone number" autoComplete="off" /></label>
          {patient ? <p className="appointment-selection">Selected: {patient.name} | {patient.phone}</p> : patientSearchOpen && <div className="appointment-results" aria-label="Patient search results">{!patientsLoading && patients.map(p => <button type="button" key={p.id} onClick={() => { setPatient(p); setQuery(p.name); setPatients([]); }}>{p.name} <span>{p.phone}</span></button>)}{patientsLoading ? <p role="status">Loading patients...</p> : !patients.length && <p>No patients found. Try another name or phone number, or choose New patient.</p>}</div>}
        </div> : <div className="form-fields"><label>Full name *<input required value={name} onChange={e => setName(e.target.value)} maxLength={200} /></label><label>Phone number *<input type="tel" required minLength={8} maxLength={20} value={phone} onChange={e => setPhone(e.target.value)} /></label></div>}
      </fieldset>
      <fieldset disabled={busy || !ready}>
        <legend>Doctor & fees</legend>
        <label>Search doctor by name *<input value={doctorQuery} onChange={e => { setDoctorQuery(e.target.value); setDoctorId(''); }} placeholder="Enter doctor name" autoComplete="off" /></label>
        {!doctor && doctorQuery.trim() && <div className="appointment-results" aria-label="Doctor search results">{matches.map(d => <button type="button" key={d.id} onClick={() => { setDoctorId(d.id); setDoctorQuery(d.name); setBranchId(d.branchId || workspace?.branchId || ''); }}>{d.name}<span>{d.specialty}</span></button>)}{ready && !matches.length && <p>No doctors found.</p>}</div>}
        {doctor && <div className="appointment-fees"><div>Consultant fee<strong>{money(doctor.consultationPaise ?? 30000)}</strong></div><div>Visiting consultant fee<strong>{money(doctor.visitingConsultationPaise ?? 100000)}</strong></div></div>}
        <label className="appointment-clinic-fee"><input type="checkbox" checked={clinicFee} onChange={e => setClinicFee(e.target.checked)} /> Use Clinic Fee - {money(30000)}</label>
        {doctor && <p className="appointment-selection">Total fees: <strong>{money((doctor.consultationPaise ?? 30000) + (doctor.visitingConsultationPaise ?? 100000) + (clinicFee ? 30000 : 0))}</strong></p>}
        <label>Branch<select value={branchId} onChange={e => setBranchId(e.target.value)}><option value="">Unassigned</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </fieldset>
      <fieldset disabled={busy || !ready}>
        <legend>Visit details</legend>
        <div className="form-fields"><label>Date *<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label><label>Time *<input type="time" required value={time} onChange={e => setTime(e.target.value)} /></label></div>
        <label>Notes (optional)<textarea rows={4} maxLength={10000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any details about this visit" /></label>
      </fieldset>
      <div className="appointment-actions"><button type="button" className="secondary" disabled={busy} onClick={() => go('/clinic/appointments')}>Cancel</button><button className="primary" disabled={busy || !ready}>{busy ? 'Creating appointment...' : 'Create appointment'}</button></div>
    </form>
  </section>;
}
