import { categoryMetadata } from '../shared/bill-categories.js';
import { procedureKey } from '../shared/procedure-key.js';

export async function classifiedInvoices(store: any, invoices: any[]) {
  if (!invoices.some(i => !i.billCategory)) return invoices;
  const [charges, groups] = await Promise.all([store.list('catalogItem'), store.list('chargeGroup')]);
  const primary = new Map(invoices.filter(i => i.chargeKind !== 'LAB' && !i.description.startsWith('Lab: '))
    .map(i => [procedureKey(i), categoryMetadata(i, charges, groups)]));
  return invoices.map(i => ({ ...i, ...(!i.billCategory && (i.chargeKind === 'LAB' || i.description.startsWith('Lab: '))
    ? primary.get(procedureKey(i)) || categoryMetadata(i, charges, groups) : categoryMetadata(i, charges, groups)) }));
}
