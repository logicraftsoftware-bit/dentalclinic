import React from 'react';
import { FileText, Mail, MapPin, Phone } from 'lucide-react';

const amount = (paise: number) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);

export function BillReceipt({ data, workspace, zone }: any) {
  const clinic = workspace?.tenant || {};
  const settings = clinic.settings || {};
  const { patient, appointment, invoices, payments = [], doctors = [] } = data;
  const net = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0);
  const discount = invoices.reduce((n: number, i: any) => n + (i.discountPaise || 0), 0);
  const paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
  const billDate = invoices[0]?.createdAt || appointment.createdAt;
  const date = (value: string, withTime = false) => new Intl.DateTimeFormat('en-IN', {
    timeZone: zone, day: '2-digit', month: 'short', year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(new Date(value));
  const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(billDate)).replaceAll('-', '');
  const visitDate = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(appointment.startsAt));
  let age = '—';
  if (patient.dob) {
    const birth = new Date(patient.dob).toISOString().slice(0, 10);
    const years = Number(visitDate.slice(0, 4)) - Number(birth.slice(0, 4)) - (visitDate.slice(5) < birth.slice(5) ? 1 : 0);
    if (years >= 0) age = `${years} years`;
  }
  const doctorIds = new Set([appointment.doctorId, ...invoices.map((i: any) => i.doctorId).filter(Boolean)]);
  const doctorNames = doctors.filter((d: any) => doctorIds.has(d.id)).map((d: any) => d.name).join(', ') || '—';
  return <section className="reception-receipt" aria-label="Patient bill and payment receipt">
    <header className="receipt-letterhead">
      <div className="receipt-brand">
        {settings.logoUrl ? <img src={settings.logoUrl} alt="Clinic logo" /> : <svg className="receipt-tooth" viewBox="0 0 64 72" aria-hidden="true"><defs><linearGradient id="receipt-tooth-gradient"><stop stopColor="#51b99d" /><stop offset="1" stopColor="#075779" /></linearGradient></defs><path d="M32 12C19 3 7 7 8 23c1 12 6 36 13 39 5 2 6-20 11-20s6 22 11 20c7-3 12-27 13-39C57 7 45 3 32 12Z" fill="none" stroke="url(#receipt-tooth-gradient)" strokeWidth="7" strokeLinejoin="round" /></svg>}
        <h1>{clinic.name || 'Dental clinic'}</h1>
      </div>
      <div className="receipt-contact">
        {settings.address && <p><MapPin />{settings.address}</p>}
        {clinic.phone && <p><Phone />{clinic.phone}</p>}
        {settings.contactEmail && <p><Mail />{settings.contactEmail}</p>}
      </div>
    </header>
    <div className="receipt-title-row">
      <div><h2>PATIENT BILL / PAYMENT RECEIPT</h2><p>{settings.invoiceHeader || 'Thank you for trusting us with your smile.'}</p></div>
      <dl className="receipt-invoice-meta"><dt>Invoice No</dt><dd>INV-{dateKey}-{appointment.id.slice(0, 8).toUpperCase()}</dd><dt>Bill Date</dt><dd>{date(billDate, true)}</dd><dt>Visit Date</dt><dd>{date(appointment.startsAt)}</dd></dl>
    </div>
    <div className="receipt-patient-info">
      <dl><dt>Patient Name</dt><dd><strong>{patient.name}</strong></dd><dt>Patient ID</dt><dd>{patient.id.slice(0, 8).toUpperCase()}</dd><dt>Phone No</dt><dd>{patient.phone || '—'}</dd><dt>Age / Gender</dt><dd>{age} / {patient.gender === 'Unspecified' ? '—' : patient.gender || '—'}</dd></dl>
      <dl><dt>Doctor</dt><dd>{doctorNames}</dd><dt>Visit Type</dt><dd>{appointment.reason || 'Consultation'}</dd><dt>Clinic</dt><dd>{clinic.name || 'Dental clinic'}</dd><dt>Address</dt><dd>{settings.address || '—'}</dd></dl>
    </div>
    <table className="receipt-charge-table"><thead><tr><th>#</th><th>Description</th><th>Gross Amount (₹)</th><th>Discount (₹)</th><th>Net Amount (₹)</th></tr></thead><tbody>{invoices.map((i: any, index: number) => <tr key={i.id}><td>{index + 1}</td><td>{i.description}</td><td>{amount(i.totalPaise + (i.discountPaise || 0))}</td><td>{amount(i.discountPaise || 0)}</td><td>{amount(i.totalPaise)}</td></tr>)}</tbody></table>
    <section className="receipt-summary"><h3>Summary</h3><dl><dt>Subtotal (Gross Amount)</dt><dd>₹{amount(net + discount)}</dd><dt>Total Discount</dt><dd>₹{amount(discount)}</dd><dt className="receipt-highlight">Net Payable</dt><dd className="receipt-highlight">₹{amount(net)}</dd><dt>Total Paid</dt><dd>₹{amount(paid)}</dd><dt className="receipt-highlight">Outstanding Balance</dt><dd className={`receipt-highlight ${net > paid ? 'receipt-outstanding' : ''}`}>₹{amount(net - paid)}</dd></dl></section>
    <section className="receipt-payment-history"><h3>Payment History</h3><table><thead><tr><th>#</th><th>Receipt No</th><th>Date & Time</th><th>Method</th><th>Reference</th><th>Amount (₹)</th></tr></thead><tbody>{payments.map((p: any, index: number) => <tr key={p.id}><td>{index + 1}</td><td>{p.id.slice(0, 8)}</td><td>{date(p.createdAt, true)}</td><td>{p.method}</td><td>{p.reference || '—'}</td><td>{amount(p.amountPaise)}</td></tr>)}{!payments.length && <tr><td colSpan={6}>No payments recorded.</td></tr>}</tbody></table></section>
    <aside className="receipt-note"><FileText /><div><strong>Note:</strong><ol><li>This is a computer generated bill and does not require a signature.</li><li>{settings.invoiceFooter || 'Thank you for trusting us with your smile.'}</li></ol></div></aside>
    <footer className="receipt-footer"><div><strong>{clinic.name || 'Dental clinic'}</strong><p>{settings.tagline || 'Your Oral Health, Our Priority'}</p></div>{settings.website && <span>{settings.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}</footer>
  </section>;
}
