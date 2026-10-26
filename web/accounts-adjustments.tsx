import React from 'react';
import { money } from './api';

export function AdjustmentAudit({ data }: any) {
  function download() {
    const heading = ['Record ID', 'Date and time', 'Patient', 'Invoice ID', 'Source cancellation ID', 'Source invoice ID', 'Procedure', 'Action', 'Reason', 'User', 'User ID', 'Mode', 'Reference', 'Cancelled INR', 'Credit movement INR', 'Commission reversed INR', 'Paid commission to recover INR'];
    const escape = (v: any) => `"${String(v ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const rows = data.activity.map((e: any) => [e.id, e.createdAt, e.patient, e.invoiceId, e.sourceId, e.sourceInvoiceId, e.procedure, e.type, e.reason, e.actorName, e.actorId, e.method, e.reference, (e.cancelledPaise / 100).toFixed(2), (e.amountPaise / 100).toFixed(2), (e.commissionReversalPaise / 100).toFixed(2), (e.paidCommissionRecoveryPaise / 100).toFixed(2)]);
    const url = URL.createObjectURL(new Blob(['\uFEFF', [heading, ...rows].map(r => r.map(escape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cancellations-credit-refunds.csv'; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel accounts-report"><div className="accounts-report-heading"><div><h2>Cancellation, credit & refund audit</h2><p>Selected dates and doctor / procedure filters apply. Each record retains its reason and user.</p></div><button className="secondary" disabled={!data.activity.length} onClick={download}>Export audit CSV</button></div><div className="table-wrap"><table><thead><tr><th>Date / Patient</th><th>Action / Procedure</th><th>Reason / User</th><th>Cancelled charges</th><th>Credit movement</th><th>Mode / Reference</th><th>Commission reversed / To recover</th></tr></thead><tbody>{data.activity.map((e: any) => <tr key={e.id}><td>{e.date}<small>{e.patient}</small><small>Record {e.id.slice(0, 8).toUpperCase()}</small></td><td>{e.type === 'CANCEL' ? 'Procedure cancelled' : e.type === 'REFUND' ? 'Refund recorded' : 'Patient credit used'}<small>{e.procedure}</small></td><td>{e.reason}<small>{e.actorName}</small></td><td>{money(e.cancelledPaise)}</td><td>{money(e.amountPaise)}</td><td>{e.method}<small>{e.reference}</small></td><td>{money(e.commissionReversalPaise)}<small>To recover: {money(e.paidCommissionRecoveryPaise)}</small></td></tr>)}{!data.activity.length && <tr><td colSpan={7}>No cancellations, credit uses or refunds in this selection.</td></tr>}</tbody></table></div></section>;
}
