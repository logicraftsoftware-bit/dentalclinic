import { dateKey } from './time.js';

// Invoice activity and receipts use their own dates; balances remain current.
export function accountDateRange(period: string = 'all', zone: string, now = new Date()) {
  if (period === 'all' || period === 'custom') return {};
  const to = dateKey(now, zone);
  const [year, month, day] = to.split('-').map(Number);
  if (period === 'today') return { from: to, to };
  if (period === 'yesterday' || period === '7days') {
    const from = new Date(Date.UTC(year, month - 1, day - (period === 'yesterday' ? 1 : 6))).toISOString().slice(0, 10);
    return { from, to: period === 'yesterday' ? from : to };
  }
  const months = ({ '1month': 1, '3months': 3, '6months': 6 } as Record<string, number>)[period];
  if (!months) return {};
  const start = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  start.setUTCDate(Math.min(day, lastDay));
  return { from: start.toISOString().slice(0, 10), to };
}
export function accountsReport(data: any, filters: any, zone: string) {
  filters = { ...filters, ...(filters.period && filters.period !== 'custom' ? { from: '', to: '', ...accountDateRange(filters.period, zone) } : {}) };
  const within = (value: any) => { const day = dateKey(value, zone); return (!filters.from || day >= filters.from) && (!filters.to || day <= filters.to); };
  const sessions = new Map<string, any>(data.sessions.map((s: any) => [s.id, s]));
  const doctors = new Map<string, any>(data.doctors.map((d: any) => [d.id, d]));
  const patients = new Map<string, any>(data.patients.map((p: any) => [p.id, p]));
  const commissions = new Map<string, any>(data.commissions.map((c: any) => [c.paymentId, c]));
  const payments = new Map<string, any[]>();
  for (const p of data.payments) { const list = payments.get(p.invoiceId) || []; list.push(p); payments.set(p.invoiceId, list); }
  const rows = data.invoices.flatMap((invoice: any) => {
    const doctorId = sessions.get(invoice.sessionId)?.doctorId || invoice.doctorId || '';
    if (filters.doctorId && doctorId !== filters.doctorId) return [];
    const procedure = invoice.description || 'Unspecified charge';
    if (filters.procedure && procedure !== filters.procedure) return [];
    const receipts = (payments.get(invoice.id) || []).filter(p => within(p.createdAt));
    const billed = within(invoice.createdAt);
    if (!billed && !receipts.length) return [];
    const collected = receipts.reduce((n, p) => n + p.amountPaise, 0);
    const commission = receipts.reduce((n, p) => n + (commissions.get(p.id)?.amountPaise || 0), 0);
    const paidCommission = receipts.reduce((n, p) => { const c = commissions.get(p.id); return n + (c?.status === 'PAID' ? c.amountPaise : 0); }, 0);
    return [{ id: invoice.id, date: dateKey(invoice.createdAt, zone), patient: patients.get(invoice.patientId)?.name || 'Unknown patient', doctorId, doctor: doctors.get(doctorId)?.name || 'Unassigned / clinic', procedure, kind: invoice.chargeKind || 'TREATMENT', gross: billed ? invoice.totalPaise + (invoice.discountPaise || 0) : 0, discount: billed ? invoice.discountPaise || 0 : 0, net: billed ? invoice.totalPaise : 0, collected, commission, paidCommission, dueCommission: commission - paidCommission, clinic: collected - commission, outstanding: billed ? invoice.totalPaise - invoice.paidPaise : 0, receipts: receipts.map(p => ({ date: dateKey(p.createdAt, zone), method: p.method, reference: p.reference, amount: p.amountPaise })) }];
  });
  const keys = ['gross', 'discount', 'net', 'collected', 'commission', 'paidCommission', 'dueCommission', 'clinic', 'outstanding'] as const;
  const sum = (items: any[]) => Object.fromEntries(keys.map(key => [key, items.reduce((n, r) => n + r[key], 0)])) as Record<typeof keys[number], number>;
  const group = (key: string) => { const groups = new Map<string, any[]>(); for (const row of rows) { const value = row[key]; const items = groups.get(value) || []; items.push(row); groups.set(value, items); } return [...groups].map(([value, items]) => ({ label: key === 'doctorId' ? items[0].doctor : value, count: items.length, ...sum(items) })).sort((a, b) => b.collected - a.collected); };
  const methods = new Map<string, number>(['UPI', 'CARD', 'CASH'].map(method => [method, 0]));
  for (const row of rows) for (const receipt of row.receipts) {
    const method = receipt.method?.trim().toUpperCase() || 'OTHER';
    methods.set(method, (methods.get(method) || 0) + receipt.amount);
  }
  const paymentMethods = [...methods].map(([method, amount]) => ({ method, amount }));
  return { filters, paymentMethods, totals: sum(rows), doctors: group('doctorId'), procedures: group('procedure'), rows: rows.sort((a: any, b: any) => b.date.localeCompare(a.date)), doctorOptions: data.doctors.map((d: any) => ({ id: d.id, name: d.name })), procedureOptions: [...new Set(data.invoices.map((i: any) => i.description))].sort() };
}
