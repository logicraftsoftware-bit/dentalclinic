import type { Router } from 'express';
import { z } from 'zod';
import { assert, id, money, hash } from './core.js';
import { recordInvoicePayment } from './patient-payments.js';
import { doctorAvailableAt } from './doctor-branches.js';

// The same source keys are used when the doctor closes a visit, so reception
// can collect its selected appointment fee without billing that fee twice.
export async function ensureVisitFees(store: any, appointment: any) {
  const existing = await store.list('invoice', { appointmentId: appointment.id });
  const fees = [
    ['Consultant fee', appointment.consultationPaise],
    ['Visiting consultant fee', appointment.visitingConsultationPaise],
    ['Clinic fee', appointment.clinicFeePaise],
  ];
  for (const [index, [description, amount]] of fees.entries()) {
    if (Number(amount) > 0 && !existing.some((i: any) => i.description === description)) {
      await store.create('invoice', {
        patientId: appointment.patientId, appointmentId: appointment.id,
        sourceKey: `${appointment.id}:fee:${index}`, description: String(description),
        chargeKind: 'VISIT', totalPaise: Number(amount),
      });
    }
  }
}

const billSchema = z.object({
      billKey: z.string().uuid(),
      lines: z.array(z.object({
        name: z.string().trim().min(1).max(200), doctorId: id,
        chargePaise: money, labChargePaise: money,
      }).strict().refine(v => v.chargePaise + v.labChargePaise > 0, 'Enter a procedure or lab charge.')).max(50),
    }).strict();

async function saveReceptionBill(store: any, appointment: any, input: z.infer<typeof billSchema>, actor: any) {
    // Stable batch keys protect against duplicate bills even after a network retry.
    const prefix = `reception:${appointment.id}:${input.billKey}:`;
    const existing = await store.list('invoice', { appointmentId: appointment.id, sourceKey: { startsWith: prefix } });
    if (existing.length) {
      const expected = input.lines.flatMap((line, index) => [
        ...(line.chargePaise ? [{ sourceKey: `${prefix}${index}:procedure`, description: line.name, doctorId: line.doctorId, totalPaise: line.chargePaise }] : []),
        ...(line.labChargePaise ? [{ sourceKey: `${prefix}${index}:lab`, description: `Lab: ${line.name}`, doctorId: line.doctorId, totalPaise: line.labChargePaise }] : []),
      ]);
      assert(expected.length === existing.length && expected.every(row => existing.some((i: any) => i.sourceKey === row.sourceKey && i.description === row.description && i.doctorId === row.doctorId && i.totalPaise === row.totalPaise)), 409, 'This bill has already been saved with different charges. Reopen the billing desk to add another bill.');
      return existing;
    }
    for (const line of input.lines) {
      const doctor = await store.get('doctor', line.doctorId);
      assert(doctor.active && (!appointment.branchId || doctorAvailableAt(doctor, appointment.branchId)), 400, 'Choose an active doctor from this appointment branch.');
    }
    await ensureVisitFees(store, appointment);
    for (const [index, line] of input.lines.entries()) {
      const base = { patientId: appointment.patientId, appointmentId: appointment.id, doctorId: line.doctorId };
      if (line.chargePaise) await store.create('invoice', { ...base, sourceKey: `${prefix}${index}:procedure`, chargeKind: 'PROCEDURE', description: line.name, totalPaise: line.chargePaise });
      if (line.labChargePaise) await store.create('invoice', { ...base, sourceKey: `${prefix}${index}:lab`, chargeKind: 'LAB', description: `Lab: ${line.name}`, totalPaise: line.labChargePaise });
    }
    const invoices = await store.list('invoice', { appointmentId: appointment.id });
    assert(invoices.length > 0, 400, 'Add a procedure to create a bill.');
    const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0);
    const paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await store.update('appointment', appointment.id, { paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING' });
    await store.audit(actor.userId, 'reception.bill.created', appointment.id);
    return invoices;
}

export function registerReceptionRoutes(router: Router, run: any) {
  router.get('/reception/:id', run('billing', async (req: any, res: any, { store }: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    const [patient, invoices, doctors, charges] = await Promise.all([
      store.get('patient', appointment.patientId),
      store.list('invoice', { appointmentId: appointment.id }, { orderBy: { createdAt: 'asc' } }),
      store.list('doctor', { active: true }),
      store.list('catalogItem', { active: true }),
    ]);
    const payments = invoices.length ? await store.list('payment', { invoiceId: { in: invoices.map((i: any) => i.id) } }, { orderBy: { createdAt: 'desc' } }) : [];
    res.json({ appointment, patient, invoices, payments,
      doctors: doctors.filter((d: any) => !appointment.branchId || doctorAvailableAt(d, appointment.branchId))
        .map((d: any) => ({ id: d.id, name: d.name, specialty: d.specialty })), charges });
  }));

  router.post('/reception/:id/bills', run('billing', async (req: any, res: any, { store }: any, actor: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(!['ABSENT', 'CANCELLED'].includes(appointment.status), 409, 'Mark this patient present before creating a bill.');
    const input = billSchema.parse(req.body);
    res.status(201).json(await saveReceptionBill(store, appointment, input, actor));
  }));

  router.post('/reception/:id/checkout', run('billing', async (req: any, res: any, ctx: any, actor: any) => {
    const { store, tx, tenant } = ctx;
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(!['ABSENT', 'CANCELLED'].includes(appointment.status), 409, 'Mark this patient present before billing.');
    const input = z.object({
      checkoutKey: z.string().uuid(), lines: billSchema.shape.lines,
      discount: z.object({ type: z.enum(['AMOUNT', 'PERCENT']), value: z.number().finite().min(0).max(1000000000), reason: z.string().trim().max(200).default('') }).strict(),
      payment: z.object({ amountPaise: money, method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().trim().max(200).default('') }).strict(),
    }).strict().parse(req.body);
    const key = `reception-checkout:${actor.userId}:${appointment.id}:${input.checkoutKey}`;
    const fingerprint = hash(JSON.stringify(input));
    const previous = (await store.list('idempotencyRecord', { key }))[0];
    if (previous) {
      assert(previous.fingerprint === fingerprint, 409, 'This checkout was already saved with different details. Refresh the bill before continuing.');
      res.json(previous.body); return;
    }
    await saveReceptionBill(store, appointment, { billKey: input.checkoutKey, lines: input.lines }, actor);
    let invoices = await store.list('invoice', { appointmentId: appointment.id }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const balance = invoices.reduce((n: number, i: any) => n + i.totalPaise - i.paidPaise, 0);
    assert(input.discount.type !== 'PERCENT' || input.discount.value <= 100, 400, 'Discount percentage must be between 0 and 100.');
    assert(input.discount.type !== 'AMOUNT' || Number.isInteger(input.discount.value), 400, 'Discount must be a whole number of paise.');
    const discount = input.discount.type === 'PERCENT' ? Math.round(balance * input.discount.value / 100) : input.discount.value;
    assert(discount <= balance, 400, 'Discount cannot exceed the unpaid balance.');
    assert(input.payment.amountPaise <= balance - discount, 400, 'Paid amount cannot exceed the balance after discount.');
    let remainingDiscount = discount, remainingBalance = balance;
    for (const invoice of invoices) {
      const due = invoice.totalPaise - invoice.paidPaise;
      if (!due) continue;
      const share = Number(BigInt(remainingDiscount) * BigInt(due) / BigInt(remainingBalance));
      remainingDiscount -= share; remainingBalance -= due;
      if (!share) continue;
      const net = invoice.totalPaise - share;
      await store.update('invoice', invoice.id, { totalPaise: net, discountPaise: (invoice.discountPaise || 0) + share, discountReason: input.discount.reason || invoice.discountReason || '', status: net === invoice.paidPaise ? 'PAID' : invoice.paidPaise ? 'PARTIAL' : 'UNPAID' });
      await store.audit(actor.userId, 'invoice.discount.applied', invoice.id);
    }
    invoices = await store.list('invoice', { appointmentId: appointment.id }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    let remainingPayment = input.payment.amountPaise;
    for (const invoice of invoices) {
      const amountPaise = Math.min(remainingPayment, invoice.totalPaise - invoice.paidPaise);
      if (!amountPaise) continue;
      await recordInvoicePayment(ctx, { invoiceId: invoice.id, amountPaise, method: input.payment.method, reference: input.payment.reference, idempotencyKey: `${input.checkoutKey}:${invoice.id}` }, actor);
      remainingPayment -= amountPaise;
    }
    invoices = await store.list('invoice', { appointmentId: appointment.id }, { orderBy: { createdAt: 'asc' } });
    const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0), paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await tx.appointment.update({ where: { tenantId_id: { tenantId: tenant.id, id: appointment.id } }, data: { paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING' } });
    const result = { invoices, totalPaise: total, paidPaise: paid, balancePaise: total - paid };
    await store.audit(actor.userId, 'reception.checkout.saved', appointment.id);
    await store.create('idempotencyRecord', { key, fingerprint, status: 201, body: JSON.parse(JSON.stringify(result)), headers: {} });
    res.status(201).json(result);
  }));
}
