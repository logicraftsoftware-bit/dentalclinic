import type { Router } from 'express';
import { z } from 'zod';
import { assert, id, money, hash } from './core.js';
import { recordCheckoutPayment } from './patient-payments.js';
import { doctorAvailableAt } from './doctor-branches.js';
import { creditBalance } from './patient-adjustments.js';

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
    const invoices = (await store.list('invoice', { appointmentId: appointment.id })).filter((i: any) => i.status !== 'CANCELLED');
    assert(invoices.length > 0, 400, 'Add a procedure to create a bill.');
    const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0);
    const paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await store.update('appointment', appointment.id, { paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING' });
    await store.audit(actor.userId, 'reception.bill.created', appointment.id);
    return invoices;
}

async function createCheckoutCharges({ store, tx, tenant }: any, appointment: any, input: any) {
  // Verify the scope and all relationships once before writing any bill rows.
  await store.get('patient', appointment.patientId);
  const doctorIds = [...new Set(input.lines.map((line: any) => line.doctorId))];
  const doctors = doctorIds.length ? await store.list('doctor', { id: { in: doctorIds } }) : [];
  assert(doctors.length === doctorIds.length, 404, 'Doctor not found in your clinic.');
  assert(doctors.every((d: any) => d.active && (!appointment.branchId || doctorAvailableAt(d, appointment.branchId))), 400, 'Choose an active doctor from this appointment branch.');
  const invoices = await store.list('invoice', { appointmentId: appointment.id });
  const base = { tenantId: tenant.id, patientId: appointment.patientId, appointmentId: appointment.id };
  const rows: any[] = [];
  const fees = [['Consultant fee', appointment.consultationPaise], ['Visiting consultant fee', appointment.visitingConsultationPaise], ['Clinic fee', appointment.clinicFeePaise]];
  for (const [index, [description, amount]] of fees.entries()) {
    if (Number(amount) > 0 && !invoices.some((i: any) => i.description === description)) rows.push({ ...base, sourceKey: `${appointment.id}:fee:${index}`, description: String(description), chargeKind: 'VISIT', totalPaise: Number(amount) });
  }
  for (const [index, line] of input.lines.entries()) {
    const prefix = `reception:${appointment.id}:${input.checkoutKey}:${index}`;
    if (line.chargePaise) rows.push({ ...base, doctorId: line.doctorId, sourceKey: `${prefix}:procedure`, chargeKind: 'PROCEDURE', description: line.name, totalPaise: line.chargePaise });
    if (line.labChargePaise) rows.push({ ...base, doctorId: line.doctorId, sourceKey: `${prefix}:lab`, chargeKind: 'LAB', description: `Lab: ${line.name}`, totalPaise: line.labChargePaise });
  }
  if (rows.length) await tx.invoice.createMany({ data: rows });
  assert(rows.length || invoices.length, 400, 'Add a procedure to create a bill.');
  return (await store.list('invoice', { appointmentId: appointment.id }, { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })).filter((i: any) => i.status !== 'CANCELLED');
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
    const adjustments = await store.list('patientAdjustment', { patientId: patient.id }, { orderBy: { createdAt: 'desc' } });
    res.json({ appointment, patient, invoices, payments, adjustments, creditBalancePaise: creditBalance(adjustments),
      doctors: doctors.filter((d: any) => !appointment.branchId || doctorAvailableAt(d, appointment.branchId))
        .map((d: any) => ({ id: d.id, name: d.name, specialty: d.specialty })), charges });
  }));

  router.post('/reception/:id/bills', run('billing', async (req: any, res: any, { store }: any, actor: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(!['ABSENT', 'CANCELLED'].includes(appointment.status), 409, 'Mark this patient present before creating a bill.');
    const input = billSchema.parse(req.body);
    res.status(201).json(await saveReceptionBill(store, appointment, input, actor));
  }));

  // Leave headroom for large bills on a remote database; all charges, discounts
  // and payments still commit together, or roll back together.
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
    let invoices = await createCheckoutCharges(ctx, appointment, input);
    const balance = invoices.reduce((n: number, i: any) => n + i.totalPaise - i.paidPaise, 0);
    assert(input.discount.type !== 'PERCENT' || input.discount.value <= 100, 400, 'Discount percentage must be between 0 and 100.');
    assert(input.discount.type !== 'AMOUNT' || Number.isInteger(input.discount.value), 400, 'Discount must be a whole number of paise.');
    const discount = input.discount.type === 'PERCENT' ? Math.round(balance * input.discount.value / 100) : input.discount.value;
    assert(discount <= balance, 400, 'Discount cannot exceed the unpaid balance.');
    assert(input.payment.amountPaise <= balance - discount, 400, 'Paid amount cannot exceed the balance after discount.');
    let remainingDiscount = discount, remainingBalance = balance;
    const discountAudits = [];
    for (const invoice of invoices) {
      const due = invoice.totalPaise - invoice.paidPaise;
      if (!due) continue;
      const share = Number(BigInt(remainingDiscount) * BigInt(due) / BigInt(remainingBalance));
      remainingDiscount -= share; remainingBalance -= due;
      if (!share) continue;
      const net = invoice.totalPaise - share;
      const change = { totalPaise: net, discountPaise: (invoice.discountPaise || 0) + share, discountReason: input.discount.reason || invoice.discountReason || '', status: net === invoice.paidPaise ? 'PAID' : invoice.paidPaise ? 'PARTIAL' : 'UNPAID' };
      await tx.invoice.update({ where: { tenantId_id: { tenantId: tenant.id, id: invoice.id } }, data: change });
      Object.assign(invoice, change);
      discountAudits.push({ tenantId: tenant.id, actorId: actor.userId, action: 'invoice.discount.applied', recordId: invoice.id });
    }
    if (discountAudits.length) await tx.clinicAudit.createMany({ data: discountAudits });
    invoices = await recordCheckoutPayment(ctx, invoices, input.payment, input.checkoutKey, actor);
    const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0), paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await tx.appointment.update({ where: { tenantId_id: { tenantId: tenant.id, id: appointment.id } }, data: { paymentStatus: paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING' } });
    const result = { invoices, totalPaise: total, paidPaise: paid, balancePaise: total - paid };
    await store.audit(actor.userId, 'reception.checkout.saved', appointment.id);
    await store.create('idempotencyRecord', { key, fingerprint, status: 201, body: JSON.parse(JSON.stringify(result)), headers: {} });
    res.status(201).json(result);
  }, false, false, 120000));

  router.post('/reception/:id/line-checkout', run('billing', async (req: any, res: any, ctx: any, actor: any) => {
    const { store, tx, tenant } = ctx;
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(!['ABSENT', 'CANCELLED'].includes(appointment.status), 409, 'Mark this patient present before billing.');
    const input = z.object({
      checkoutKey: z.string().uuid(),
      lines: z.array(z.object({ key: z.string().uuid(), name: z.string().trim().min(1).max(200), doctorId: id, chargePaise: money, labChargePaise: money }).strict().refine(v => v.chargePaise + v.labChargePaise > 0, 'Enter a procedure or lab charge.')).max(50),
      settlements: z.array(z.object({
        invoiceIds: z.array(id).min(1).max(100).optional(), lineKey: z.string().uuid().optional(), feeIndex: z.number().int().min(0).max(2).optional(),
        discountPaise: money, amountPaise: money, method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']), reference: z.string().trim().max(200).default(''),
      }).strict().refine(v => Number(!!v.invoiceIds) + Number(!!v.lineKey) + Number(v.feeIndex !== undefined) === 1, 'Select exactly one procedure.')).max(500),
    }).strict().parse(req.body);
    assert(new Set(input.lines.map(l => l.key)).size === input.lines.length, 400, 'Duplicate procedure key.');
    const key = `reception-line-checkout:${actor.userId}:${appointment.id}:${input.checkoutKey}`, fingerprint = hash(JSON.stringify(input));
    const previous = (await store.list('idempotencyRecord', { key }))[0];
    if (previous) { assert(previous.fingerprint === fingerprint, 409, 'This checkout was already saved with different details.'); res.json(previous.body); return; }
    let invoices = await createCheckoutCharges(ctx, appointment, input);
    const used = new Set<string>();
    const plans = input.settlements.map(s => {
      let selected: any[];
      if (s.invoiceIds) selected = invoices.filter((i: any) => s.invoiceIds!.includes(i.id));
      else if (s.lineKey) {
        const index = input.lines.findIndex(l => l.key === s.lineKey);
        assert(index >= 0, 400, 'Procedure not found in this checkout.');
        const prefix = `reception:${appointment.id}:${input.checkoutKey}:${index}:`;
        selected = invoices.filter((i: any) => i.sourceKey.startsWith(prefix));
      } else selected = invoices.filter((i: any) => i.sourceKey === `${appointment.id}:fee:${s.feeIndex}`);
      assert(selected.length > 0 && (!s.invoiceIds || selected.length === s.invoiceIds.length), 404, 'Procedure not found in this appointment.');
      for (const i of selected) { assert(!used.has(i.id), 400, 'A procedure can only be collected once per checkout.'); used.add(i.id); }
      const balance = selected.reduce((n, i) => n + i.totalPaise - i.paidPaise, 0);
      assert(s.discountPaise <= balance, 400, 'Procedure discount exceeds its unpaid balance.');
      assert(s.amountPaise <= balance - s.discountPaise, 400, 'Collect amount exceeds this procedure balance.');
      return { ...s, selected, balance };
    });
    const updates = new Map<string, any>();
    const audits: any[] = [];
    for (const plan of plans) {
      let remainingDiscount = plan.discountPaise, remainingBalance = plan.balance;
      for (const i of plan.selected) {
        const due = i.totalPaise - i.paidPaise;
        if (!due) continue;
        const share = Number(BigInt(remainingDiscount) * BigInt(due) / BigInt(remainingBalance));
        remainingDiscount -= share; remainingBalance -= due;
        if (!share) continue;
        const change = { totalPaise: i.totalPaise - share, discountPaise: (i.discountPaise || 0) + share, discountReason: 'Procedure discount', status: i.totalPaise - share === i.paidPaise ? 'PAID' : i.paidPaise ? 'PARTIAL' : 'UNPAID' };
        await tx.invoice.update({ where: { tenantId_id: { tenantId: tenant.id, id: i.id } }, data: change });
        Object.assign(i, change);
        audits.push({ tenantId: tenant.id, actorId: actor.userId, action: 'invoice.discount.applied', recordId: i.id });
      }
      const changed = await recordCheckoutPayment(ctx, plan.selected, { amountPaise: plan.amountPaise, method: plan.method, reference: plan.reference }, input.checkoutKey, actor);
      for (const i of changed) updates.set(i.id, i);
    }
    if (audits.length) await tx.clinicAudit.createMany({ data: audits });
    invoices = invoices.map((i: any) => updates.get(i.id) || i);
    const total = invoices.reduce((n: number, i: any) => n + i.totalPaise, 0), paid = invoices.reduce((n: number, i: any) => n + i.paidPaise, 0);
    await tx.appointment.update({ where: { tenantId_id: { tenantId: tenant.id, id: appointment.id } }, data: { paymentStatus: paid >= total ? 'PAID' : paid ? 'PARTIAL' : 'PENDING' } });
    const result = { invoices, totalPaise: total, paidPaise: paid, balancePaise: total - paid };
    await store.audit(actor.userId, 'reception.procedure-checkout.saved', appointment.id);
    await store.create('idempotencyRecord', { key, fingerprint, status: 201, body: JSON.parse(JSON.stringify(result)), headers: {} });
    res.status(201).json(result);
  }, false, false, 120000));
}
