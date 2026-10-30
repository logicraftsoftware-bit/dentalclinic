import { z } from 'zod';
import { assert, id, money, hash } from './core.js';
import { billCategories, invoiceBillGroupKey } from '../shared/bill-categories.js';
import { classifiedInvoices } from './invoice-categories.js';
import { recordCheckoutPayment } from './patient-payments.js';
import { updateVisitBalance } from './patient-adjustments.js';

export function registerCategoryPayments(router: any, run: any) {
  router.post('/category-payments', run('billing', async (req: any, res: any, ctx: any, actor: any) => {
    const input = z.object({ checkoutKey: z.string().uuid(), category: z.enum(billCategories), invoiceIds: z.array(id).min(1).max(500),
      amountPaise: money, discountPaise: money.default(0), method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().trim().max(200).default('') }).strict().parse(req.body);
    assert(new Set(input.invoiceIds).size === input.invoiceIds.length, 400, 'Duplicate invoice.');
    const { store, tx, tenant } = ctx;
    const key = `category-payment:${actor.userId}:${input.checkoutKey}`, fingerprint = hash(JSON.stringify(input));
    const previous = (await store.list('idempotencyRecord', { key }))[0];
    if (previous) { assert(previous.fingerprint === fingerprint, 409, 'This payment has already been saved with different details.'); res.json(previous.body); return; }
    const invoices = await classifiedInvoices(store, await store.list('invoice', { id: { in: input.invoiceIds } }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    assert(invoices.length === input.invoiceIds.length, 404, 'Bill not found in your clinic.');
    assert(new Set(invoices.map(invoiceBillGroupKey)).size === 1, 400, 'Choose one patient bill.');
    assert(invoices.every((i: any) => i.billCategory === input.category && i.status !== 'CANCELLED'), 400, 'Choose active invoices in the selected category.');
    const appointmentId = invoices[0].appointmentId;
    if (appointmentId) assert(!['ABSENT', 'CANCELLED'].includes((await store.get('appointment', appointmentId)).status), 409, 'Mark this patient present before billing.');
    let balance = invoices.reduce((n: number, i: any) => n + i.totalPaise - i.paidPaise, 0), remaining = input.discountPaise;
    assert(input.discountPaise + input.amountPaise <= balance, 400, 'Payment or discount exceeds this category balance.');
    assert(input.discountPaise + input.amountPaise > 0, 400, 'Enter a payment or discount.');
    for (const invoice of invoices) {
      const due = invoice.totalPaise - invoice.paidPaise;
      const share = balance ? Number(BigInt(remaining) * BigInt(due) / BigInt(balance)) : 0;
      remaining -= share; balance -= due;
      if (!share) continue;
      const change = { totalPaise: invoice.totalPaise - share, discountPaise: (invoice.discountPaise || 0) + share,
        discountReason: 'Category bill discount', status: invoice.totalPaise - share === invoice.paidPaise ? 'PAID' : invoice.paidPaise ? 'PARTIAL' : 'UNPAID' };
      await tx.invoice.update({ where: { tenantId_id: { tenantId: tenant.id, id: invoice.id } }, data: change });
      Object.assign(invoice, change);
      await store.audit(actor.userId, 'invoice.discount.applied', invoice.id);
    }
    const updated = await recordCheckoutPayment(ctx, invoices, input, input.checkoutKey, actor);
    if (appointmentId) await updateVisitBalance(ctx, appointmentId);
    const result = { invoices: updated, category: input.category, paidPaise: input.amountPaise };
    await store.audit(actor.userId, 'category.payment.saved', invoices[0].patientId);
    await store.create('idempotencyRecord', { key, fingerprint, status: 201, body: JSON.parse(JSON.stringify(result)), headers: {} });
    res.status(201).json(result);
  }, false, false, 120000));
}
