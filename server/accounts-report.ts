import { commissionEligible } from '../shared/commission.js';
import { invoiceBillNumbers } from '../shared/bill-number.js';
import { categoryBills } from '../shared/bill-categories.js';
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
  const numbered = invoiceBillNumbers(data.invoices, zone);
  const billNumbers = new Map<string, string>();
  for (const bill of categoryBills(numbered)) for (const id of bill.invoiceIds) billNumbers.set(id, bill.billNumber);
  const sessions = new Map<string, any>(data.sessions.map((s: any) => [s.id, s]));
  const doctors = new Map<string, any>(data.doctors.map((d: any) => [d.id, d]));
  const patients = new Map<string, any>(data.patients.map((p: any) => [p.id, p]));
  const commissions = new Map<string, any>(data.commissions.map((c: any) => [c.paymentId, c]));
  const adjustments: any[] = data.adjustments || [];
  const matching = data.invoices.filter((invoice: any) => (!filters.doctorId || (sessions.get(invoice.sessionId)?.doctorId || invoice.doctorId || '') === filters.doctorId) && (!filters.procedure || invoice.description === filters.procedure));
  const ids = new Set(matching.map((i: any) => i.id));
  const sumEntries = (entries: any[], field: string) => entries.reduce((n, e) => n + (e[field] || 0), 0);
  const payments = new Map<string, any[]>();
  for (const p of data.payments) { const list = payments.get(p.invoiceId) || []; list.push(p); payments.set(p.invoiceId, list); }
  const rows = matching.flatMap((invoice: any) => {
    const doctorId = sessions.get(invoice.sessionId)?.doctorId || invoice.doctorId || '';
    const allEntries = adjustments.filter(e => e.invoiceId === invoice.id);
    const entries = allEntries.filter(e => within(e.createdAt));
    const cancellations = entries.filter(e => e.type === 'CANCEL');
    const receipts = (payments.get(invoice.id) || []).filter(p => within(p.createdAt));
    const billed = within(invoice.createdAt);
    const lots = allEntries.filter(e => e.type === 'CANCEL');
    const patientCredit = lots.reduce((n, source) => n + source.amountPaise + sumEntries(adjustments.filter(e => e.sourceId === source.id), 'amountPaise'), 0);
    if (!billed && !receipts.length && !entries.length && !patientCredit) return [];
    const collected = sumEntries(receipts.filter(p => p.method !== 'CREDIT'), 'amountPaise');
    const creditUsed = sumEntries(receipts.filter(p => p.method === 'CREDIT'), 'amountPaise');
    const cancelled = sumEntries(cancellations, 'cancelledPaise');
    const creditAdded = sumEntries(cancellations, 'amountPaise');
    const refunds = -sumEntries(entries.filter(e => e.type === 'REFUND'), 'amountPaise');
    const eligible = commissionEligible(invoice);
    const commissionReversed = eligible ? sumEntries(cancellations, 'commissionReversalPaise') : 0;
    const commission = receipts.reduce((n, p) => n + (eligible ? commissions.get(p.id)?.amountPaise || 0 : 0), 0) - commissionReversed;
    const paidCommission = receipts.reduce((n, p) => { const c = eligible ? commissions.get(p.id) : undefined; return n + (['PAID', 'RECOVERY_DUE'].includes(c?.status) ? c.amountPaise : 0); }, 0);
    const dueCommission = receipts.reduce((n, p) => { const c = eligible ? commissions.get(p.id) : undefined; return n + (c?.status === 'ACCRUED' ? c.amountPaise : 0); }, 0);
    const commissionRecovery = eligible ? sumEntries(allEntries.filter(e => e.type === 'CANCEL'), 'paidCommissionRecoveryPaise') : 0;
    const earned = collected + creditUsed - creditAdded;
    return [{ id: invoice.id, invoiceNumber: billNumbers.get(invoice.id), commissionEligible: eligible, date: dateKey(invoice.createdAt, zone), patient: patients.get(invoice.patientId)?.name || 'Unknown patient', doctorId, doctor: doctors.get(doctorId)?.name || 'Unassigned / clinic', procedure: invoice.description || 'Unspecified charge', kind: invoice.chargeKind || 'TREATMENT', status: invoice.status,
      gross: billed ? invoice.totalPaise + (invoice.discountPaise || 0) : 0, discount: billed ? invoice.discountPaise || 0 : 0, net: (billed ? invoice.totalPaise : 0) - cancelled,
      cancelled, collected, refunds, netCash: collected - refunds, creditAdded, creditUsed, patientCredit, earned,
      commission, commissionReversed, commissionRecovery, paidCommission, dueCommission, clinic: earned - commission,
      outstanding: billed && invoice.status !== 'CANCELLED' ? invoice.totalPaise - invoice.paidPaise : 0,
      receipts: receipts.map(p => ({ date: dateKey(p.createdAt, zone), method: p.method, reference: p.reference, amount: p.amountPaise })),
    }];
  });
  const keys = ['gross', 'discount', 'net', 'cancelled', 'collected', 'refunds', 'netCash', 'creditAdded', 'creditUsed', 'patientCredit', 'earned', 'commission', 'commissionReversed', 'commissionRecovery', 'paidCommission', 'dueCommission', 'clinic', 'outstanding'] as const;
  const sum = (items: any[]) => Object.fromEntries(keys.map(key => [key, items.reduce((n, r) => n + r[key], 0)])) as Record<typeof keys[number], number>;
  const group = (key: string) => { const groups = new Map<string, any[]>(); for (const row of rows) { const value = row[key]; const items = groups.get(value) || []; items.push(row); groups.set(value, items); } return [...groups].map(([value, items]) => ({ id: value, details: items, label: key === 'doctorId' ? items[0].doctor : value, count: items.length, ...sum(items) })).sort((a, b) => b.collected - a.collected); };
  const methods = new Map<string, number>(['UPI', 'CARD', 'CASH'].map(method => [method, 0]));
  for (const row of rows) for (const receipt of row.receipts) {
    if (receipt.method === 'CREDIT') continue;
    const method = receipt.method?.trim().toUpperCase() || 'OTHER';
    methods.set(method, (methods.get(method) || 0) + receipt.amount);
  }
  const activity = adjustments.filter(e => ids.has(e.invoiceId) && within(e.createdAt)).map(e => {
    const invoice = matching.find((i: any) => i.id === e.invoiceId);
    const source = e.sourceId ? adjustments.find(s => s.id === e.sourceId) : null;
    return { ...e, patient: patients.get(e.patientId)?.name || 'Unknown patient', procedure: invoice.description, invoiceNumber: billNumbers.get(invoice.id),
      sourceInvoiceId: source?.invoiceId || null, date: dateKey(e.createdAt, zone) };
  }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { filters, activity, paymentMethods: [...methods].map(([method, amount]) => ({ method, amount })), totals: sum(rows), doctors: group('doctorId'), procedures: group('procedure'), rows: rows.sort((a: any, b: any) => b.date.localeCompare(a.date)), doctorOptions: data.doctors.map((d: any) => ({ id: d.id, name: d.name })), procedureOptions: [...new Set(data.invoices.map((i: any) => i.description))].sort() };
}