import React, { useEffect, useState } from 'react';
import { api, money, day } from './api';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const conditions = ['Healthy', 'Caries', 'Filled', 'Missing', 'Crown', 'Root canal', 'Implant', 'Planned'];
const permanent = [[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28], [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]];
const primary = [[55,54,53,52,51,61,62,63,64,65], [85,84,83,82,81,71,72,73,74,75]];
const rupees = (value: number) => String((value || 0) / 100);
const paise = (value: string) => Math.round(Number(value) * 100);

function VisitHistory({ history, doctors = [], items = [], plans = [] }: any) {
  const names = new Map(doctors.map((d: any) => [d.id, d.name]));
  return <section className="panel dental-section"><h2>Previous treatment & referral history</h2>
    {!history?.length && !plans.length && <p>No previous treatment recorded.</p>}
    {(history || []).map((visit: any) => <details key={visit.id} className="dental-history"><summary>{day(visit.createdAt)} - {String(names.get(visit.doctorId) || 'Doctor')} - {visit.diagnosis || visit.complaint} <span className="badge">{visit.status}</span></summary>
      {Object.entries(visit.teeth || {}).map(([tooth, value]: any) => <p key={tooth}>Tooth {tooth}: {value.condition}{value.notes ? ' - ' + value.notes : ''}</p>)}
      <p><strong>Complaint:</strong> {visit.complaint}</p><p><strong>Findings:</strong> {visit.findings || '-'}</p><p><strong>Diagnosis:</strong> {visit.diagnosis}</p>
      {(visit.lines || []).map((line: any, i: number) => <p key={i}>Tooth {line.tooth}: {line.name} - {money(line.pricePaise)} / Lab {money(line.labChargePaise)} {line.labName && `(${line.labName})`}{line.labNotes && ` - ${line.labNotes}`}</p>)}
      <p><strong>Advice:</strong> {visit.advice || '-'}</p><p><strong>Prescription:</strong> {visit.medication || '-'}</p>
      {visit.surgeryDate && <p>Surgery date: {day(visit.surgeryDate)}</p>}{visit.nextVisit && <p>Review: {day(visit.nextVisit)}</p>}
      <p>Medical history: {visit.medicalHistory || '-'} / Allergies: {visit.allergies || '-'}</p>
    </details>)}
    {plans.filter((p: any) => !(history || []).some((v: any) => v.planId === p.id)).map((plan: any) => <details key={plan.id} className="dental-history"><summary>{plan.title} - {plan.status}</summary>{items.filter((i: any) => i.planId === plan.id).map((i: any) => <p key={i.id}>Tooth {i.tooth}: {i.name} - {money(i.pricePaise)} / Lab {money(i.labChargePaise)} - {i.status}</p>)}</details>)}
  </section>;
}
function VisitBilling({ invoices = [], modal, action }: any) {
  const total = invoices.reduce((s: number, i: any) => s + i.totalPaise, 0), paid = invoices.reduce((s: number, i: any) => s + i.paidPaise, 0);
  function pay(invoice: any) {
    const key = crypto.randomUUID();
    modal({ title: 'Record patient payment', subtitle: invoice.description, fields: [
      { key: 'amountPaise', label: 'Amount received (rupees)', type: 'money', value: (invoice.totalPaise - invoice.paidPaise) / 100, required: true },
      { key: 'method', label: 'Payment method', type: 'select', options: ['CASH','UPI','CARD','BANK'].map(value => ({ value, label: value })) },
      { key: 'reference', label: 'Payment reference' },
    ], submit: (data: any) => action(() => api('/clinic/payments', 'POST', { ...data, invoiceId: invoice.id, idempotencyKey: key }), 'Payment recorded') });
  }
  return <section className="panel dental-section"><h2>Reception billing</h2><p>Treatment, laboratory and visit fees are billed separately.</p><div className="dental-total"><span>Total {money(total)}</span><span>Paid {money(paid)}</span><strong>Balance {money(total - paid)}</strong></div>
    {!invoices.length ? <p>Invoices appear when the doctor closes the visit.</p> : <div className="table-wrap"><table><thead><tr><th>Description</th><th>Total</th><th>Paid</th><th>Balance</th><th>Payment</th></tr></thead><tbody>{invoices.map((i: any) => <tr key={i.id}><td>{i.description}</td><td>{money(i.totalPaise)}</td><td>{money(i.paidPaise)}</td><td>{money(i.totalPaise-i.paidPaise)}</td><td>{i.paidPaise < i.totalPaise ? <button className="secondary small" onClick={() => pay(i)}>Record payment</button> : 'Paid'}</td></tr>)}</tbody></table></div>}
  </section>;
}

export function DentalVisit({ route, workspace, tick, action, modal, go }: any) {
  const [data, setData] = useState<any>(null), [catalog, setCatalog] = useState<any[]>([]), [directory, setDirectory] = useState<any>({ doctors: [], branches: [] });
  const [form, setForm] = useState<any>(null), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [selectedTooth, setSelectedTooth] = useState('11'), [dentition, setDentition] = useState('permanent');
  const [refer, setRefer] = useState(false), [referDoctor, setReferDoctor] = useState(''), [referBranch, setReferBranch] = useState(''), [referReason, setReferReason] = useState(''), [doctorSearch, setDoctorSearch] = useState('');
  const clinical = !!workspace?.capabilities?.includes('clinical');
  const billing = !!workspace?.capabilities?.includes('billing');
  useEffect(() => {
    let active = true; setError('');
    Promise.all([api(`/clinic/dental-visits/${route.appointmentId}`), clinical ? api('/clinic/catalog') : [], clinical ? api('/clinic/referral-doctors') : { doctors: [], branches: [] }]).then(([visit, charges, names]) => {
      if (!active) return; setData(visit); setCatalog(charges.filter((c: any) => c.active)); setDirectory(names);
      const e = visit.encounter;
      setForm({ complaint: '', findings: '', diagnosis: '', advice: '', medication: '', consent: false, teeth: {}, lines: [], medicalHistory: visit.history[0]?.medicalHistory ?? visit.patient.medicalHistory, allergies: visit.history[0]?.allergies ?? visit.patient.allergies, ...e, surgeryDate: e?.surgeryDate?.slice(0,10) || '', nextVisit: e?.nextVisit ? new Date(new Date(e.nextVisit).getTime() - new Date(e.nextVisit).getTimezoneOffset()*60000).toISOString().slice(0,16) : '' });
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [route.appointmentId, tick, clinical]);
  const locked = !clinical || !!(data?.encounter && data.encounter.status !== 'DRAFT') || (data?.appointment?.status === 'COMPLETED' && !data?.encounter);
  function patch(key: string, value: any) { setForm((old: any) => ({ ...old, [key]: value })); }
  function linePatch(index: number, value: any) { patch('lines', form.lines.map((line: any, i: number) => i === index ? { ...line, ...value } : line)); }
  async function save(finalize: boolean) {
    if (saving || locked) return;
    setSaving(true); setError('');
    try {
      const fields: any = {};
      for (const key of ['complaint','findings','diagnosis','advice','medication','medicalHistory','allergies','consent','teeth','lines']) fields[key] = form[key];
      fields.surgeryDate = form.surgeryDate ? `${form.surgeryDate}T12:00:00.000Z` : null;
      fields.nextVisit = form.nextVisit ? new Date(form.nextVisit).toISOString() : null;
      fields.finalize = finalize;
      if (finalize && refer) fields.referral = { doctorId: referDoctor, branchId: referBranch || null, reason: referReason };
      const saved = await action(() => api(`/clinic/dental-visits/${route.appointmentId}`, 'PUT', fields), finalize ? refer ? 'Visit closed and referral sent to reception' : 'Visit closed and billing sent to reception' : 'Treatment draft saved');
      setData((old: any) => ({ ...old, encounter: saved }));
    } catch (e: any) { setError(e.message); } finally { setSaving(false); }
  }
  if (!data || !form) return <section className="panel dental-section">{error ? <p role="alert">{error}</p> : <p role="status">Loading dental treatment...</p>}</section>;
  const visitFee = (data.appointment.consultationPaise || 0) + (data.appointment.visitingConsultationPaise || 0) + (data.appointment.clinicFeePaise || 0);
  const treatmentFee = form.lines.reduce((s: number, l: any) => s + l.pricePaise + l.labChargePaise, 0);
  const referralTarget = directory.doctors.find((d: any) => d.id === referDoctor);
  const allowedBranches = referralTarget ? [...new Set([...(referralTarget.branchIds || []), ...(referralTarget.branchId ? [referralTarget.branchId] : [])])] : [];
  const currentCondition = form.teeth[selectedTooth] || { condition: 'Healthy', notes: '' };
  const names = [...directory.doctors, ...(data.doctors || [])];
  return <div className="dental-visit">
    <button className="text-button calendar-back" onClick={() => go('/clinic/appointments')}>Back to appointments</button>
    <header className="calendar-page-heading"><div><p className="calendar-eyebrow">DENTAL TREATMENT</p><h1>{data.patient.name}</h1><p>{data.patient.phone} - {day(data.appointment.startsAt)} - {names.find((d: any) => d.id === data.appointment.doctorId)?.name || 'Treating doctor'}</p></div><span className="badge">{data.encounter?.status || 'NEW VISIT'}</span></header>
    {error && <p className="error-banner" role="alert">{error}</p>}
    {data.appointment.referralId && <p className="dental-referral-notice">Internal referral visit. Previous treatments and clinical notes are preserved below.</p>}
    {data.referrals.filter((r: any) => r.id === data.appointment.referralId || r.encounterId === data.encounter?.id).map((r: any) => <p className="dental-referral-notice" key={r.id}><strong>Internal referral:</strong> {names.find((d: any) => d.id === r.fromDoctorId)?.name || 'Referring doctor'} to {names.find((d: any) => d.id === r.toDoctorId)?.name || 'Referred doctor'} - {r.reason} ({r.status.toLowerCase()})</p>)}

    {locked && <p className="dental-referral-notice">{clinical ? 'This clinical record is closed and read-only. Continue care in a new scheduled appointment.' : 'Clinical record supplied by the treating doctor.'}</p>}
    <section className="panel dental-section"><div className="calendar-page-heading"><h2>Patient details</h2><button type="button" className="secondary small" onClick={() => go(`/clinic/patients/${data.patient.id}`)}>Open patient record</button></div><div className="dental-form-grid"><p><strong>Name:</strong> {data.patient.name}<br /><strong>Phone:</strong> {data.patient.phone}<br /><strong>Email:</strong> {data.patient.email || '-'}</p><p><strong>Gender:</strong> {data.patient.gender}<br /><strong>Date of birth:</strong> {data.patient.dob ? day(data.patient.dob) : '-'}<br /><strong>Address:</strong> {data.patient.address || '-'}</p></div></section>
    <form onSubmit={e => { e.preventDefault(); save(false); }}>
      <fieldset disabled={locked || saving} className="dental-form-body">
        <section className="panel dental-section"><h2>Clinical assessment</h2><div className="dental-form-grid">{[['complaint','Chief complaint'],['medicalHistory','Medical history'],['allergies','Allergies'],['findings','Examination findings'],['diagnosis','Diagnosis'],['advice','Advice / home care']].map(([key, label]) => <label key={key}>{label}<textarea rows={3} value={form[key]} onChange={e => patch(key,e.target.value)} maxLength={10000} /></label>)}</div></section>
        <section className="panel dental-section"><h2>Tooth chart</h2><div className="dental-chart-toolbar"><label>Dentition<select value={dentition} onChange={e => setDentition(e.target.value)}><option value="permanent">Permanent teeth</option><option value="primary">Primary teeth</option></select></label><p>Select a tooth to record its condition or add treatment.</p></div>
          <div className="dental-tooth-chart">{(dentition === 'permanent' ? permanent : primary).map((row,i) => <div className="dental-tooth-row" key={i}>{row.map(n => <button type="button" key={n} aria-label={`Select tooth ${n}`} aria-pressed={selectedTooth===String(n)} className={`${selectedTooth===String(n) ? 'selected' : ''} ${form.teeth[n] && form.teeth[n].condition !== 'Healthy' ? 'affected' : ''}`} onClick={() => setSelectedTooth(String(n))}><span className="dental-tooth-shape" />{n}<small>{form.teeth[n]?.condition || 'Healthy'}</small></button>)}</div>)}</div>
          <div className="dental-form-grid"><label>Condition for tooth {selectedTooth}<select value={currentCondition.condition} onChange={e => patch('teeth', { ...form.teeth, [selectedTooth]: { ...currentCondition, condition: e.target.value } })}>{conditions.map(c => <option key={c}>{c}</option>)}</select></label><label>Tooth notes<input value={currentCondition.notes} onChange={e => patch('teeth', { ...form.teeth, [selectedTooth]: { ...currentCondition, notes: e.target.value } })} maxLength={1000} /></label></div>
        </section>
        <section className="panel dental-section"><div className="calendar-page-heading"><h2>Treatments performed & charges</h2><button type="button" className="secondary" onClick={() => patch('lines', [...form.lines, { tooth: selectedTooth, name: '', pricePaise: 0, labChargePaise: 0, labName: '', labNotes: '' }])}>Add treatment</button></div>
          {!form.lines.length && <p>Select a tooth and add its treatment. Consultation-only visits may be closed without a procedure.</p>}
          {form.lines.map((line: any, index: number) => <div className="dental-treatment-line" key={index}><div className="dental-form-grid">
            <label>Tooth number<input aria-label={`Treatment ${index+1} tooth`} value={line.tooth} onChange={e => linePatch(index,{ tooth:e.target.value })} maxLength={2} /></label>
            <label>Charge master<select aria-label={`Treatment ${index+1} charge master`} value={line.catalogItemId || ''} onChange={e => { const c = catalog.find(c => c.id === e.target.value); linePatch(index, c ? { catalogItemId: c.id, name: c.name, pricePaise: c.pricePaise, labChargePaise: c.labChargePaise } : { catalogItemId: undefined }); }}><option value="">Custom treatment / charge</option>{catalog.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
            <label>Treatment name<input aria-label={`Treatment ${index+1} name`} value={line.name} onChange={e => linePatch(index,{ name:e.target.value })} maxLength={200} /></label>
            <label>Treatment charge (rupees)<input aria-label={`Treatment ${index+1} fee`} type="number" min={0} step="0.01" value={rupees(line.pricePaise)} onChange={e => linePatch(index,{ pricePaise: paise(e.target.value) })} /></label>
            <label>Lab charge (rupees)<input aria-label={`Treatment ${index+1} lab fee`} type="number" min={0} step="0.01" value={rupees(line.labChargePaise)} onChange={e => linePatch(index,{ labChargePaise: paise(e.target.value) })} /></label>
            <label>Laboratory name<input aria-label={`Treatment ${index+1} lab name`} value={line.labName} onChange={e => linePatch(index,{ labName:e.target.value })} maxLength={200} /></label>
            <label>Lab instructions<textarea aria-label={`Treatment ${index+1} lab notes`} value={line.labNotes} onChange={e => linePatch(index,{ labNotes:e.target.value })} rows={2} maxLength={10000} /></label>
          </div><button type="button" className="text-button" onClick={() => patch('lines', form.lines.filter((_: any,i: number) => i!==index))}>Remove treatment</button></div>)}
          <div className="dental-total"><span>Visit fees {money(visitFee)}</span><span>Treatment & lab {money(treatmentFee)}</span><strong>Visit total {money(visitFee+treatmentFee)}</strong></div>
        </section>
        <section className="panel dental-section"><h2>Prescription & follow-up</h2><div className="dental-form-grid"><label>Prescription / medication<textarea value={form.medication} onChange={e => patch('medication',e.target.value)} rows={3} maxLength={10000} /></label><label>Surgery date (optional)<input type="date" value={form.surgeryDate} onChange={e => patch('surgeryDate',e.target.value)} /></label><label>Review date & time (optional)<input type="datetime-local" value={form.nextVisit} onChange={e => patch('nextVisit',e.target.value)} /></label></div><label className="dental-checkbox"><input type="checkbox" checked={form.consent} onChange={e => patch('consent',e.target.checked)} /> Patient consent recorded for treatment</label></section>
        <section className="panel dental-section"><label className="dental-checkbox"><input type="checkbox" role="switch" checked={refer} onChange={e => setRefer(e.target.checked)} /> Refer internally to another doctor</label>
          {refer && <div className="dental-form-grid"><label>Search referral doctor<input value={doctorSearch} onChange={e => setDoctorSearch(e.target.value)} placeholder="Search doctor name" /></label><label>Referral doctor<select value={referDoctor} onChange={e => { setReferDoctor(e.target.value); const d=directory.doctors.find((d: any) => d.id===e.target.value); setReferBranch(d?.branchId || ''); }}><option value="">Select doctor</option>{directory.doctors.filter((d: any) => d.id!==data.appointment.doctorId && d.name.toLowerCase().includes(doctorSearch.toLowerCase())).map((d: any) => <option key={d.id} value={d.id}>{d.name} - {d.specialty}</option>)}</select></label><label>Referral branch<select value={referBranch} onChange={e => setReferBranch(e.target.value)}><option value="">No branch assigned</option>{directory.branches.filter((b: any) => !allowedBranches.length || allowedBranches.includes(b.id)).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label><label>Referral reason<textarea value={referReason} onChange={e => setReferReason(e.target.value)} rows={3} maxLength={10000} /></label><p>The current visit closes when you submit. Reception receives this referral with the selected doctor and your treatment history.</p></div>}
        </section>
      </fieldset>
      {!locked && <div className="dental-save-actions"><button className="secondary" disabled={saving}>Save draft</button><button type="button" className="primary" disabled={saving} onClick={() => save(true)}>{saving ? 'Saving...' : refer ? 'Close visit & refer to reception' : 'Close visit & send billing'}</button></div>}
    </form>
    <VisitHistory history={data.history} doctors={names} plans={data.plans} items={data.items} />
    {billing && <VisitBilling invoices={data.invoices} modal={modal} action={action} />}
  </div>;
}

export function ReferralInbox({ go, workspace, action, modal, tick }: any) {
  const [data,setData] = useState<any>(null), [detail,setDetail] = useState<any>(null), [error,setError] = useState('');
  const [date,setDate] = useState(today), [time,setTime] = useState(''), [notes,setNotes] = useState(''), [clinicFee,setClinicFee] = useState(false), [busy,setBusy] = useState(false);
  const selected = new URLSearchParams(window.location.search).get('referral');
  const receptionist = workspace?.role !== 'DOCTOR';
  useEffect(() => { let active=true; setError(''); api('/clinic/internal-referrals').then(d => { if(active)setData(d); }).catch(e => {if(active)setError(e.message);}); if(selected && receptionist) api(`/clinic/internal-referrals/${selected}`).then(d => {if(active)setDetail(d);}).catch(e => {if(active)setError(e.message);}); else setDetail(null); return () => { active=false; }; },[selected,tick,receptionist]);
  async function schedule(e: React.FormEvent) { e.preventDefault(); setBusy(true); setError(''); try { const result=await action(() => api(`/clinic/internal-referrals/${selected}/schedule`,'POST',{ startsAt:new Date(`${date}T${time}`).toISOString(), useClinicFee:clinicFee, notes }), 'Referred appointment scheduled'); go(`/clinic/appointments/${date}/${result.doctorId}`); } catch(e:any){setError(e.message);} finally{setBusy(false);} }
  const doctorNames = new Map((data?.doctors || []).map((d:any)=>[d.id,d.name])), patientNames = new Map((data?.patients || []).map((p:any)=>[p.id,p]));
  return <div className="dental-visit"><header className="calendar-page-heading"><div><h1>Internal referrals</h1><p>Doctor handoffs, previous treatments, scheduling and reception billing.</p></div>{selected && <button className="secondary" onClick={()=>go('/clinic/referrals')}>Back to referrals</button>}</header>{error && <p className="error-banner" role="alert">{error}</p>}
    {selected && detail ? <>
      <section className="panel dental-section"><h2>Schedule referred patient</h2><div className="dental-form-grid"><label>Patient<input readOnly value={detail.patient.name} /></label><label>Referred doctor<input readOnly value={detail.doctor?.name || 'Doctor unavailable'} /></label></div><p><strong>Referral reason:</strong> {detail.referral.reason}</p><p>Consultant {money(detail.doctor?.consultationPaise)} / Visiting consultant {money(detail.doctor?.visitingConsultationPaise)}</p>
        {detail.referral.status==='PENDING' ? <form onSubmit={schedule}><fieldset disabled={busy || !detail.doctor?.active} className="dental-form-body"><div className="dental-form-grid"><label>Appointment date<input type="date" required value={date} onChange={e=>setDate(e.target.value)} /></label><label>Appointment time<input type="time" required value={time} onChange={e=>setTime(e.target.value)} /></label><label>Reception notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} /></label></div><label className="dental-checkbox"><input type="checkbox" checked={clinicFee} onChange={e=>setClinicFee(e.target.checked)} /> Include clinic fee {money(30000)}</label><button className="primary">{busy?'Scheduling...':'Schedule referred appointment'}</button></fieldset></form> : <p>This referral has been scheduled.</p>}
      </section>
      <VisitHistory history={detail.history || [detail.encounter]} doctors={data?.doctors} plans={detail.plans || []} items={detail.items || []} />
      {workspace?.capabilities?.includes('billing') && <VisitBilling invoices={detail.invoices} modal={modal} action={action} />}
    </> : !data ? <p role="status">Loading referrals...</p> : <section className="panel dental-section">{!data.rows.length ? <p>No internal referrals yet.</p> : <div className="table-wrap"><table><thead><tr><th>Patient</th><th>From doctor</th><th>Referred doctor</th><th>Reason</th><th>Status</th><th>Reception</th></tr></thead><tbody>{data.rows.map((r:any)=><tr key={r.id}><td>{(patientNames.get(r.patientId) as any)?.name || 'Patient'}<small>{(patientNames.get(r.patientId) as any)?.phone}</small></td><td>{String(doctorNames.get(r.fromDoctorId)||'Doctor')}</td><td>{String(doctorNames.get(r.toDoctorId)||'Doctor')}</td><td>{r.reason}</td><td><span className="badge">{r.status}</span></td><td>{receptionist && <button className="secondary small" onClick={()=>{setDetail(null);go(`/clinic/referrals?referral=${r.id}`);}}>Review & schedule</button>}</td></tr>)}</tbody></table></div>}</section>}
  </div>;
}
