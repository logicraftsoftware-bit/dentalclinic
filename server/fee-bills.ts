import { paymentParts } from './payment-parts.js';
import { departmentCategory } from '../shared/bill-categories.js';
import { z } from 'zod';
import { assert, id, money, hash } from './core.js';
import { doctorAvailableAt } from './doctor-branches.js';
import { recordCheckoutPayment } from './patient-payments.js';
import { chargeDepartment, chargeDepartments } from '../shared/charge-groups.js';
import { ensureVisitFees } from './visit-fees.js';

export const feeBillSchema = z.object({
  checkoutKey: z.string().uuid(),
  clinicFee: z.boolean(),
  lines: z.array(z.object({ catalogItemId: id, doctorId: id, department: z.enum(chargeDepartments) }).strict()).max(50),
  payment: z.object({ status: z.enum(['PAID', 'PARTIAL', 'PENDING']), splits: paymentParts, method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), amountPaise: money }).strict(),
}).strict();

export async function saveFeeBill(ctx: any, patientId: string, input: z.infer<typeof feeBillSchema>, actor: any, appointment?: any) {
  const { store } = ctx;
  const key = `fee-bill:${input.checkoutKey}`;
  const fingerprint = hash(JSON.stringify({ patientId, appointmentId: appointment?.id, input }));
  const previous = (await store.list('idempotencyRecord', { key }))[0];
  if (previous) {
    assert(previous.fingerprint === fingerprint, 409, 'This bill has already been saved with different details.');
    return previous.body;
  }
  const patient = await store.get('patient', patientId);
  const branchId = appointment?.branchId || patient.branchId;
  const lines = [];
  for (const line of input.lines) {
    const charge = await store.get('catalogItem', line.catalogItemId);
    assert(charge.active && charge.chargeGroupId, 400, 'Choose an active procedure with a subgroup.');
    const group = await store.get('chargeGroup', charge.chargeGroupId);
    assert(group.active && chargeDepartment(group) === line.department, 400, 'Procedure does not belong to the selected department.');
    const doctor = await store.get('doctor', line.doctorId);
    assert(doctor.active && (!branchId || doctorAvailableAt(doctor, branchId)), 400, 'Choose an active treating doctor available at this branch.');
    lines.push({ charge, doctor, department: line.department });
  }
  const total = (appointment ? appointment.clinicFeePaise + appointment.consultationPaise + appointment.visitingConsultationPaise : input.clinicFee ? 30000 : 0)
    + lines.reduce((sum, { charge }) => sum + charge.pricePaise + (charge.labChargePaise || 0), 0);
  const amount = input.payment.amountPaise;
  assert(total > 0, 400, 'Select a fee or procedure to create a bill.');
  assert(amount <= total, 400, 'Paid amount cannot exceed the bill total.');
  assert(input.payment.status === 'PAID' ? amount === total : input.payment.status === 'PENDING' ? amount === 0 : amount > 0 && amount < total, 400, 'Paid amount must match the selected payment status.');
  const base = { patientId, ...(appointment ? { appointmentId: appointment.id } : {}) };
  const invoices = [];
  if (appointment) {
    await ensureVisitFees(store, appointment);
    invoices.push(...await store.list('invoice', { appointmentId: appointment.id }));
  } else if (input.clinicFee) {
    invoices.push(await store.create('invoice', { ...base, sourceKey: `${input.checkoutKey}:clinic`, description: 'Clinic fee', billCategory: 'CLINIC', chargeKind: 'VISIT', totalPaise: 30000 }));
  }
  for (const [index, { charge, doctor, department }] of lines.entries()) {
    for (const [kind, value] of [['PROCEDURE', charge.pricePaise], ['LAB', charge.labChargePaise || 0]] as const) {
      if (!value) continue;
      invoices.push(await store.create('invoice', { ...base, sourceKey: `${input.checkoutKey}:${index}:${kind}`, billCategory: departmentCategory(department), department, catalogItemId: charge.id, doctorId: doctor.id, chargeKind: kind, description: kind === 'LAB' ? `Lab: ${charge.name}` : charge.name, totalPaise: value }));
    }
  }
  const paidInvoices = await recordCheckoutPayment(ctx, invoices, { amountPaise: amount, splits: input.payment.splits, method: input.payment.method, reference: '' }, input.checkoutKey, actor);
  if (appointment) await store.update('appointment', appointment.id, { paymentStatus: input.payment.status });
  await store.audit(actor.userId, 'fees.bill.created', appointment?.id || patientId);
  const result = { invoices: paidInvoices, totalPaise: total, paidPaise: amount, balancePaise: total - amount };
  await store.create('idempotencyRecord', { key, fingerprint, status: 201, body: JSON.parse(JSON.stringify(result)), headers: {} });
  return result;
}
