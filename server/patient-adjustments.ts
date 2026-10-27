import type { Router } from 'express';
import { z } from 'zod';
import { assert, hash, id, money } from './core.js';
import { procedureKey } from '../shared/procedure-key.js';
import { recordCheckoutPayment } from './patient-payments.js';

export const creditBalance = (entries: any[]) => entries.reduce((n, entry) => n + entry.amountPaise, 0);
export async function billingTotals(store: any) {
  const [invoices, payments, adjustments] = await Promise.all([store.list('invoice'), store.list('payment'), store.list('patientAdjustment')]);
  const active = invoices.filter((i: any) => i.status !== 'CANCELLED');
  const refundedPaise = -adjustments.filter((e: any) => e.type === 'REFUND').reduce((n: number, e: any) => n + e.amountPaise, 0);
  return {
    totalPaise: active.reduce((n: number, i: any) => n + i.totalPaise, 0),
    outstandingPaise: active.reduce((n: number, i: any) => n + i.totalPaise - i.paidPaise, 0),
    collectedPaise: payments.filter((p: any) => p.method !== 'CREDIT').reduce((n: number, p: any) => n + p.amountPaise, 0) - refundedPaise,
    refundedPaise, creditBalancePaise: creditBalance(adjustments), paymentCount: payments.length,
  };
}
export async function updateVisitBalance(ctx: any, appointmentId?: string | null) {
  if (!appointmentId) return;
  const invoices = (await ctx.store.list('invoice', { appointmentId })).filter((i: any) => i.status !== 'CANCELLED');
  const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0);
  const paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
  await ctx.store.update('appointment', appointmentId, { paymentStatus: !total ? 'NOT_REQUIRED' : paid >= total ? 'PAID' : paid ? 'PARTIAL' : 'PENDING' });
}
const reason = z.string().trim().min(3, 'Enter a reason (at least 3 characters).').max(500);
const base = { requestKey: z.string().uuid(), reason };
const invoiceIds = z.array(id).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Duplicate invoice.');
async function replay(store: any, key: string, input: any) {
  const previous = (await store.list('idempotencyRecord', { key }))[0];
  if (previous) assert(previous.fingerprint === hash(JSON.stringify(input)), 409, 'This request was already saved with different details.');
  return previous?.body;
}
async function remember(store: any, key: string, input: any, result: any) {
  await store.create('idempotencyRecord', { key, fingerprint: hash(JSON.stringify(input)), status: 201, headers: {}, body: JSON.parse(JSON.stringify(result)) });
  return result;
}
async function selectedInvoices(store: any, ids: string[]) {
  const invoices = await store.list('invoice', { id: { in: ids } });
  assert(invoices.length === ids.length, 404, 'Invoice not found in your clinic.');
  assert(new Set(invoices.map((i: any) => i.patientId)).size === 1, 400, 'Choose one patient.');
  assert(invoices.every((i: any) => i.status !== 'CANCELLED'), 409, 'This procedure has already been cancelled.');
  return invoices;
}
// Spend individual credit lots, retaining the cancellation that funded each use/refund.
async function spendCredit(ctx: any, patientId: string, targets: any[], common: any) {
  const ledger = await ctx.store.list('patientAdjustment', { patientId }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const lots = ledger.filter((e: any) => e.type === 'CANCEL').map((source: any) => ({
    source, available: source.amountPaise + ledger.filter((e: any) => e.sourceId === source.id).reduce((n: number, e: any) => n + e.amountPaise, 0),
  }));
  const total = targets.reduce((n, t) => n + t.amountPaise, 0);
  assert(total <= creditBalance(ledger), 409, 'Amount exceeds the available patient credit.');
  let index = 0;
  for (const target of targets) {
    let remaining = target.amountPaise;
    for (const lot of lots) {
      const amount = Math.min(remaining, lot.available);
      if (amount <= 0) continue;
      const invoice = target.invoice || await ctx.store.get('invoice', lot.source.invoiceId);
      await ctx.store.create('patientAdjustment', {
        ...common, patientId, invoiceId: invoice.id, appointmentId: invoice.appointmentId || null,
        sourceId: lot.source.id, amountPaise: -amount, key: `${common.key}:${index++}`,
      });
      lot.available -= amount; remaining -= amount;
      if (!remaining) break;
    }
    assert(remaining === 0, 409, 'Patient credit is no longer available. Refresh and retry.');
  }
  return creditBalance(ledger) - total;
}
export function registerPatientAdjustmentRoutes(router: Router, run: any) {
  router.get('/billing-totals', run('billing', async (_req: any, res: any, { store }: any) => {
    res.json(await billingTotals(store));
  }));
  router.get('/patient-adjustments', run('billing', async (_req: any, res: any, { store }: any) => {
    res.json(await store.list('patientAdjustment', {}, { orderBy: { createdAt: 'desc' } }));
  }));
  router.get('/patient-credits/:id', run('billing', async (req: any, res: any, { store, tx, tenant }: any) => {
    const patient = await store.get('patient', id.parse(req.params.id));
    const entries = await store.list('patientAdjustment', { patientId: patient.id }, { orderBy: { createdAt: 'desc' } });
    const invoices = await store.list('invoice', { patientId: patient.id });
    const payments = invoices.length ? await store.list('payment', { invoiceId: { in: invoices.map((i: any) => i.id) } }) : [];
    const branch = patient.branchId ? await tx.branch.findFirst({ where: { id: patient.branchId, tenantId: tenant.id }, select: { id: true, name: true, address: true } }) : null;
    res.json({ patient, branch, entries, invoices, payments, balancePaise: creditBalance(entries) });
  }));
  router.post('/procedure-cancellations', run('billing', async (req: any, res: any, ctx: any, actor: any) => {
    const input = z.object({ ...base, invoiceIds }).strict().parse(req.body);
    const { store, tx, tenant } = ctx;
    const key = `procedure-cancel:${actor.userId}:${input.requestKey}`;
    const previous = await replay(store, key, input);
    if (previous) { res.json(previous); return; }
    const selected = await selectedInvoices(store, input.invoiceIds);
    const all = await store.list('invoice', { patientId: selected[0].patientId });
    const keys = new Set(selected.map(procedureKey));
    assert(all.filter((i: any) => keys.has(procedureKey(i))).every((i: any) => input.invoiceIds.includes(i.id)), 400, 'Cancel the complete procedure, including its lab charge.');
    const actorName = (await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name || actor.userId;
    const payments = await store.list('payment', { invoiceId: { in: input.invoiceIds } });
    const commissions = payments.length ? await store.list('commission', { paymentId: { in: payments.map((p: any) => p.id) } }) : [];
    for (const invoice of selected) {
      const paymentIds = new Set(payments.filter((p: any) => p.invoiceId === invoice.id).map((p: any) => p.id));
      const reversals = commissions.filter((c: any) => paymentIds.has(c.paymentId));
      await store.create('patientAdjustment', {
        patientId: invoice.patientId, invoiceId: invoice.id, appointmentId: invoice.appointmentId || null,
        key: `${key}:${invoice.id}`, type: 'CANCEL', amountPaise: invoice.paidPaise, cancelledPaise: invoice.totalPaise,
        commissionReversalPaise: reversals.reduce((n: number, c: any) => n + c.amountPaise, 0),
        paidCommissionRecoveryPaise: reversals.filter((c: any) => c.status === 'PAID').reduce((n: number, c: any) => n + c.amountPaise, 0),
        reason: input.reason, method: 'CREDIT', actorId: actor.userId, actorName,
      });
      await store.update('invoice', invoice.id, { status: 'CANCELLED' });
      for (const commission of reversals) await store.update('commission', commission.id, { status: commission.status === 'PAID' ? 'RECOVERY_DUE' : 'REVERSED' });
      await store.audit(actor.userId, 'procedure.cancelled', invoice.id);
    }
    for (const appointmentId of new Set(selected.map((i: any) => i.appointmentId))) await updateVisitBalance(ctx, appointmentId as string);
    const entries = await store.list('patientAdjustment', { patientId: selected[0].patientId });
    res.status(201).json(await remember(store, key, input, { creditAddedPaise: selected.reduce((n: number, i: any) => n + i.paidPaise, 0), balancePaise: creditBalance(entries) }));
  }, false, false, 120000));
  for (const type of ['REFUND', 'CREDIT_USE'] as const) router.post(`/patient-credits/:id/${type === 'REFUND' ? 'refund' : 'apply'}`, run('billing', async (req: any, res: any, ctx: any, actor: any) => {
    const patientId = id.parse(req.params.id);
    const input = (type === 'REFUND'
      ? z.object({ ...base, amountPaise: money.refine(n => n > 0), method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().trim().max(200).default('') }).strict()
      : z.object({ ...base, amountPaise: money.refine(n => n > 0), invoiceIds }).strict()).parse(req.body);
    const { store, tx } = ctx;
    await store.get('patient', patientId);
    const key = `patient-${type}:${actor.userId}:${patientId}:${input.requestKey}`;
    const previous = await replay(store, key, input);
    if (previous) { res.json(previous); return; }
    const actorName = (await tx.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name || actor.userId;
    let targets: any[] = [{ amountPaise: input.amountPaise }];
    let selected: any[] = [];
    if ('invoiceIds' in input) {
      selected = await selectedInvoices(store, input.invoiceIds);
      assert(selected.every(i => i.patientId === patientId), 400, 'Credit belongs to another patient.');
      let remaining = input.amountPaise;
      targets = selected.map(invoice => { const amountPaise = Math.min(remaining, invoice.totalPaise - invoice.paidPaise); remaining -= amountPaise; return { invoice, amountPaise }; });
      assert(remaining === 0, 409, 'Credit use exceeds the procedure balance.');
    }
    const balancePaise = await spendCredit(ctx, patientId, targets, {
      key, type, reason: input.reason, method: 'method' in input ? input.method : 'CREDIT',
      reference: 'reference' in input ? input.reference : '', actorId: actor.userId, actorName,
    });
    if (type === 'CREDIT_USE') {
      await recordCheckoutPayment(ctx, selected, { amountPaise: input.amountPaise, method: 'CREDIT', reference: input.reason }, input.requestKey, actor);
      for (const appointmentId of new Set(selected.map(i => i.appointmentId))) await updateVisitBalance(ctx, appointmentId as string);
    }
    await store.audit(actor.userId, type === 'REFUND' ? 'patient.refund.recorded' : 'patient.credit.applied', patientId);
    res.status(201).json(await remember(store, key, input, { balancePaise, amountPaise: input.amountPaise }));
  }, false, false, 120000));
}
