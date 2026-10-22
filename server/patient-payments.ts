import { assert } from './core.js';

export async function recordInvoicePayment({ store, tx, tenant }: any, data: any, actor: any) {
  const previous = await store.list('payment', { idempotencyKey: data.idempotencyKey });
  if (previous.length) {
    assert(previous[0].invoiceId === data.invoiceId && previous[0].amountPaise === data.amountPaise && previous[0].method === data.method && previous[0].reference === data.reference, 409, 'Idempotency key reused with different payment data.');
    return { payment: previous[0], replayed: true };
  }
  const invoice = await store.get('invoice', data.invoiceId);
  assert(data.amountPaise > 0 && data.amountPaise <= invoice.totalPaise - invoice.paidPaise, 409, 'Payment exceeds the invoice balance.');
  const row = await store.create('payment', data);
  const paid = invoice.paidPaise + data.amountPaise;
  await store.update('invoice', invoice.id, { paidPaise: paid, status: paid === invoice.totalPaise ? 'PAID' : 'PARTIAL' });
  if (invoice.sessionId || (invoice.doctorId && invoice.chargeKind === 'PROCEDURE')) {
    const doctorId = invoice.sessionId ? (await store.get('treatmentSession', invoice.sessionId)).doctorId : invoice.doctorId;
    const doctor = await tx.doctor.findFirst({ where: { id: doctorId, tenantId: tenant.id } });
    assert(doctor, 404, 'Treating doctor not found.');
    if (doctor.commissionPercent) await tx.commission.create({ data: { tenantId: tenant.id, doctorId: doctor.id, paymentId: row.id, percent: doctor.commissionPercent, amountPaise: Math.round(data.amountPaise * doctor.commissionPercent / 100) } });
  }
  if (invoice.appointmentId) {
    const linked = await store.list('invoice', { appointmentId: invoice.appointmentId });
    const total = linked.reduce((n: number, i: any) => n + i.totalPaise, 0);
    const received = linked.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await tx.appointment.update({ where: { tenantId_id: { tenantId: tenant.id, id: invoice.appointmentId } }, data: { paymentStatus: received >= total ? 'PAID' : received > 0 ? 'PARTIAL' : 'PENDING' } });
  }
  await store.audit(actor.userId, 'payment.received', row.id);
  return { payment: row, replayed: false };
}
