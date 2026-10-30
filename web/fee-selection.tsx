import { useEffect, useState } from 'react';
import { api, money } from './api';
import { SearchableSelect } from './searchable-select';
import { chargeDepartment, chargeDepartments } from './charge-groups';

export type FeeSelection = {
  clinicFee: boolean; general: boolean; speciality: boolean; department: string;
  lines: { key: string; catalogItemId: string; doctorId: string; department: string }[];
  status: string; method: string; amount: string | null;
};
export const initialFees = (): FeeSelection => ({ clinicFee: false, general: false, speciality: false, department: '', lines: [], status: 'PAID', method: 'CASH', amount: null });
export function feeTotal(value: FeeSelection, charges: any[], extra = 0) {
  return (value.clinicFee ? 30000 : 0) + extra + value.lines.reduce((sum, line) => {
    const charge = charges.find(c => c.id === line.catalogItemId);
    return sum + (charge?.pricePaise || 0) + (charge?.labChargePaise || 0);
  }, 0);
}
export function feePayload(value: FeeSelection, total: number, checkoutKey: string) {
  return { checkoutKey, clinicFee: value.clinicFee, lines: value.lines.map(({ key, ...line }) => line), payment: { status: value.status, method: value.method, amountPaise: value.status === 'PENDING' ? 0 : value.status === 'PAID' ? total : Math.round(Number(value.amount || 0) * 100) } };
}

export function FeeSelectionFields({ value, onChange, charges, groups, doctors, extraTotal = 0, showPayment = true, showClinicFee = true }: { value: FeeSelection; onChange: (value: FeeSelection) => void; charges: any[]; groups: any[]; doctors: any[]; extraTotal?: number; showPayment?: boolean; showClinicFee?: boolean }) {
  const [generalCharge, setGeneralCharge] = useState(''), [specialCharge, setSpecialCharge] = useState('');
  const total = feeTotal(value, charges, extraTotal);
  const update = (patch: Partial<FeeSelection>) => onChange({ ...value, ...patch });
  const available = (department: string) => charges.filter(c => c.active && groups.some(g => g.id === c.chargeGroupId && g.active && chargeDepartment(g) === department));
  function category(department: string, general: boolean) {
    const selected = general ? generalCharge : specialCharge;
    const setSelected = general ? setGeneralCharge : setSpecialCharge;
    const label = general ? 'General Dentistry' : 'Speciality';
    const procedures = available(department);
    return <div className="fee-category">
      <SearchableSelect key={department} label={`${label} procedure`} placeholder={`Select ${general ? 'General Dentistry' : 'speciality'} procedure`} searchLabel={`Search ${label} procedures`} options={groups.flatMap(g => procedures.filter(c => c.chargeGroupId === g.id).map(c => ({ value: c.id, label: `${c.name} — ${money(c.pricePaise + (c.labChargePaise || 0))}`, group: g.name })))} value={selected} onChange={setSelected} />
      <button type="button" className="secondary small" disabled={!selected || value.lines.length >= 50} onClick={() => { update({ lines: [...value.lines, { key: crypto.randomUUID(), catalogItemId: selected, doctorId: '', department }] }); setSelected(''); }}>Add {general ? 'general dentistry' : 'speciality'} procedure</button>
    </div>;
  }
  return <>
    <fieldset className="fee-selection"><legend>Fees</legend>
      <div className="fee-type-options">
        {showClinicFee && <label className="appointment-fee-option"><input type="checkbox" checked={value.clinicFee} onChange={e => update({ clinicFee: e.target.checked })} /><span>Clinic fee<strong>{money(30000)}</strong></span></label>}
        <label className="appointment-fee-option"><input type="checkbox" checked={value.general} onChange={e => { setGeneralCharge(''); update({ general: e.target.checked, lines: value.lines.filter(l => l.department !== chargeDepartments[0]) }); }} /><span>General Dentistry Bill</span></label>
        <label className="appointment-fee-option"><input type="checkbox" checked={value.speciality} onChange={e => { setSpecialCharge(''); update({ speciality: e.target.checked, department: '', lines: value.lines.filter(l => l.department === chargeDepartments[0]) }); }} /><span>Speciality Treatment Bill</span></label>
      </div>
      {value.general && <section aria-label="General Dentistry Bill procedures"><h3>General Dentistry Bill</h3>{category(chargeDepartments[0], true)}</section>}
      {value.speciality && <section aria-label="Speciality Treatment Bill procedures"><h3>Speciality Treatment Bill</h3><label>Department<select aria-label="Department" value={value.department} onChange={e => { setSpecialCharge(''); update({ department: e.target.value }); }}><option value="">Select speciality department</option>{chargeDepartments.slice(1).map(name => <option key={name} value={name}>{name}</option>)}</select></label>{value.department && category(value.department, false)}</section>}
      {value.lines.map(line => {
        const charge = charges.find(c => c.id === line.catalogItemId);
        return <div className="fee-selected-procedure" key={line.key}><p><strong>{charge?.name}</strong><small>{line.department}</small></p><p>Procedure: {money(charge?.pricePaise || 0)} · Lab: {money(charge?.labChargePaise || 0)}</p><label>Treating doctor<select required aria-label={`Treating doctor for ${charge?.name}`} value={line.doctorId} onChange={e => update({ lines: value.lines.map(l => l.key === line.key ? { ...l, doctorId: e.target.value } : l) })}><option value="">Select {line.department === chargeDepartments[0] ? 'general dentist' : 'speciality doctor'}</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.name}{d.specialty ? ` — ${d.specialty}` : ''}</option>)}</select></label><button type="button" className="text-button" onClick={() => update({ lines: value.lines.filter(l => l.key !== line.key) })}>Remove {charge?.name}</button></div>;
      })}
      <p className="appointment-selection" aria-live="polite">Total fees: <strong>{money(total)}</strong></p>
    </fieldset>
    {showPayment && <fieldset><legend>Payment</legend><div className="form-fields">
      <label>Payment status<select aria-label="Payment status" value={value.status} onChange={e => update({ status: e.target.value, amount: e.target.value === 'PARTIAL' ? '' : null })}><option value="PAID">Paid</option><option value="PARTIAL">Part paid</option><option value="PENDING">Unpaid</option></select></label>
      <label>Payment mode<select aria-label="Payment mode" disabled={value.status === 'PENDING'} value={value.method} onChange={e => update({ method: e.target.value })}>{['CASH', 'UPI', 'CARD', 'BANK'].map(method => <option key={method} value={method}>{method === 'CASH' ? 'Cash' : method === 'CARD' ? 'Card' : method === 'BANK' ? 'Bank transfer' : method}</option>)}</select></label>
      <label>Paid amount (₹)<input type="number" min={value.status === 'PARTIAL' ? '0.01' : '0'} max={value.status === 'PARTIAL' ? Math.max(0, total - 1) / 100 : total / 100} step="0.01" required disabled={value.status === 'PENDING'} value={value.status === 'PENDING' ? '0' : value.status === 'PAID' ? String(total / 100) : value.amount ?? ''} onChange={e => update({ amount: e.target.value, status: e.target.value !== '' && Math.round(Number(e.target.value) * 100) === total ? 'PAID' : 'PARTIAL' })} /></label>
    </div><p>Balance: {money(total - (value.status === 'PENDING' ? 0 : value.status === 'PAID' ? total : Math.round(Number(value.amount ?? total / 100) * 100)))}</p></fieldset>}
  </>;
}

export function FeeBillDialog({ action, close }: any) {
  const [fees, setFees] = useState(initialFees), [data, setData] = useState<any>(null), [patientId, setPatientId] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [checkoutKey] = useState(() => crypto.randomUUID());
  useEffect(() => { let active = true; Promise.all(['billing-patients', 'charges', 'charge-groups', 'doctors'].map(resource => api(`/clinic/${resource}`))).then(([patients, charges, groups, doctors]) => { if (active) setData({ patients, charges, groups, doctors }); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, []);
  const total = feeTotal(fees, data?.charges || []);
  const branchId = data?.patients.find((p: any) => p.id === patientId)?.branchId;
  return <div className="modal-backdrop"><section className="modal fee-bill-dialog" role="dialog" aria-modal="true" aria-label="Create bill"><div className="panel-heading"><h2>Create bill</h2><button type="button" className="secondary small" disabled={busy} onClick={close}>Close</button></div>{error && <p role="alert" className="error-banner">{error}</p>}{!data ? <p>Loading fees...</p> : <form onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await action(() => api('/clinic/fee-bills', 'POST', { patientId, ...feePayload(fees, total, checkoutKey) }), 'Bill and payment saved', { reportError: false }); close(); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}><fieldset disabled={busy}><label>Patient<select aria-label="Patient" required value={patientId} onChange={e => setPatientId(e.target.value)}><option value="">Select patient</option>{data.patients.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {p.phone}</option>)}</select></label><FeeSelectionFields value={fees} onChange={setFees} {...data} doctors={data.doctors.filter((d: any) => d.active && (!branchId || (!d.branchId && !d.branchIds?.length) || d.branchId === branchId || d.branchIds?.includes(branchId)))} /><button className="primary" disabled={busy || total <= 0 || (fees.general && !fees.lines.some(l => l.department === chargeDepartments[0])) || (fees.speciality && !fees.lines.some(l => l.department !== chargeDepartments[0]))}>{busy ? 'Saving...' : 'Save bill and payment'}</button></fieldset></form>}</section></div>;
}
