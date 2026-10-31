import { commissionEligible } from '../shared/commission.js';
import { assert } from './core.js';
import { randomUUID } from 'node:crypto';

// Checkout has already read these invoices through the scoped repository and
// holds the tenant write lock. Batch inserts avoid re-reading every invoice and
// patient for each payment while retaining the same transaction and commissions.
export async function recordCheckoutPayment({ store, tx, tenant }: any, invoices: any[], payment: any, checkoutKey: string, actor: any) {
  if (payment.splits !== undefined) {
    assert(payment.splits.reduce((sum: number, part: any) => sum + part.amountPaise, 0) === payment.amountPaise, 400, 'Payment method amounts must equal the total paid amount.');
    let updated = invoices;
    for (const [index, part] of payment.splits.entries()) updated = await recordCheckoutPayment({ store, tx, tenant }, updated, part, `${checkoutKey}:split:${index}`, actor);
    return updated;
  }
  assert(invoices.every(i => i.status !== 'CANCELLED'), 409, 'Cancelled procedures cannot receive payments.');
  let remaining = payment.amountPaise;
  const allocations: { invoice: any; amountPaise: number; id: string }[] = [];
  for (const invoice of invoices) {
    const amountPaise = Math.min(remaining, invoice.totalPaise - invoice.paidPaise);
    if (amountPaise > 0) allocations.push({ invoice, amountPaise, id: randomUUID() });
    remaining -= amountPaise;
  }
  assert(remaining === 0, 409, 'Payment exceeds the invoice balance.');
  if (!allocations.length) return invoices;
  const sessionIds = [...new Set(allocations.map(a => a.invoice.sessionId).filter(Boolean))];
  const sessions = sessionIds.length ? await store.list('treatmentSession', { id: { in: sessionIds } }) : [];
  assert(sessions.length === sessionIds.length, 404, 'Treating session not found.');
  const sessionDoctors = new Map<string, string>(sessions.map((s: any) => [s.id, s.doctorId]));
  const doctorFor = (invoice: any) => !commissionEligible(invoice) ? null : invoice.sessionId ? sessionDoctors.get(invoice.sessionId) : invoice.chargeKind === 'PROCEDURE' ? invoice.doctorId : null;
  const doctorIds = [...new Set(allocations.map(a => doctorFor(a.invoice)).filter(Boolean))];
  const doctors = doctorIds.length ? await tx.doctor.findMany({ where: { tenantId: tenant.id, id: { in: doctorIds } }, select: { id: true, commissionPercent: true } }) : [];
  assert(doctors.length === doctorIds.length, 404, 'Treating doctor not found.');
  const rates = new Map<string, number>(doctors.map((d: any) => [d.id, d.commissionPercent]));
  await tx.payment.createMany({ data: allocations.map(a => ({ id: a.id, tenantId: tenant.id, invoiceId: a.invoice.id, amountPaise: a.amountPaise, method: payment.method, reference: payment.reference, idempotencyKey: `${checkoutKey}:${a.invoice.id}` })) });
  const commissions = allocations.flatMap(a => {
    const doctorId = doctorFor(a.invoice), percent = rates.get(doctorId) || 0;
    return percent ? [{ tenantId: tenant.id, doctorId, paymentId: a.id, percent, amountPaise: Math.round(a.amountPaise * percent / 100) }] : [];
  });
  if (commissions.length) await tx.commission.createMany({ data: commissions });
  for (const a of allocations) {
    const paidPaise = a.invoice.paidPaise + a.amountPaise;
    await tx.invoice.update({ where: { tenantId_id: { tenantId: tenant.id, id: a.invoice.id } }, data: { paidPaise, status: paidPaise === a.invoice.totalPaise ? 'PAID' : 'PARTIAL' } });
  }
  await tx.clinicAudit.createMany({ data: allocations.map(a => ({ tenantId: tenant.id, actorId: actor.userId, action: 'payment.received', recordId: a.id })) });
  const byInvoice = new Map(allocations.map(a => [a.invoice.id, a.amountPaise]));
  return invoices.map(i => {
    const paidPaise = i.paidPaise + (byInvoice.get(i.id) || 0);
    return { ...i, paidPaise, status: paidPaise === i.totalPaise ? 'PAID' : paidPaise ? 'PARTIAL' : i.status };
  });
}

export async function recordInvoicePayment({ store, tx, tenant }: any, data: any, actor: any): Promise<any> {
  if (data.splits !== undefined) {
    assert(data.splits.reduce((sum: number, part: any) => sum + part.amountPaise, 0) === data.amountPaise, 400, 'Payment method amounts must equal the total paid amount.');
    const results = [];
    for (const [index, part] of data.splits.entries()) results.push(await recordInvoicePayment({ store, tx, tenant }, { ...part, invoiceId: data.invoiceId, idempotencyKey: `${data.idempotencyKey}:split:${index}` }, actor));
    return { payment: results.map(r => r.payment), replayed: results.every(r => r.replayed) };
  }
  const previous = await store.list('payment', { idempotencyKey: data.idempotencyKey });
  if (previous.length) {
    assert(previous[0].invoiceId === data.invoiceId && previous[0].amountPaise === data.amountPaise && previous[0].method === data.method && previous[0].reference === data.reference, 409, 'Idempotency key reused with different payment data.');
    return { payment: previous[0], replayed: true };
  }
  const invoice = await store.get('invoice', data.invoiceId);
  assert(invoice.status !== 'CANCELLED', 409, 'Cancelled procedures cannot receive payments.');
  assert(data.amountPaise > 0 && data.amountPaise <= invoice.totalPaise - invoice.paidPaise, 409, 'Payment exceeds the invoice balance.');
  const row = await store.create('payment', data);
  const paid = invoice.paidPaise + data.amountPaise;
  await store.update('invoice', invoice.id, { paidPaise: paid, status: paid === invoice.totalPaise ? 'PAID' : 'PARTIAL' });
  if (commissionEligible(invoice) && (invoice.sessionId || invoice.doctorId)) {
    const doctorId = invoice.sessionId ? (await store.get('treatmentSession', invoice.sessionId)).doctorId : invoice.doctorId;
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, tenantId: tenant.id } });
    assert(doctor, 404, 'Treating doctor not found.');
    if (doctor.commissionPercent) await tx.commission.create({ data: { tenantId: tenant.id, doctorId: doctor.id, paymentId: row.id, percent: doctor.commissionPercent, amountPaise: Math.round(data.amountPaise * doctor.commissionPercent / 100) } });
  }
  if (invoice.appointmentId) {
    const linked = (await store.list('invoice', { appointmentId: invoice.appointmentId })).filter((i: any) => i.status !== 'CANCELLED');
    const total = linked.reduce((n: number, i: any) => n + i.totalPaise, 0);
    const received = linked.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await tx.appointment.update({ where: { tenantId_id: { tenantId: tenant.id, id: invoice.appointmentId } }, data: { paymentStatus: received >= total ? 'PAID' : received > 0 ? 'PARTIAL' : 'PENDING' } });
  }
  await store.audit(actor.userId, 'payment.received', row.id);
  return { payment: row, replayed: false };
}
