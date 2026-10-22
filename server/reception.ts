import type { Router } from 'express';
import { z } from 'zod';
import { assert, id, money } from './core.js';
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

export function registerReceptionRoutes(router: Router, run: any) {
  router.get('/reception/:id', run('billing', async (req: any, res: any, { store }: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    const [patient, invoices, doctors, charges] = await Promise.all([
      store.get('patient', appointment.patientId),
      store.list('invoice', { appointmentId: appointment.id }, { orderBy: { createdAt: 'asc' } }),
      store.list('doctor', { active: true }),
      store.list('catalogItem', { active: true }),
    ]);
    res.json({ appointment, patient, invoices,
      doctors: doctors.filter((d: any) => !appointment.branchId || doctorAvailableAt(d, appointment.branchId))
        .map((d: any) => ({ id: d.id, name: d.name, specialty: d.specialty })), charges });
  }));

  router.post('/reception/:id/bills', run('billing', async (req: any, res: any, { store }: any, actor: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(!['ABSENT', 'CANCELLED'].includes(appointment.status), 409, 'Mark this patient present before creating a bill.');
    const input = z.object({
      billKey: z.string().uuid(),
      lines: z.array(z.object({
        name: z.string().trim().min(1).max(200), doctorId: id,
        chargePaise: money, labChargePaise: money,
      }).strict().refine(v => v.chargePaise + v.labChargePaise > 0, 'Enter a procedure or lab charge.')).max(50),
    }).strict().parse(req.body);
    // Stable batch keys protect against duplicate bills even after a network retry.
    const prefix = `reception:${appointment.id}:${input.billKey}:`;
    const existing = await store.list('invoice', { appointmentId: appointment.id, sourceKey: { startsWith: prefix } });
    if (existing.length) {
      const expected = input.lines.flatMap((line, index) => [
        ...(line.chargePaise ? [{ sourceKey: `${prefix}${index}:procedure`, description: line.name, doctorId: line.doctorId, totalPaise: line.chargePaise }] : []),
        ...(line.labChargePaise ? [{ sourceKey: `${prefix}${index}:lab`, description: `Lab: ${line.name}`, doctorId: line.doctorId, totalPaise: line.labChargePaise }] : []),
      ]);
      assert(expected.length === existing.length && expected.every(row => existing.some((i: any) => i.sourceKey === row.sourceKey && i.description === row.description && i.doctorId === row.doctorId && i.totalPaise === row.totalPaise)), 409, 'This bill has already been saved with different charges. Reopen the billing desk to add another bill.');
      res.json(existing); return;
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
    res.status(201).json(invoices);
  }));
}
