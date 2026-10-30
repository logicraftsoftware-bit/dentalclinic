import { patientAge } from '../shared/patient-age';
import { formatBillNumber } from '../shared/bill-number';
import { billingLines, procedureCollections } from './billing-lines';
import React from 'react';
import { FileText, Mail } from 'lucide-react';

const amount = (paise: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

export function BillReceipt({ data, workspace, zone }: any) {
  const clinic = workspace?.tenant || {};
  const settings = clinic.settings || {};
  const { patient, appointment, invoices, payments = [], doctors = [] } = data;
  const branchName = data.branch?.name || clinic.name || 'Dental clinic';
  const branchAddress = data.branch ? data.branch.address : settings.address;
  const procedureRows = billingLines(invoices, payments);
  const collections = procedureCollections(procedureRows, payments);
  const active = invoices.filter((i: any) => i.status !== 'CANCELLED');
  const net = active.reduce((n: number, i: any) => n + i.totalPaise, 0);
  const discount = active.reduce((n: number, i: any) => n + (i.discountPaise || 0), 0);
  const paid = active.reduce((n: number, i: any) => n + i.paidPaise, 0);
  const adjustments = (data.adjustments || []).filter((e: any) => invoices.some((i: any) => i.id === e.invoiceId));
  const billDate = invoices[0]?.createdAt || appointment.createdAt;
  const date = (value: string, withTime = false) => new Intl.DateTimeFormat('en-IN', {
    timeZone: zone, day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(new Date(value));
  const billNumber = data.billNumber || formatBillNumber(appointment.id, billDate, zone);
  const visitDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(appointment.startsAt));
  const years = patientAge(patient, visitDate);
  const age = years === null ? '—' : `${years} years`;
  const doctorIds = new Set([appointment.doctorId, ...invoices.map((i: any) => i.doctorId).filter(Boolean)]);
  const doctorNames = doctors.filter((d: any) => doctorIds.has(d.id)).map((d: any) => d.name).join(', ') || '—';
  return <section className="reception-receipt" aria-label="Patient bill and payment receipt">
    <header className="receipt-letterhead">
      <div className="receipt-brand">
        {settings.logoUrl ? <img src={settings.logoUrl} alt="Clinic logo" /> : <svg className="receipt-tooth" viewBox="0 0 64 72" aria-hidden="true"><defs><linearGradient id="receipt-tooth-gradient"><stop stopColor="#51b99d" /><stop offset="1" stopColor="#075779" /></linearGradient></defs><path d="M32 12C19 3 7 7 8 23c1 12 6 36 13 39 5 2 6-20 11-20s6 22 11 20c7-3 12-27 13-39C57 7 45 3 32 12Z" fill="none" stroke="url(#receipt-tooth-gradient)" strokeWidth="7" strokeLinejoin="round" /></svg>}
        <div><h1>{branchName}</h1>{branchAddress && <p className="receipt-branch-address">{branchAddress}</p>}</div>
      </div>
      <div className="receipt-contact">
        {settings.contactEmail && <p><Mail />{settings.contactEmail}</p>}
      </div>
    </header>
    <div className="receipt-title-row">
      <div><h2>PATIENT BILL / PAYMENT RECEIPT</h2><p>{settings.invoiceHeader || 'Thank you for trusting us with your smile.'}</p></div>
      <dl className="receipt-invoice-meta"><dt>Bill No</dt><dd>{billNumber}</dd><dt>Bill Date</dt><dd>{date(billDate, true)}</dd><dt>Visit Date</dt><dd>{date(appointment.startsAt)}</dd></dl>
    </div>
    <div className="receipt-patient-info">
      <dl><dt>Patient Name</dt><dd><strong>{patient.name}</strong></dd><dt>Patient ID</dt><dd>{patient.id.slice(0, 8).toUpperCase()}</dd><dt>Phone No</dt><dd>{patient.phone || '—'}</dd><dt>Age / Gender</dt><dd>{age} / {patient.gender === 'Unspecified' ? '—' : patient.gender || '—'}</dd></dl>
      <dl><dt>Doctor</dt><dd>{doctorNames}</dd><dt>Visit Type</dt><dd>{appointment.reason || 'Consultation'}</dd><dt>Clinic</dt><dd>{branchName}</dd><dt>Patient Address</dt><dd>{patient.address || '—'}</dd></dl>
    </div>
    <table className="receipt-charge-table receipt-procedure-table"><thead><tr><th>#</th><th>Procedure / Doctor</th><th>Gross (₹)</th><th>Discount (₹)</th><th>Net (₹)</th><th>Collected (₹)<small>Last payment</small></th><th>Method</th><th>Paid (₹)</th><th>Balance (₹)</th></tr></thead><tbody>{procedureRows.map((r: any, index: number) => <tr key={r.key}><td>{index + 1}</td><td>{r.name}{r.invoices.every((i: any) => i.status === 'CANCELLED') && <small><strong>CANCELLED — original receipt retained; paid amount moved to credit</strong></small>}<small>{doctors.find((d: any) => d.id === r.doctorId)?.name || ''}</small>{r.lab > 0 && <small>Includes lab: ₹{amount(r.lab)}</small>}</td><td>{amount(r.gross)}</td><td>{amount(r.discount)}</td><td>{amount(r.invoices.every((i: any) => i.status === 'CANCELLED') ? 0 : r.net)}</td><td>{amount(r.collected)}</td><td>{r.methods}</td><td>{amount(r.paid)}</td><td>{amount(r.invoices.every((i: any) => i.status === 'CANCELLED') ? 0 : r.net - r.paid)}</td></tr>)}</tbody></table>
    <section className="receipt-summary"><h3>Summary</h3><dl><dt>Subtotal (Gross Amount)</dt><dd>₹{amount(net + discount)}</dd><dt>Total Discount</dt><dd>₹{amount(discount)}</dd><dt className="receipt-highlight">Net Payable</dt><dd className="receipt-highlight">₹{amount(net)}</dd><dt>Total Paid</dt><dd>₹{amount(paid)}</dd><dt className="receipt-highlight">Outstanding Balance</dt><dd className={`receipt-highlight ${net > paid ? 'receipt-outstanding' : ''}`}>₹{amount(net - paid)}</dd></dl></section>
    <section className="receipt-payment-history receipt-procedure-history"><h3>Payment History</h3><table><thead><tr><th>#</th><th>Collection No</th><th>Procedure</th><th>Date & Time</th><th>Method</th><th>Reference</th><th>Amount (₹)</th></tr></thead><tbody>{collections.map((p: any, index: number) => <tr key={p.id}><td>{index + 1}</td><td>{p.collectionNo}</td><td>{p.name}</td><td>{date(p.createdAt, true)}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{amount(p.amountPaise)}</td></tr>)}{!collections.length && <tr><td colSpan={7}>No payments recorded.</td></tr>}</tbody></table></section>
    {adjustments.length > 0 && <section className="receipt-payment-history"><h3>Cancellations, patient credit & refunds</h3><p>Available patient credit across all visits: ₹{amount(data.creditBalancePaise || 0)}</p><table><thead><tr><th>Date</th><th>Action / Procedure</th><th>Reason / User</th><th>Credit movement (₹)</th><th>Mode / Reference</th></tr></thead><tbody>{adjustments.map((e: any) => <tr key={e.id}><td>{date(e.createdAt)}</td><td>{e.type === 'CANCEL' ? 'Cancelled' : e.type === 'REFUND' ? 'Refund' : 'Credit used'}<small>{invoices.find((i: any) => i.id === e.invoiceId)?.description}</small>{e.type === 'CANCEL' && <small>Cancelled bill: ₹{amount(e.cancelledPaise)}</small>}</td><td>{e.reason}<small>{e.actorName}</small></td><td>{amount(e.amountPaise)}</td><td>{e.method}<small>{e.reference}</small></td></tr>)}</tbody></table></section>}
    <aside className="receipt-note"><FileText /><div><strong>Note:</strong><ol><li>This is a computer generated bill and does not require a signature.</li><li>{settings.invoiceFooter || 'Thank you for trusting us with your smile.'}</li></ol></div></aside>
    <footer className="receipt-footer"><div><strong>{branchName}</strong><p>{settings.tagline || 'Your Oral Health, Our Priority'}</p></div>{settings.website && <span>{settings.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}</footer>
  </section>;
}
