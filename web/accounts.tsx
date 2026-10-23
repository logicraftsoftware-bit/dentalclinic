import React, { useEffect, useState } from 'react';
import { Download, Wallet } from 'lucide-react';
import { api, money } from './api';

const columns = [['gross', 'Gross'], ['discount', 'Discount'], ['net', 'Net billed'], ['collected', 'Collected'], ['commission', 'Doctor commission'], ['paidCommission', 'Commission paid'], ['dueCommission', 'Commission due'], ['clinic', 'Clinic share'], ['outstanding', 'Patient balance']] as const;
export function Accounts({ tick }: any) {
  const [filters, setFilters] = useState({ from: '', to: '', doctorId: '', procedure: '' });
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('doctors');
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/clinic/accounts?${query}`).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, tick]);
  const change = (key: string, value: string) => setFilters(old => ({ ...old, [key]: value }));
  const rows = data ? data[tab] : [];
  const detailed = tab === 'rows';
  function download() {
    const heading = detailed ? ['Invoice date', 'Patient', 'Doctor', 'Procedure', 'Charge type', 'Receipts (date / method / reference / amount)'] : [tab === 'doctors' ? 'Doctor' : 'Procedure', 'Invoice lines'];
    const values = rows.map((r: any) => [...(detailed ? [r.date, r.patient, r.doctor, r.procedure, r.kind, r.receipts.map((p: any) => `${p.date} / ${p.method} / ${p.reference || '-'} / ${(p.amount / 100).toFixed(2)}`).join('; ')] : [r.label, r.count]), ...columns.map(([key]) => (r[key] / 100).toFixed(2))]);
    const escape = (value: any) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [[...heading, ...columns.map(([, label]) => `${label} (INR)`)], ...values].map(row => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `accounts-${tab}-${filters.from || 'all'}-${filters.to || 'time'}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="accounts-page">
    <div className="accounts-title"><div><h1>Accounts</h1><p>Doctor earnings, procedure revenue and your clinic’s share in one place.</p></div><button className="secondary" onClick={download} disabled={loading || !!error || !rows.length}><Download size={16} />Export report</button></div>
    <section className="panel accounts-filters" aria-label="Account report filters">
      <label>From date<input type="date" value={filters.from} max={filters.to || undefined} onChange={e => change('from', e.target.value)} /></label>
      <label>To date<input type="date" value={filters.to} min={filters.from || undefined} onChange={e => change('to', e.target.value)} /></label>
      <label>Doctor<select value={filters.doctorId} onChange={e => change('doctorId', e.target.value)}><option value="">All doctors & clinic</option>{data?.doctorOptions.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Procedure / charge<select value={filters.procedure} onChange={e => change('procedure', e.target.value)}><option value="">All procedures & charges</option>{data?.procedureOptions.map((name: string) => <option key={name} value={name}>{name}</option>)}</select></label>
      <button className="secondary" onClick={() => setFilters({ from: '', to: '', doctorId: '', procedure: '' })}>Reset</button>
    </section>
    {loading ? <p role="status">Loading accounts report...</p> : error ? <p className="error-banner" role="alert">{error}</p> : data && <>
      <div className="accounts-metrics">{[['collected', 'Total collected'], ['commission', 'Doctor commission'], ['clinic', 'Clinic share'], ['dueCommission', 'Commission to pay']].map(([key, label]) => <section className={`panel accounts-metric accounts-metric-${key}`} key={key}><span>{label}</span><strong>{money(data.totals[key])}</strong><small>{key === 'clinic' ? 'Collections less doctor commission' : key === 'dueCommission' ? 'Unpaid portion of selected receipt commissions' : key === 'commission' ? 'Saved commission on selected receipts' : 'Payments received in selected dates'}</small></section>)}</div>
      <section className="panel accounts-report">
        <div className="accounts-report-heading"><div><h2>Detailed account report</h2><p>{filters.from || filters.to ? `${filters.from || 'Beginning'} to ${filters.to || 'present'}` : 'All time'} · Amounts in INR</p></div><Wallet size={20} /></div>
        <div className="accounts-tabs" aria-label="Report views">{[['doctors', 'Doctor wise'], ['procedures', 'Procedure wise'], ['rows', 'Invoice & payment details']].map(([key, label]) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</div>
        <p className="accounts-note">Billed amounts follow invoice dates; collections and commissions follow payment dates. Patient balance is the current unpaid amount on invoices issued in the selected dates. Commission paid/due reflects current payout status. Clinic share is before lab costs and other expenses. Lab and visit charges remain separate report lines.</p>
        {rows.length ? <div className="table-wrap"><table className="accounts-table"><thead><tr>{detailed ? <><th>Invoice date / Patient</th><th>Doctor</th><th>Procedure / Charge</th><th>Receipts</th></> : <><th>{tab === 'doctors' ? 'Doctor' : 'Procedure / Charge'}</th><th>Invoice lines</th></>}{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((r: any, index: number) => <tr key={r.id || index}>{detailed ? <><td>{r.date}<small>{r.patient}</small></td><td>{r.doctor}</td><td>{r.procedure}<small>{r.kind}</small></td><td>{r.receipts.length ? r.receipts.map((p: any, i: number) => <small key={i}>{p.date} · {p.method} · {money(p.amount)}{p.reference ? ` · ${p.reference}` : ''}</small>) : 'No receipts in period'}</td></> : <><td><strong>{r.label}</strong></td><td>{r.count}</td></>}{columns.map(([key]) => <td className={key === 'clinic' ? 'accounts-clinic-amount' : ''} key={key}>{money(r[key])}</td>)}</tr>)}</tbody><tfoot><tr><th colSpan={detailed ? 4 : 2}>Total</th>{columns.map(([key]) => <td key={key}>{money(data.totals[key])}</td>)}</tr></tfoot></table></div> : <div className="accounts-empty"><Wallet size={28} /><h3>No account activity found</h3><p>Try another date range or clear the doctor and procedure filters.</p></div>}
      </section>
    </>}
  </div>;
}
