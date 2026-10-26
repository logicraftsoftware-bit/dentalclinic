import type { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { assert, id, money, iso, effectiveLimits, checkLimit } from './core.js';
import { doctorBranches, doctorAvailableAt } from './doctor-branches.js';
import { ensureVisitFees } from './reception.js';

const note = z.string().trim().max(10000).default('');
const tooth = z.string().regex(/^(?:[1-4][1-8]|[5-8][1-5])$/, 'Select a tooth from the permanent or primary tooth list.');
const dentalForm = z.object({
  complaint: note, findings: note, diagnosis: note, advice: note, medication: note,
  medicalHistory: note, allergies: note, consent: z.boolean().default(false),
  surgeryDate: iso.nullable().optional(), nextVisit: iso.nullable().optional(),
  teeth: z.record(tooth, z.object({ condition: z.enum(['Healthy', 'Caries', 'Filled', 'Missing', 'Crown', 'Root canal', 'Implant', 'Planned']), notes: z.string().max(1000).default('') })).default({}),
  lines: z.array(z.object({ tooth, catalogItemId: id.optional(), name: z.string().trim().min(1).max(200), pricePaise: money, labChargePaise: money.default(0), labName: z.string().max(200).default(''), labNotes: note })).max(100).default([]),
  finalize: z.boolean().default(false),
  referral: z.object({ doctorId: id, branchId: id.nullable().optional(), reason: z.string().trim().min(1, 'Enter a referral reason for the receiving doctor.').max(10000) }).optional(),
}).strict();

export function registerDentalRoutes(router: Router, run: any, validateSlot: any) {
  router.get('/referral-doctors', run('clinical', async (_req: any, res: any, { tx, tenant }: any) => {
    const [doctors, branches] = await Promise.all([
      tx.doctor.findMany({ where: { tenantId: tenant.id, active: true }, select: { id: true, name: true, specialty: true, branchId: true, branchIds: true } }),
      tx.branch.findMany({ where: { tenantId: tenant.id, active: true }, select: { id: true, name: true } }),
    ]);
    res.json({ doctors, branches });
  }));
  router.get('/doctors/:id/login', run('staff', async (req: any, res: any, { store, tx, tenant }: any) => {
    const doctor = await store.get('doctor', id.parse(req.params.id));
    const login = await tx.membership.findFirst({ where: { tenantId: tenant.id, doctorId: doctor.id, role: 'DOCTOR' }, select: { id: true, active: true, allDoctorBranches: true, user: { select: { email: true } } } });
    res.json(login || null);
  }));
  router.post('/doctors/:id/login', run('staff', async (req: any, res: any, ctx: any, actor: any) => {
    const { store, tx, tenant, subscription, membership } = ctx;
    assert(['OWNER', 'MANAGER', 'BRANCH_ADMIN'].includes(membership.role), 403, 'Only clinic administrators can manage doctor logins.');
    const doctor = await store.get('doctor', id.parse(req.params.id));
    assert(doctor.active, 409, 'Activate this doctor first.');
    const data = z.object({ email: z.string().email().max(200).transform(v => v.toLowerCase()), password: z.string().min(12).max(128), allDoctorBranches: z.boolean().default(true) }).strict().parse(req.body);
    const old = await tx.membership.findFirst({ where: { tenantId: tenant.id, doctorId: doctor.id, role: 'DOCTOR' } });
    assert(!(await tx.membership.findFirst({ where: { tenantId: tenant.id, doctorId: doctor.id, active: true, ...(old ? { id: { not: old.id } } : {}) } })), 409, 'This doctor already has another active login. Manage it in Team & branches.');
    const collision = await tx.user.findUnique({ where: { email: data.email } });
    assert(!collision || collision.id === old?.userId, 409, 'This email is already used by another login.');
    if (!old || !old.active) checkLimit(effectiveLimits(subscription).staff, await tx.membership.count({ where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } } }));
    const allDoctorBranches = membership.role !== 'BRANCH_ADMIN' && data.allDoctorBranches;
    const accessBranch = allDoctorBranches ? null : membership.branchId || doctor.branchId || null;
    const passwordHash = await bcrypt.hash(data.password, 12);
    let row;
    if (old) {
      assert(old.userId !== actor.userId, 403, 'Use your account password settings to change your own login.');
      if (membership.role === 'BRANCH_ADMIN') assert(old.branchId === membership.branchId, 403, 'This login belongs to another branch.');
      assert(await tx.membership.count({ where: { userId: old.userId } }) === 1, 409, 'Use account password recovery for a shared login.');
      await tx.user.update({ where: { id: old.userId }, data: { email: data.email, passwordHash } });
      row = await tx.membership.update({ where: { id: old.id }, data: { active: true, allDoctorBranches, branchId: accessBranch } });
      await tx.session.deleteMany({ where: { userId: old.userId } });
    } else {
      const user = await tx.user.create({ data: { name: doctor.name, email: data.email, passwordHash } });
      row = await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'DOCTOR', doctorId: doctor.id, branchId: accessBranch, allDoctorBranches } });
    }
    await store.update('doctor', doctor.id, { email: data.email });
    await store.audit(actor.userId, 'doctor.login.updated', doctor.id);
    res.json({ id: row.id, email: data.email, active: row.active });
  }));

  router.get('/dental-visits/:id', run('appointments', async (req: any, res: any, { store, tx, tenant, membership }: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    const patient = await store.get('patient', appointment.patientId);
    const encounters = await store.list('dentalEncounter', { appointmentId: appointment.id });
    assert(!(membership.role === 'DOCTOR' && membership.doctorId === appointment.doctorId && encounters.some((v: any) => v.status === 'REFERRED')), 403, 'This visit has been referred and is closed for the previous doctor. Reception will schedule the receiving doctor.');
    const [history, plans, invoices, referrals] = await Promise.all([
      store.list('dentalEncounter', { patientId: patient.id, status: { not: 'DRAFT' } }, { orderBy: { createdAt: 'desc' } }),
      store.list('treatmentPlan', { patientId: patient.id }, { orderBy: { createdAt: 'desc' } }),
      store.list('invoice', { patientId: patient.id }, { orderBy: { createdAt: 'desc' } }),
      store.list('internalReferral', { patientId: patient.id }, { orderBy: { createdAt: 'desc' } }),
    ]);
    const items = plans.length ? await store.list('treatmentItem', { planId: { in: plans.map((p: any) => p.id) } }) : [];
    const doctors = await tx.doctor.findMany({ where: { tenantId: tenant.id, id: { in: [...new Set([appointment.doctorId, ...history.map((v: any) => v.doctorId)].filter(Boolean))] } }, select: { id: true, name: true } });
    res.json({ doctors, appointment, patient, encounter: encounters[0] || null, history, plans, items, invoices, referrals });
  }));
  router.put('/dental-visits/:id', run('clinical', async (req: any, res: any, { store, tx, tenant, membership }: any, actor: any) => {
    const appointment = await store.get('appointment', id.parse(req.params.id));
    assert(appointment.doctorId, 400, 'Assign a doctor before recording clinical treatment.');
    assert(membership.role !== 'DOCTOR' || membership.doctorId === appointment.doctorId, 403, 'Open your own appointment.');
    assert(!['CANCELLED', 'ABSENT'].includes(appointment.status), 409, 'This appointment cannot be treated in its current attendance status.');
    const data = dentalForm.parse(req.body);
    const patient = await store.get('patient', appointment.patientId);
    const old = (await store.list('dentalEncounter', { appointmentId: appointment.id }))[0];
    assert(!old || old.status === 'DRAFT', 409, 'This visit is closed. Schedule a new visit to continue treatment.');
    assert(appointment.status !== 'COMPLETED' || old?.status === 'DRAFT', 409, 'This appointment is already completed.');
    if (data.finalize) {
      assert(data.complaint && data.diagnosis, 400, 'Enter the complaint and diagnosis before closing the visit.');
      assert(!data.lines.length || data.consent, 400, 'Record patient consent before closing a treated visit.');
    }
    assert(!data.referral || data.finalize, 400, 'Finish the visit to submit its referral.');
    for (const line of data.lines) if (line.catalogItemId) assert((await store.get('catalogItem', line.catalogItemId)).active, 400, 'Choose an active charge.');
    let target: any = null, targetBranch: string | null = null;
    if (data.referral) {
      assert(data.referral.doctorId !== appointment.doctorId, 400, 'Choose another doctor for an internal referral.');
      target = await tx.doctor.findFirst({ where: { id: data.referral.doctorId, tenantId: tenant.id, active: true } });
      assert(target, 404, 'Referred doctor not found in this clinic.');
      targetBranch = data.referral.branchId || (doctorAvailableAt(target, appointment.branchId) ? appointment.branchId : target.branchId) || null;
      assert(!doctorBranches(target).length || (targetBranch && doctorAvailableAt(target, targetBranch)), 400, 'Select a branch assigned to the referred doctor.');
      if (targetBranch) assert(await tx.branch.findFirst({ where: { id: targetBranch, tenantId: tenant.id, active: true } }), 400, 'Choose an active referral branch.');
    }
    const { finalize, referral, ...fields } = data;
    const value = { ...fields, surgeryDate: fields.surgeryDate || null, nextVisit: fields.nextVisit || null, status: finalize ? referral ? 'REFERRED' : 'CLOSED' : 'DRAFT' };
    let encounter = old
      ? await tx.dentalEncounter.update({ where: { tenantId_id: { tenantId: tenant.id, id: old.id } }, data: value })
      : await tx.dentalEncounter.create({ data: { ...value, tenantId: tenant.id, patientId: patient.id, appointmentId: appointment.id, doctorId: appointment.doctorId, branchId: appointment.branchId } });
    if (finalize) {
      await tx.patient.update({ where: { tenantId_id: { tenantId: tenant.id, id: patient.id } }, data: { medicalHistory: data.medicalHistory, allergies: data.allergies } });
      const plan = await store.create('treatmentPlan', { patientId: patient.id, title: `Dental visit ${new Date(appointment.startsAt).toISOString().slice(0, 10)}`, status: 'COMPLETED' });
      for (const [index, line] of data.lines.entries()) {
        const item = await store.create('treatmentItem', { planId: plan.id, tooth: line.tooth, name: line.name, pricePaise: line.pricePaise, labChargePaise: line.labChargePaise, plannedSessions: 1, status: 'COMPLETED', ...(line.catalogItemId ? { catalogItemId: line.catalogItemId } : {}) });
        const session = await store.create('treatmentSession', { itemId: item.id, doctorId: appointment.doctorId, notes: data.findings || line.name, feePaise: line.pricePaise });
        if (line.pricePaise) await store.create('invoice', { patientId: patient.id, appointmentId: appointment.id, sessionId: session.id, sourceKey: `${encounter.id}:procedure:${index}`, description: `${line.name} - Tooth ${line.tooth}`, totalPaise: line.pricePaise });
        if (line.labChargePaise) await store.create('invoice', { patientId: patient.id, appointmentId: appointment.id, sourceKey: `${encounter.id}:lab:${index}`, description: `Lab: ${line.name} - Tooth ${line.tooth}${line.labName ? ' - ' + line.labName : ''}`, totalPaise: line.labChargePaise });
      }
      await ensureVisitFees(store, appointment);
      await store.create('clinicalNote', { patientId: patient.id, authorId: actor.userId, complaint: data.complaint, findings: data.findings, diagnosis: data.diagnosis, advice: data.advice });
      await store.create('chartVersion', { patientId: patient.id, authorId: actor.userId, teeth: data.teeth });
      if (data.medication) await store.create('prescription', { patientId: patient.id, authorId: actor.userId, medication: data.medication, instructions: data.advice || 'As prescribed during the visit' });
      if (data.nextVisit) await store.create('followUp', { patientId: patient.id, title: `Review after dental visit: ${data.diagnosis}`, dueAt: data.nextVisit });
      if (referral) await tx.internalReferral.create({ data: { tenantId: tenant.id, patientId: patient.id, encounterId: encounter.id, sourceAppointmentId: appointment.id, fromDoctorId: appointment.doctorId, toDoctorId: target.id, sourceBranchId: appointment.branchId, targetBranchId: targetBranch, reason: referral.reason } });
      encounter = await tx.dentalEncounter.update({ where: { tenantId_id: { tenantId: tenant.id, id: encounter.id } }, data: { planId: plan.id } });
      const visitInvoices = (await store.list('invoice', { appointmentId: appointment.id })).filter((i: any) => i.status !== 'CANCELLED');
      const total = visitInvoices.reduce((sum: number, i: any) => sum + i.totalPaise, 0);
      const paid = visitInvoices.reduce((sum: number, i: any) => sum + i.paidPaise, 0);
      await store.update('appointment', appointment.id, { status: 'COMPLETED', paymentStatus: !total ? 'NOT_REQUIRED' : paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'PENDING' });
    }
    await store.audit(actor.userId, finalize ? 'dental.visit.closed' : 'dental.visit.draft', encounter.id);
    res.json(encounter);
  }));

  router.get('/internal-referrals', run('appointments', async (_req: any, res: any, { store, tx, tenant }: any) => {
    const rows = await store.list('internalReferral', {}, { orderBy: { createdAt: 'desc' }, take: 500 });
    const doctorIds = [...new Set(rows.flatMap((r: any) => [r.fromDoctorId, r.toDoctorId]))];
    const doctors = await tx.doctor.findMany({ where: { tenantId: tenant.id, id: { in: doctorIds } }, select: { id: true, name: true } });
    const patients = rows.length ? await store.list('patient', { id: { in: [...new Set(rows.map((r: any) => r.patientId))] } }, { select: { id: true, name: true, phone: true } }) : [];
    res.json({ rows, doctors, patients });
  }));
  router.get('/internal-referrals/:id', run('appointments', async (req: any, res: any, { store, tx, tenant, membership }: any) => {
    assert(membership.role !== 'DOCTOR', 403, 'Reception schedules internal referrals.');
    const referral = await store.get('internalReferral', id.parse(req.params.id));
    const patient = await store.get('patient', referral.patientId);
    const encounter = await store.get('dentalEncounter', referral.encounterId);
    const doctor = await tx.doctor.findFirst({ where: { id: referral.toDoctorId, tenantId: tenant.id }, select: { id: true, name: true, branchId: true, branchIds: true, active: true, consultationPaise: true, visitingConsultationPaise: true } });
    const [history, invoices, plans] = await Promise.all([store.list('dentalEncounter', { patientId: patient.id, status: { not: 'DRAFT' } }, { orderBy: { createdAt: 'desc' } }), store.list('invoice', { patientId: patient.id }), store.list('treatmentPlan', { patientId: patient.id })]);
    const items = plans.length ? await store.list('treatmentItem', { planId: { in: plans.map((p: any) => p.id) } }) : [];
    res.json({ referral, patient, encounter, doctor, history, invoices, plans, items });
  }));
  router.post('/internal-referrals/:id/schedule', run('appointments', async (req: any, res: any, { store, membership }: any, actor: any) => {
    assert(membership.role !== 'DOCTOR', 403, 'Reception schedules internal referrals.');
    const referral = await store.get('internalReferral', id.parse(req.params.id));
    assert(referral.status === 'PENDING', 409, 'This referral has already been scheduled.');
    assert(!membership.branchId || membership.branchId === referral.targetBranchId, 403, 'The receiving branch reception must schedule this referral.');
    const input = z.object({ startsAt: iso, durationMinutes: z.number().int().min(5).max(480).default(30), useClinicFee: z.boolean().default(false), notes: note }).strict().parse(req.body);
    const doctor = await store.get('doctor', referral.toDoctorId);
    const data: any = { ...input, patientId: referral.patientId, doctorId: referral.toDoctorId, branchId: referral.targetBranchId || undefined, referralId: referral.id, reason: 'Internal referral', consultationPaise: doctor.consultationPaise, visitingConsultationPaise: doctor.visitingConsultationPaise, clinicFeePaise: input.useClinicFee ? 30000 : 0 };
    await validateSlot(store, data);
    const appointment = await store.create('appointment', data);
    await store.update('internalReferral', referral.id, { status: 'SCHEDULED', scheduledAppointmentId: appointment.id });
    await store.audit(actor.userId, 'referral.scheduled', referral.id);
    res.status(201).json(appointment);
  }));
}
