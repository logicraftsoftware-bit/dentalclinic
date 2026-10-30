import { chargeDepartment, chargeDepartments } from './charge-groups';

export const billCategories = ['CLINIC', 'GENERAL', 'SPECIALITY'] as const;
export type BillCategory = typeof billCategories[number];
export const categoryLabels: Record<BillCategory, string> = { CLINIC: 'Clinic fee', GENERAL: 'General dentistry', SPECIALITY: 'Speciality treatment' };
export const categorySuffix: Record<BillCategory, string> = { CLINIC: 'C', GENERAL: 'G', SPECIALITY: 'S' };
export const departmentCategory = (department: string): BillCategory => department && department !== chargeDepartments[0] ? 'SPECIALITY' : 'GENERAL';
const normalized = (name: string) => name.replace(/^Lab: /i, '').replace(/ (?:-|·) Tooth .*/i, '').trim().toLowerCase();

export function categoryMetadata(invoice: any, charges: any[] = [], groups: any[] = []) {
  if (billCategories.includes(invoice.billCategory)) return { billCategory: invoice.billCategory as BillCategory, department: invoice.department || null, catalogItemId: invoice.catalogItemId || null };
  if (invoice.chargeKind === 'VISIT' || /^(clinic fee|consultant fee|visiting consultant fee)$/i.test(invoice.description || '')) return { billCategory: 'CLINIC' as BillCategory, department: null, catalogItemId: null };
  const candidates = invoice.catalogItemId ? charges.filter(c => c.id === invoice.catalogItemId) : charges.filter(c => normalized(c.name) === normalized(invoice.description || ''));
  const departments = [...new Set(candidates.map(c => chargeDepartment(groups.find(g => g.id === c.chargeGroupId) || { name: '' })).filter(Boolean))];
  const department = invoice.department || (departments.length === 1 ? departments[0] : chargeDepartments[0]);
  return { billCategory: departmentCategory(department), department, catalogItemId: invoice.catalogItemId || (candidates.length === 1 ? candidates[0].id : null) };
}

export function categoryBillNumber(number: string, category: BillCategory) {
  return `${number}-${categorySuffix[category]}`;
}
export function invoiceBillGroupKey(invoice: any) {
  const batch = invoice.appointmentId || (invoice.sourceKey?.match(/^[a-f0-9-]{36}:/i) ? invoice.sourceKey.split(':')[0] : invoice.id);
  return `${invoice.patientId}:${batch}`;
}

// Keep cancelled charges separately visible without including them in payable totals.
export function categoryBills(invoices: any[]) {
  const bills = new Map<string, any>();
  const parentNumbers = new Map<string, string>();
  const ordered = [...invoices].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  for (const invoice of ordered) {
    const parent = invoiceBillGroupKey(invoice);
    if (!parentNumbers.has(parent)) parentNumbers.set(parent, invoice.billNumber);
    const category: BillCategory = categoryMetadata(invoice).billCategory;
    const cancelled = invoice.status === 'CANCELLED';
    const key = `${parent}:${category}:${cancelled ? 'cancelled' : 'active'}`;
    if (!bills.has(key)) bills.set(key, { ...invoice, id: key, billCategory: category, billNumber: categoryBillNumber(parentNumbers.get(parent)!, category), description: categoryLabels[category], totalPaise: 0, paidPaise: 0, invoiceIds: [], invoices: [], createdAt: invoice.createdAt });
    const bill = bills.get(key);
    bill.totalPaise += invoice.totalPaise; bill.paidPaise += invoice.paidPaise;
    bill.invoiceIds.push(invoice.id); bill.invoices.push(invoice);
    bill.status = cancelled ? 'CANCELLED' : bill.paidPaise >= bill.totalPaise ? 'PAID' : bill.paidPaise ? 'PARTIAL' : 'UNPAID';
  }
  return [...bills.values()].reverse();
}

export function categoryReceipt(data: any, category: BillCategory, number?: string, invoiceIds?: string[]) {
  const invoices = data.invoices.filter((i: any) => categoryMetadata(i).billCategory === category && (!invoiceIds || invoiceIds.includes(i.id)));
  const ids = new Set(invoices.map((i: any) => i.id));
  return { ...data, billCategory: category, billNumber: number || categoryBillNumber(data.billNumber, category), invoices,
    payments: (data.payments || []).filter((p: any) => ids.has(p.invoiceId)), adjustments: (data.adjustments || []).filter((a: any) => ids.has(a.invoiceId)) };
}

export function categoryCollections(bills: any[], payments: any[]) {
  const byInvoice = new Map<string, any>();
  for (const bill of bills) for (const id of bill.invoiceIds) byInvoice.set(id, bill);
  const receipts = new Map<string, any>();
  for (const payment of payments) {
    const bill = byInvoice.get(payment.invoiceId);
    const batch = payment.idempotencyKey?.includes(':') ? payment.idempotencyKey.split(':')[0] : payment.id;
    const key = `${bill?.billNumber || payment.invoiceId}:${batch}:${payment.method}:${payment.reference}`;
    if (!receipts.has(key)) receipts.set(key, { ...payment, id: key, billNumber: bill?.billNumber, billCategory: bill?.billCategory, amountPaise: 0 });
    receipts.get(key).amountPaise += payment.amountPaise;
  }
  return [...receipts.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
