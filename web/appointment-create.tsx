import React, { useEffect, useState } from 'react';
import { api, money } from './api';
import { CheckCircle2, Printer } from 'lucide-react';
import { printPatientBill } from './print-bill';
import { FeeSelectionFields, initialFees, feeTotal, feePayload } from './fee-selection';
import { chargeDepartments } from './charge-groups';

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
  const [branchId, setBranchId] = useState<string>(workspace?.branchId || '');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('Unspecified');
  const [address, setAddress] = useState('');
  const [date, setDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [time, setTime] = useState('');
  const [fees, setFees] = useState(initialFees);
  const [charges, setCharges] = useState<any[]>([]), [groups, setGroups] = useState<any[]>([]);
  const [checkoutKey] = useState(() => crypto.randomUUID());
  const clinicFee = fees.clinicFee;
  const [consultantFee, setConsultantFee] = useState(false);
  const [visitingFee, setVisitingFee] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<any>(null);
  const [printing, setPrinting] = useState(false);
  const doctor = doctors.find(d => d.id === doctorId);
  const extraTotal = (doctor && consultantFee ? doctor.consultationPaise ?? 30000 : 0) + (doctor && visitingFee ? doctor.visitingConsultationPaise ?? 100000 : 0);
  const totalFees = feeTotal(fees, charges, extraTotal);
  useEffect(() => {
    let active = true;
    Promise.all([api('/clinic/doctors'), api('/clinic/branches'), api('/clinic/charges'), api('/clinic/charge-groups')]).then(([ds, bs, cs, gs]) => {
      if (active) { setDoctors(ds.filter((d: any) => d.active)); setBranches(bs.filter((b: any) => b.active)); setCharges(cs); setGroups(gs); setReady(true); }
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
    if (!branchId) { setError('Select a branch for this appointment.'); return; }
    if (mode === 'existing' && !patient) { setError('Select a patient from the search results.'); return; }
    if (doctorQuery.trim() && !doctor) { setError('Select a doctor from the results or clear the optional doctor field.'); return; }
    if ((fees.general && !fees.lines.some(l => l.department === chargeDepartments[0])) || (fees.speciality && !fees.lines.some(l => l.department !== chargeDepartments[0]))) { setError('Add a procedure for each selected bill type.'); return; }
    setBusy(true); setError('');
    try {
      let selected = patient;
      if (mode === 'new') {
        selected = await api('/clinic/patients', 'POST', { name: name.trim(), phone: phone.trim(), ...(age === '' ? {} : { age: Number(age) }), gender, address: address.trim(), ...(doctorId ? { doctorId } : {}), ...(branchId ? { branchId } : {}) });
        // Keep the created patient selected if scheduling fails, so retrying cannot create a duplicate.
        setPatient(selected); setQuery(selected.name); setMode('existing');
      }
      const appointment = await action(() => api('/clinic/appointments', 'POST', {
        patientId: selected.id, ...((doctorId || fees.lines[0]?.doctorId) ? { doctorId: doctorId || fees.lines[0].doctorId } : {}), ...(branchId ? { branchId } : {}),
        startsAt: new Date(`${date}T${time}`).toISOString(), durationMinutes: 30,
        useClinicFee: clinicFee, chargeConsultantFee: Boolean(doctor) && consultantFee, chargeVisitingFee: Boolean(doctor) && visitingFee, notes: notes.trim(),
        ...(totalFees > 0 ? { feeBill: feePayload(fees, totalFees, checkoutKey) } : {}),
      }), 'Appointment created');
      setConfirmation({ appointment, patient: selected, doctor: doctors.find(d => d.id === appointment.doctorId), branch: branches.find(b => b.id === appointment.branchId) });
      window.scrollTo(0, 0);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }
  const matches = doctors.filter(d => d.name.toLowerCase().includes(doctorQuery.trim().toLowerCase()));
  if (confirmation) {
    const { appointment, patient: bookedPatient, doctor: bookedDoctor, branch } = confirmation;
    const zone = workspace?.tenant?.settings?.timezone || 'Asia/Kolkata';
    const fees: any[][] = appointment.bill ? appointment.bill.invoices.map((i: any) => [i.description, i.totalPaise]) : [['Clinic fee', appointment.clinicFeePaise], ['Consultant fee', appointment.consultationPaise], ['Visiting consultant fee', appointment.visitingConsultationPaise]].filter(([, value]) => Number(value) > 0);
    const total = fees.reduce((sum, [, value]) => sum + Number(value), 0);
    async function print() {
      setPrinting(true); setError('');
      try {
        const billData = await api(`/clinic/reception/${appointment.id}`);
        await printPatientBill({}, workspace, bookedPatient, billData.payments, billData);
      } catch (e: any) { setError(e.message); } finally { setPrinting(false); }
    }
    return <section className="panel appointment-create appointment-thank-you">
      <div className="appointment-confirmation-heading"><CheckCircle2 size={52} aria-hidden="true" /><h1>Thank you!</h1><p>Your appointment has been created successfully.</p></div>
      {error && <p role="alert" className="appointment-error">{error}</p>}
      <dl className="appointment-confirmation-details"><dt>Patient</dt><dd>{bookedPatient.name}</dd><dt>Phone</dt><dd>{bookedPatient.phone || '—'}</dd><dt>Appointment</dt><dd>{new Intl.DateTimeFormat('en-IN', { timeZone: zone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(appointment.startsAt))}</dd><dt>Doctor</dt><dd>{bookedDoctor?.name || 'Unassigned'}</dd><dt>Branch</dt><dd>{branch?.name || 'Unassigned'}</dd></dl>
      <fieldset><legend>Appointment fees</legend>{fees.map(([label, value], index) => <p className="appointment-confirmation-fee" key={index}><span>{label}</span><strong>{money(Number(value))}</strong></p>)}{!fees.length && <p>No appointment fees selected.</p>}<p className="appointment-confirmation-fee"><strong>Total payable</strong><strong>{money(total)}</strong></p>{appointment.bill && <><p>Payment status: {appointment.paymentStatus === 'PAID' ? 'Paid' : appointment.paymentStatus === 'PARTIAL' ? 'Part paid' : 'Unpaid'}</p><p>Paid: {money(appointment.bill.paidPaise)} · Balance: {money(appointment.bill.balancePaise)}</p></>}</fieldset>
      <div className="appointment-actions"><button type="button" className="secondary" onClick={() => go('/clinic/appointments')}>Back to appointments</button><button type="button" className="primary" disabled={printing} onClick={print}><Printer size={18} />{printing ? 'Preparing bill...' : 'Print bill'}</button></div>
    </section>;
  }
  return <section className="panel appointment-create">
    <div className="page-heading"><div><h1>Create appointment</h1><p>Select the patient, optional doctor and visit details.</p></div><button type="button" className="secondary" onClick={() => go('/clinic/appointments')}>Back to appointments</button></div>
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
        </div> : <div className="form-fields"><label>Full name *<input required value={name} onChange={e => setName(e.target.value)} maxLength={200} /></label><label>Phone number *<input type="tel" required minLength={8} maxLength={20} value={phone} onChange={e => setPhone(e.target.value)} /></label><label>Age (years)<input type="number" min="0" max="130" step="1" value={age} onChange={e => setAge(e.target.value)} placeholder="Enter age" /></label><label>Gender<select aria-label="Gender" value={gender} onChange={e => setGender(e.target.value)}>{['Unspecified', 'Female', 'Male', 'Other'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="full">Address<textarea rows={2} maxLength={10000} value={address} onChange={e => setAddress(e.target.value)} placeholder="Enter address" /></label></div>}
      </fieldset>
      <fieldset disabled={busy || !ready} className="fee-section-wrapper"><FeeSelectionFields value={fees} onChange={setFees} charges={charges} groups={groups} doctors={doctors.filter(d => !branchId || (!d.branchId && !d.branchIds?.length) || d.branchId === branchId || d.branchIds?.includes(branchId))} extraTotal={extraTotal} /></fieldset>
      <fieldset disabled={busy || !ready}>
        <legend>Doctor & consultation fees</legend>
        <label>Search doctor by name (optional)<input value={doctorQuery} onChange={e => { setDoctorQuery(e.target.value); setDoctorId(''); setConsultantFee(false); setVisitingFee(false); }} placeholder="Enter doctor name" autoComplete="off" /></label>
        {!doctor && doctorQuery.trim() && <div className="appointment-results" aria-label="Doctor search results">{matches.map(d => <button type="button" key={d.id} onClick={() => { setDoctorId(d.id); setDoctorQuery(d.name); setConsultantFee(false); setVisitingFee(false); setBranchId(current => current && (!d.branchId || d.branchId === current || d.branchIds?.includes(current)) ? current : d.branchId || workspace?.branchId || ''); }}>{d.name}<span>{d.specialty}</span></button>)}{ready && !matches.length && <p>No doctors found.</p>}</div>}
        {doctor && <div className="appointment-fees" role="group" aria-label="Doctor fees">
          <label className="appointment-fee-option"><input type="checkbox" checked={consultantFee} onChange={e => setConsultantFee(e.target.checked)} /><span>Consultant fee<strong>{money(doctor.consultationPaise ?? 30000)}</strong></span></label>
          <label className="appointment-fee-option"><input type="checkbox" checked={visitingFee} onChange={e => setVisitingFee(e.target.checked)} /><span>Visiting consultant fee<strong>{money(doctor.visitingConsultationPaise ?? 100000)}</strong></span></label>
        </div>}
        <label>Branch *<select required value={branchId} onChange={e => setBranchId(e.target.value)}><option value="" disabled>Select a branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        {ready && !branches.length && <p role="status">Ask the clinic owner to add an active branch under Team before booking an appointment.</p>}
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
