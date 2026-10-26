import { procedureKey } from '../shared/procedure-key';
export function billingLines(invoices: any[], payments: any[]) {
  const groups = new Map<string, any>();
  for (const i of invoices) {
    const key = procedureKey(i);
    if (!groups.has(key)) groups.set(key, { key, invoices: [], name: i.description.replace(/^Lab: /, ''), doctorId: i.doctorId });
    const group = groups.get(key); group.invoices.push(i);
    if (i.chargeKind !== 'LAB' && !i.description.startsWith('Lab:')) { group.name = i.description; group.doctorId = i.doctorId; }
  }
  return [...groups.values()].map(group => {
    const ids = new Set(group.invoices.map((i: any) => i.id));
    const receipts = payments.filter(p => ids.has(p.invoiceId)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const batch = (p: any) => p.idempotencyKey?.includes(':') ? p.idempotencyKey.split(':')[0] : p.id;
    const latest = receipts.length ? receipts.filter(p => batch(p) === batch(receipts[0])) : [];
    return { ...group, invoiceIds: [...ids], gross: group.invoices.reduce((n: number, i: any) => n + i.totalPaise + (i.discountPaise || 0), 0), discount: group.invoices.reduce((n: number, i: any) => n + (i.discountPaise || 0), 0), net: group.invoices.reduce((n: number, i: any) => n + i.totalPaise, 0), paid: group.invoices.reduce((n: number, i: any) => n + i.paidPaise, 0), lab: group.invoices.filter((i: any) => i.chargeKind === 'LAB' || i.description.startsWith('Lab:')).reduce((n: number, i: any) => n + i.totalPaise + (i.discountPaise || 0), 0), collected: latest.reduce((n, p) => n + p.amountPaise, 0), methods: [...new Set(receipts.map(p => p.method))].join(', ') || '—' };
  });
}

export function procedureCollections(rows: any[], payments: any[]) {
  const collections = new Map<string, any>();
  for (const p of payments) {
    const row = rows.find(r => r.invoiceIds.includes(p.invoiceId));
    if (!row) continue;
    const batch = p.idempotencyKey?.includes(':') ? p.idempotencyKey.split(':')[0] : p.id;
    const key = `${row.key}:${batch}:${p.method}:${p.reference}`;
    if (!collections.has(key)) collections.set(key, { ...p, id: key, collectionNo: `${batch.slice(0, 8)}-${[...row.invoiceIds].sort()[0].slice(0, 4)}`, name: row.name, amountPaise: 0 });
    collections.get(key).amountPaise += p.amountPaise;
  }
  return [...collections.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
