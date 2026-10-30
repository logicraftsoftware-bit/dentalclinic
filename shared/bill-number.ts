// Keep the existing printed invoice format consistent across every billing view.
function numberWithFormat(id: string, createdAt: string | Date, formatter: Intl.DateTimeFormat) {
  const date = formatter.format(new Date(createdAt)).replaceAll('-', '');
  return `INV-${date}-${id.slice(0, 8).toUpperCase()}`;
}
export function formatBillNumber(id: string, createdAt: string | Date, zone = 'Asia/Kolkata') {
  return numberWithFormat(id, createdAt, new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }));
}

export function invoiceBillNumbers(invoices: any[], zone: string) {
  const dates = new Map<string, string | Date>();
  for (const invoice of invoices) {
    const key = invoice.appointmentId || invoice.id;
    const previous = dates.get(key);
    if (!previous || new Date(invoice.createdAt).getTime() < new Date(previous).getTime()) dates.set(key, invoice.createdAt);
  }
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const numbers = new Map([...dates].map(([id, date]) => [id, numberWithFormat(id, date, formatter)]));
  return invoices.map(invoice => ({ ...invoice, billNumber: invoice.billNumber || numbers.get(invoice.appointmentId || invoice.id) }));
}
