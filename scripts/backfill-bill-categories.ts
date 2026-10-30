import { db, transaction, lock, assert } from '../server/core.js';
import { categoryMetadata } from '../shared/bill-categories.js';
import { procedureKey } from '../shared/procedure-key.js';

const apply = process.argv.includes('--apply');
let updated = 0;
const totals: Record<string, number> = { CLINIC: 0, GENERAL: 0, SPECIALITY: 0 };
try {
  const tenants = await db.invoice.findMany({ distinct: ['tenantId'], select: { tenantId: true } });
  for (const { tenantId } of tenants) await transaction(async tx => {
    if (apply) await lock(tx, tenantId);
    const [invoices, charges, groups, sessions, items] = await Promise.all([
      tx.invoice.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      tx.catalogItem.findMany({ where: { tenantId } }), tx.chargeGroup.findMany({ where: { tenantId } }),
      tx.treatmentSession.findMany({ where: { tenantId } }), tx.treatmentItem.findMany({ where: { tenantId } }),
    ]);
    const bySession = new Map(sessions.map(s => [s.id, items.find(i => i.id === s.itemId)?.catalogItemId]));
    const metadata = new Map<string, ReturnType<typeof categoryMetadata>>();
    for (const invoice of invoices) if (!invoice.description.startsWith('Lab: ')) metadata.set(procedureKey(invoice), categoryMetadata({ ...invoice, catalogItemId: invoice.catalogItemId || bySession.get(invoice.sessionId || '') }, charges, groups));
    for (const invoice of invoices) {
      if (invoice.billCategory) continue;
      const snapshot = metadata.get(procedureKey(invoice)) || categoryMetadata(invoice, charges, groups);
      totals[snapshot.billCategory]++;
      if (apply) {
        const result = await tx.invoice.updateMany({ where: { id: invoice.id, tenantId, OR: [{ billCategory: null }, { billCategory: { isSet: false } }] }, data: snapshot });
        updated += result.count;
      }
    }
    if (apply) {
      const financial = (rows: any[]) => JSON.stringify(rows.map(i => [i.id, i.totalPaise, i.paidPaise, i.discountPaise, i.status]).sort((a, b) => a[0].localeCompare(b[0])));
      const after = await tx.invoice.findMany({ where: { tenantId }, select: { id: true, totalPaise: true, paidPaise: true, discountPaise: true, status: true } });
      assert(financial(invoices) === financial(after), 500, 'Category migration must preserve invoice amounts and payment status.');
    }
  }, { timeout: 120000 });
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'preview', categoryCounts: totals, updated }));
} finally { await db.$disconnect(); }
