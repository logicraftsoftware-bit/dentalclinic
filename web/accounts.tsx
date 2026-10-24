import React, { useEffect, useState } from 'react';
import { Download, Wallet, Coins, Stethoscope, ChartPie, FileClock, ChartNoAxesCombined, UserRound, FileText, ClipboardList } from 'lucide-react';
import { api, money } from './api';

const columns = [['gross', 'Gross'], ['discount', 'Discount'], ['net', 'Net billed'], ['collected', 'Collected'], ['commission', 'Doctor commission'], ['paidCommission', 'Commission paid'], ['dueCommission', 'Commission due'], ['clinic', 'Clinic share'], ['outstanding', 'Patient balance']] as const;
function AccountCharts({ data }: { data: any }) {
  const groups = data.paymentMethods;
  const maximum = Math.max(1, ...groups.map((r: any) => r.amount));
  const colors = ['#009b72', '#258bff', '#ff9018', '#8952f9'];
  const total = data.totals.collected;
  const percent = (value: number) => total > 0 ? Math.round(value / total * 100) : 0;
  return <div className="accounts-charts">
    <section className="panel accounts-chart-panel"><h2><ChartNoAxesCombined size={22} />Collections by Payment Method</h2>
      <div className="accounts-chart-legend">{groups.map((r: any, i: number) => <span key={r.method}><i className="accounts-dot" style={{ background: colors[i % colors.length] }} />Total {r.method}</span>)}</div>
      {total > 0 ? <div className="accounts-bars-scroll"><div className="accounts-bars" style={{ minWidth: Math.max(280, groups.length * 150) }}>{groups.map((r: any, i: number) => <div className="accounts-bar-group" key={r.method}><div className="accounts-bar-columns"><div className="accounts-bar-track"><div className="accounts-bar" style={{ height: `${r.amount / maximum * 100}%`, background: colors[i % colors.length] }} role="img" aria-label={`Total ${r.method}: ${money(r.amount)}`} title={`Total ${r.method}: ${money(r.amount)}`}><span>{money(r.amount)}</span></div></div></div><span className="accounts-bar-label">Total {r.method}</span></div>)}</div></div> : <p className="accounts-chart-empty">No collections to display for this selection.</p>}
    </section>
    <section className="panel accounts-chart-panel"><h2><ChartPie size={22} />Revenue Distribution</h2><div className="accounts-distribution">
      <div className="accounts-donut" role="img" aria-label={`Total collected ${money(total)}. Clinic share ${percent(data.totals.clinic)} percent; doctor commission ${percent(data.totals.commission)} percent.`} style={{ background: total > 0 ? `conic-gradient(#009b72 0% ${data.totals.clinic / total * 100}%, #258bff ${data.totals.clinic / total * 100}% 100%)` : '#e8eef4' }}><div><strong>{money(total)}</strong><span>Total collected</span></div></div>
      <div className="accounts-distribution-legend">{[['clinic', 'Clinic share'], ['commission', 'Doctor commission'], ['dueCommission', 'Pending commission']].map(([key, label]) => <div key={key}><span><i className={`accounts-dot accounts-color-${key}`} />{label}</span><strong>{money(data.totals[key])}</strong><small>{percent(data.totals[key])}%</small></div>)}<p>Pending commission is included in doctor commission.</p></div>
    </div></section>
  </div>;
}
export function Accounts({ tick }: any) {
  const [filters, setFilters] = useState({ period: 'all', from: '', to: '', doctorId: '', procedure: '' });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [data, setData] = useState<any>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('doctors');
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    api(`/clinic/accounts?${query}`).then(result => { if (active) setData(result); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, tick]);
  const change = (key: string, value: string) => setDraftFilters(old => ({ ...old, ...(['from', 'to'].includes(key) && old.period !== 'custom' ? { from: data?.filters?.from || '', to: data?.filters?.to || '' } : {}), [key]: value, ...(['from', 'to'].includes(key) ? { period: 'custom' } : {}) }));
  const reportFrom = data?.filters?.from || '';
  const reportTo = data?.filters?.to || '';
  const rows = data ? data[tab] : [];
  const detailed = tab === 'rows';
  function download() {
    const heading = detailed ? ['Invoice date', 'Patient', 'Doctor', 'Procedure', 'Charge type', 'Receipts (date / method / reference / amount)'] : [tab === 'doctors' ? 'Doctor' : 'Procedure', 'Invoice lines'];
    const values = rows.map((r: any) => [...(detailed ? [r.date, r.patient, r.doctor, r.procedure, r.kind, r.receipts.map((p: any) => `${p.date} / ${p.method} / ${p.reference || '-'} / ${(p.amount / 100).toFixed(2)}`).join('; ')] : [r.label, r.count]), ...columns.map(([key]) => (r[key] / 100).toFixed(2))]);
    const escape = (value: any) => `"${String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [[...heading, ...columns.map(([, label]) => `${label} (INR)`)], ...values].map(row => row.map(escape).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `accounts-${tab}-${reportFrom || 'all'}-${reportTo || 'time'}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="accounts-page">
    <div className="accounts-title"><div className="accounts-title-copy"><span className="accounts-title-icon"><ClipboardList size={27} /></span><div><h1>Accounts</h1><p>Doctor earnings, procedure revenue and your clinic’s share in one place.</p></div></div><button className="secondary" onClick={download} disabled={loading || !!error || !rows.length}><Download size={16} />Export report</button></div>
    <form className="panel accounts-filters" aria-label="Account report filters" onSubmit={event => { event.preventDefault(); setFilters({ ...draftFilters }); }}>
      <label>Date range<select value={draftFilters.period} onChange={e => {
        const period = e.target.value;
        const next = { ...draftFilters, period, ...(period === 'custom' ? { from: reportFrom, to: reportTo } : { from: '', to: '' }) };
        setDraftFilters(next);
        if (period !== 'custom') setFilters(next);
      }}><option value="all">All</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7days">Last 7 days</option><option value="1month">Last 1 month</option><option value="3months">Last 3 months</option><option value="6months">Last 6 months</option><option value="custom">Custom date range</option></select></label>
      <label>From date<input type="date" value={draftFilters.period === 'custom' ? draftFilters.from : reportFrom} max={(draftFilters.period === 'custom' ? draftFilters.to : reportTo) || undefined} onChange={e => change('from', e.target.value)} /></label>
      <label>To date<input type="date" value={draftFilters.period === 'custom' ? draftFilters.to : reportTo} min={(draftFilters.period === 'custom' ? draftFilters.from : reportFrom) || undefined} onChange={e => change('to', e.target.value)} /></label>
      <label>Doctor<select value={draftFilters.doctorId} onChange={e => change('doctorId', e.target.value)}><option value="">All doctors & clinic</option>{data?.doctorOptions.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>Procedure / charge<select value={draftFilters.procedure} onChange={e => change('procedure', e.target.value)}><option value="">All procedures & charges</option>{data?.procedureOptions.map((name: string) => <option key={name} value={name}>{name}</option>)}</select></label>
      <button className="primary" type="submit">Apply</button>
      <button type="button" className="secondary" onClick={() => { const empty = { period: 'all', from: '', to: '', doctorId: '', procedure: '' }; setFilters(empty); setDraftFilters(empty); }}>Reset</button>
    </form>
    {loading ? <p role="status">Loading accounts report...</p> : error ? <p className="error-banner" role="alert">{error}</p> : data && <>
      <div className="accounts-metrics">{[['collected', 'Total collected', Coins], ['commission', 'Doctor commission', Stethoscope], ['clinic', 'Clinic share', ChartPie], ['dueCommission', 'Commission to pay', FileClock]].map(([key, label, Icon]: any) => <section className={`panel accounts-metric accounts-metric-${key}`} key={key}><span className="accounts-metric-icon"><Icon size={27} /></span><div><span>{label}</span><strong>{money(data.totals[key])}</strong><small>{key === 'clinic' ? 'Collections less doctor commission' : key === 'dueCommission' ? 'Unpaid portion of receipt commissions' : key === 'commission' ? 'Saved commission on receipts' : 'Payments received in selected dates'}</small></div></section>)}</div>
      <AccountCharts data={data} />
      <section className="panel accounts-report">
        <div className="accounts-report-heading"><div className="accounts-title-copy"><ChartNoAxesCombined size={26} /><div><h2>Detailed account report</h2><p>{reportFrom || reportTo ? `${reportFrom || 'Beginning'} to ${reportTo || 'present'}` : 'All time'} · Amounts in INR</p></div></div><button className="secondary" onClick={download} disabled={!rows.length}><Download size={16} />Download CSV</button></div>
        <div className="accounts-tabs" aria-label="Report views">{[['doctors', 'Doctor wise', UserRound], ['procedures', 'Procedure wise', Stethoscope], ['rows', 'Invoice & payment details', FileText]].map(([key, label, Icon]: any) => <button key={key} aria-pressed={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={19} />{label}</button>)}</div>
        <details className="accounts-note"><summary>How these amounts are calculated</summary><p>Billed amounts follow invoice dates; collections and commissions follow payment dates. Patient balance is the current unpaid amount on invoices issued in the selected dates. Commission paid/due reflects current payout status. Clinic share is before lab costs and other expenses. Lab and visit charges remain separate report lines.</p></details>
        {rows.length ? <div className="table-wrap"><table className="accounts-table"><thead><tr>{detailed ? <><th>Invoice date / Patient</th><th>Doctor</th><th>Procedure / Charge</th><th>Receipts</th></> : <><th>{tab === 'doctors' ? 'Doctor' : 'Procedure / Charge'}</th><th>Invoice lines</th></>}{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead><tbody>{rows.map((r: any, index: number) => <tr key={r.id || index}>{detailed ? <><td>{r.date}<small>{r.patient}</small></td><td>{r.doctor}</td><td>{r.procedure}<small>{r.kind}</small></td><td>{r.receipts.length ? r.receipts.map((p: any, i: number) => <small key={i}>{p.date} · {p.method} · {money(p.amount)}{p.reference ? ` · ${p.reference}` : ''}</small>) : 'No receipts in period'}</td></> : <><td><strong>{r.label}</strong></td><td>{r.count}</td></>}{columns.map(([key]) => <td className={key === 'clinic' ? 'accounts-clinic-amount' : ''} key={key}>{money(r[key])}</td>)}</tr>)}</tbody><tfoot><tr><th colSpan={detailed ? 4 : 2}>Total</th>{columns.map(([key]) => <td key={key}>{money(data.totals[key])}</td>)}</tr></tfoot></table></div> : <div className="accounts-empty"><Wallet size={28} /><h3>No account activity found</h3><p>Try another date range or clear the doctor and procedure filters.</p></div>}
      </section>
    </>}
  </div>;
}
