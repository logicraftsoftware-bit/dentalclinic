import { recordInvoicePayment } from './patient-payments.js';
import { accountsReport } from './accounts-report.js';
import { registerDentalRoutes } from './dental.js';
import { registerReceptionRoutes } from './reception.js';
import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import { saveDocument, loadDocument, deleteDocument } from './storage.js';
import {
  authenticate,
  permission,
  clinic,
  assert,
  effectiveLimits,
  checkLimit,
  id,
  text,
  money,
  iso,
  opaque,
  hash,
  type OwnedModel,
} from './core.js';
import { transactionalReply } from './reply.js';
import { zonedDayRange, dateKey, midnight } from './time.js';
import { doctorAvailableAt, doctorBranches } from './doctor-branches.js';

export const clinicApi = Router();
const run =
  (capability: string, fn: any, accessOnly = false, readOnly = false, transactionTimeoutMs = 20000) =>
  (req: any, res: any, next: any) =>
    authenticate(req)
      .then((actor) =>
        clinic(
          actor,
          capability,
          (ctx) => transactionalReply(req, ctx.store, (reply) => fn(req, reply, ctx, actor)),
          {
            accessOnly, hostname: req.hostname,
            transactionTimeoutMs,
            // Export and downloads write audit records and must retain the write transaction.
            readOnly: readOnly || (req.method === 'GET' && req.path !== '/export' && !req.path.endsWith('/download')),
          },
        ),
      )
      .then((reply) => reply.flush(res))
      .catch(next);
const string = z.string().max(10000).default('');
const schemas: Record<
  string,
  {
    model: OwnedModel;
    cap: string;
    limit?: string;
    schema: z.AnyZodObject;
    refs?: Record<string, OwnedModel>;
  }
> = {
  patients: {
    model: 'patient',
    cap: 'patients',
    limit: 'patients',
    schema: z.object({
      branchId: id.optional(),
      doctorId: id.optional(),
      name: text,
      phone: z.string().min(8).max(20),
      email: z.union([z.string().email(), z.literal('')]).default(''),
      gender: z.enum(['Female', 'Male', 'Other', 'Unspecified']).default('Unspecified'),
      dob: iso.optional(),
      address: string,
      allergies: string,
      medicalHistory: string,
      consent: z.boolean().default(false),
    }),
  },
  doctors: {
    model: 'doctor',
    cap: 'doctors',
    limit: 'doctors',
    schema: z.object({
      name: text,
      email: z.union([z.string().email(), z.literal('')]).default(''),
      phone: string,
      specialty: z.string().max(200).default('General Dentistry'),
      qualification: z.string().trim().max(200).default(''),
      specialityId: id.optional(),
      registrationNumber: string,
      commissionPercent: z.number().int().min(0).max(100).default(40),
      consultationPaise: money.default(30000),
      visitingConsultationPaise: money.default(100000),
      branchId: id.optional(),
      branchIds: z.array(id).max(100).optional(),
    }),
    refs: { branchId: 'branch', specialityId: 'speciality' },
  },
  branches: {
    model: 'branch',
    cap: 'settings',
    limit: 'branches',
    schema: z.object({ name: text, address: string }),
  },
  appointments: {
    model: 'appointment',
    cap: 'appointments',
    schema: z.object({
      patientId: id,
      doctorId: id,
      branchId: id.optional(),
      startsAt: iso,
      durationMinutes: z.number().int().min(5).max(480).default(30),
      reason: z.string().max(200).default('Consultation'),
      useClinicFee: z.boolean().default(false),
      feeType: z.enum(['consultant', 'visiting', 'clinic']).optional(),
      notes: string,
    }),
    refs: { patientId: 'patient', doctorId: 'doctor', branchId: 'branch' },
  },
  notes: {
    model: 'clinicalNote',
    cap: 'clinical',
    schema: z.object({
      patientId: id,
      complaint: text,
      findings: string,
      diagnosis: string,
      advice: string,
    }),
    refs: { patientId: 'patient' },
  },
  charts: {
    model: 'chartVersion',
    cap: 'clinical',
    schema: z.object({
      patientId: id,
      teeth: z
        .record(
          z.string().regex(/^(?:[1-4][1-8]|[5-8][1-5])$/),
          z.object({
            condition: z.enum([
              'Healthy',
              'Caries',
              'Filled',
              'Missing',
              'Crown',
              'Root canal',
              'Implant',
              'Planned',
            ]),
            notes: z.string().max(1000).default(''),
          }),
        )
        .refine((t) => Object.keys(t).length <= 52),
    }),
    refs: { patientId: 'patient' },
  },
  specialities: { model: 'speciality', cap: 'settings', schema: z.object({ name: text }) },
  'charge-groups': { model: 'chargeGroup', cap: 'settings', schema: z.object({ name: text }) },
  charges: {
    model: 'catalogItem',
    cap: 'settings',
    schema: z.object({
      chargeGroupId: id,
      name: text,
      pricePaise: money,
      labChargePaise: money.default(0),
      sessions: z.number().int().min(1).max(30).default(1),
    }),
    refs: { chargeGroupId: 'chargeGroup' },
  },
  catalog: {
    model: 'catalogItem',
    cap: 'settings',
    schema: z.object({
      name: text,
      pricePaise: money,
      labChargePaise: money.default(0),
      chargeGroupId: id.optional(),
      sessions: z.number().int().min(1).max(30).default(1),
    }),
  },
  plans: {
    model: 'treatmentPlan',
    cap: 'clinical',
    schema: z.object({ patientId: id, title: text }),
    refs: { patientId: 'patient' },
  },
  items: {
    model: 'treatmentItem',
    cap: 'clinical',
    schema: z.object({
      planId: id,
      catalogItemId: id.optional(),
      labChargePaise: money.default(0),
      tooth: z.string().regex(/^(?:[1-4][1-8]|[5-8][1-5])$/),
      name: text,
      pricePaise: money,
      plannedSessions: z.number().int().min(1).max(30).default(1),
    }),
    refs: { planId: 'treatmentPlan', catalogItemId: 'catalogItem' },
  },
  prescriptions: {
    model: 'prescription',
    cap: 'clinical',
    schema: z.object({ patientId: id, medication: text, instructions: text }),
    refs: { patientId: 'patient' },
  },
  followups: {
    model: 'followUp',
    cap: 'patients',
    schema: z.object({ patientId: id, title: text, dueAt: iso }),
    refs: { patientId: 'patient' },
  },
  communications: {
    model: 'communication',
    cap: 'patients',
    schema: z.object({
      patientId: id,
      channel: z.enum(['PHONE', 'EMAIL', 'SMS', 'WHATSAPP']),
      message: text,
    }),
    refs: { patientId: 'patient' },
  },
  invoices: {
    model: 'invoice',
    cap: 'billing',
    schema: z.object({
      patientId: id,
      description: text,
      totalPaise: money.refine((n) => n > 0),
      dueAt: iso.optional(),
    }),
    refs: { patientId: 'patient' },
  },
};
const readOnly: Record<string, { model: OwnedModel; cap: string }> = {
  sessions: { model: 'treatmentSession', cap: 'clinical' },
  payments: { model: 'payment', cap: 'billing' },
  commissions: { model: 'commission', cap: 'commissions' },
  documents: { model: 'document', cap: 'documents' },
  audit: { model: 'clinicAudit', cap: 'settings' },
};
clinicApi.get(
  '/overview',
  run(
    'dashboard',
    async (_req: any, res: any, { store, tenant, subscription, membership }: any) => {
      const [patients, doctors, appointments, invoices, followups] = await Promise.all([
        store.count('patient', { archived: false }),
        store.list('doctor', { active: true }),
        store.list(
          'appointment',
          { startsAt: zonedDayRange(new Date(), tenant.settings?.timezone || 'Asia/Kolkata') },
          { orderBy: { startsAt: 'asc' } },
        ),
        permissionFinancial(membership.role) ? store.list('invoice') : Promise.resolve([]),
        ['OWNER', 'MANAGER', 'BRANCH_ADMIN', 'DOCTOR', 'RECEPTIONIST'].includes(membership.role)
          ? store.list('followUp', { status: 'OPEN' }, { orderBy: { dueAt: 'asc' }, take: 5 })
          : Promise.resolve([]),
      ]);
      const patientIds = [...new Set(appointments.map((a: any) => a.patientId))];
      const appointmentPatients = patientIds.length
        ? await store.list('patient', { id: { in: patientIds } }, { select: { id: true, name: true } })
        : [];
      const patientNames = new Map(appointmentPatients.map((p: any) => [p.id, p.name]));
      const missingDoctorIds = [...new Set(appointments.map((a: any) => a.doctorId))]
        .filter(id => !doctors.some((d: any) => d.id === id));
      const otherDoctors = missingDoctorIds.length
        ? await store.list('doctor', { id: { in: missingDoctorIds } }, { select: { id: true, name: true } })
        : [];
      const doctorNames = new Map([...doctors, ...otherDoctors].map((d: any) => [d.id, d.name]));
      const appts = appointments.map((a: any) => ({
        ...a, patientName: patientNames.get(a.patientId) || 'Patient',
        doctorName: doctorNames.get(a.doctorId) || 'Doctor',
      }));
      res.json({
        tenant,
        subscription,
        role: membership.role,
        patients,
        doctors: doctors.length,
        appointments: appts,
        followups,
        collectionsPaise: invoices.reduce((s: number, i: any) => s + i.paidPaise, 0),
        outstandingPaise: invoices.reduce((s: number, i: any) => s + i.totalPaise - i.paidPaise, 0),
      });
    },
  ),
);
function permissionFinancial(role: string) {
  return ['OWNER', 'MANAGER', 'BRANCH_ADMIN', 'ACCOUNTANT', 'RECEPTIONIST'].includes(role);
}
clinicApi.get(
  '/workspace',
  run(
    'dashboard',
    async (_req: any, res: any, { tenant, subscription, membership }: any) =>
      res.json({
        tenant,
        subscription,
        role: membership.role,
        branchId: membership.branchId,
        doctorId: membership.doctorId,
        capabilities: [
          'dashboard',
          'patients',
          'appointments',
          'clinical',
          'documents',
          'catalog',
          'billing',
          'reports',
          'commissions',
          'staff',
          'doctors',
          'settings',
        ].filter((c) => permission(membership.role, c)),
      }),
    true,
  ),
);
// Names and referenced masters are validated inside the serialized clinic transaction.
async function prepareMasterData(resource: string, data: any, store: any, old?: any) {
  if (resource === 'doctors') {
    if (data.branchIds !== undefined) {
      data.branchIds = [...new Set(data.branchIds)];
      assert(!data.branchId || data.branchIds.includes(data.branchId), 400, 'The primary branch must be one of the selected branches.');
      data.branchId = data.branchIds[0] || null;
    } else if (data.branchId !== undefined) data.branchIds = [data.branchId];
    for (const branchId of data.branchIds || []) {
      const branch = await store.get('branch', branchId);
      assert(branch.active || (old && doctorBranches(old).includes(branchId) && data.active !== true), 409, 'Choose active branches for this doctor.');
    }
  }
  if (
    ['specialities', 'charge-groups', 'charges', 'catalog'].includes(resource) &&
    data.name !== undefined
  ) {
    data.name = data.name.trim().replace(/\s+/g, ' ');
    const model = schemas[resource].model;
    const duplicates = await store.count(model, {
      name: { equals: data.name, mode: 'insensitive' },
      ...(old ? { id: { not: old.id } } : {}),
    });
    assert(!duplicates, 409, 'A master with this name already exists in your clinic.');
    if (['specialities', 'charge-groups'].includes(resource))
      data.nameKey = data.name.toLowerCase();
  }
  if (resource === 'doctors' && (data.specialityId || old?.specialityId)) {
    const speciality = await store.get('speciality', data.specialityId || old.specialityId);
    assert(
      speciality.active || (old?.specialityId === speciality.id && data.active !== true),
      409,
      'Select an active speciality.',
    );
    data.specialty = speciality.name;
  }
  if (['charges', 'catalog'].includes(resource)) {
    const groupId = data.chargeGroupId || old?.chargeGroupId;
    if (groupId) {
      const group = await store.get('chargeGroup', groupId);
      assert(
        group.active || (old?.chargeGroupId === group.id && data.active !== true),
        409,
        'Select an active charge group.',
      );
    }
  }
  if (resource === 'items' && data.catalogItemId) {
    const charge = await store.get('catalogItem', data.catalogItemId);
    assert(charge.active, 409, 'Select an active charge.');
    if (charge.chargeGroupId)
      assert(
        (await store.get('chargeGroup', charge.chargeGroupId)).active,
        409,
        'The charge group is inactive.',
      );
    data.name = charge.name;
  }
  if (old && data.active === false) {
    if (resource === 'specialities')
      assert(
        !(await store.count('doctor', { specialityId: old.id, active: true })),
        409,
        'Reassign active doctors before deactivating this speciality.',
      );
    if (resource === 'charge-groups')
      assert(
        !(await store.count('catalogItem', { chargeGroupId: old.id, active: true })),
        409,
        'Deactivate or reassign charges before deactivating this group.',
      );
  }
}
registerDentalRoutes(clinicApi, run, validateSlot);
registerReceptionRoutes(clinicApi, run);
// A bounded calendar range returns every matching visit, without the generic 500-row limit.
clinicApi.get('/appointment-calendar', run('appointments', async (req: any, res: any, { store, tenant }: any) => {
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const parsed = new Date(value + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date');
  const from = date.parse(req.query.from), to = date.parse(req.query.to);
  const days = (Date.parse(to) - Date.parse(from)) / 86400000;
  assert(days > 0 && days <= 62, 400, 'Choose a calendar range of up to 62 days.');
  const timezone = tenant.settings?.timezone || 'Asia/Kolkata';
  const appointments = await store.list('appointment', { startsAt: { gte: midnight(from, timezone), lt: midnight(to, timezone) } }, { orderBy: { startsAt: 'asc' } });
  const ids = (key: string) => [...new Set(appointments.map((a: any) => a[key]).filter(Boolean))];
  const [patients, doctors, branches] = await Promise.all([
    store.list('patient', { id: { in: ids('patientId') } }, { select: { id: true, name: true, phone: true } }),
    store.list('doctor', { id: { in: ids('doctorId') } }, { select: { id: true, name: true, specialty: true } }),
    store.list('branch', { id: { in: ids('branchId') } }, { select: { id: true, name: true } }),
  ]);
  const closedVisits = appointments.length ? await store.list('dentalEncounter', { appointmentId: { in: appointments.map((a: any) => a.id) }, status: { not: 'DRAFT' } }, { select: { appointmentId: true, status: true } }) : [];
  const closedIds = new Set(closedVisits.map((v: any) => v.appointmentId));
  const referredIds = new Set(closedVisits.filter((v: any) => v.status === 'REFERRED').map((v: any) => v.appointmentId));
  const patientMap = new Map(patients.map((p: any) => [p.id, p]));
  res.json({ timezone, doctors, branches, appointments: appointments.map((a: any) => ({
    ...a, clinicalRecordClosed: closedIds.has(a.id), referred: referredIds.has(a.id), date: dateKey(a.startsAt, timezone), patientName: (patientMap.get(a.patientId) as any)?.name || 'Patient',
    patientPhone: (patientMap.get(a.patientId) as any)?.phone || '',
  })) });
}));
for (const [resource, config] of Object.entries({ ...schemas, ...readOnly })) {
  // Catalog is readable by the clinical/reception team; settings permission is required for changes.
  const readCap = ['catalog', 'charges', 'charge-groups', 'specialities'].includes(resource)
    ? 'catalog'
    : ['doctors', 'branches'].includes(resource)
      ? 'dashboard'
      : config.cap;
  clinicApi.get(
    `/${resource}`,
    run(readCap, async (req: any, res: any, { store }: any) => {
      const where: Record<string, unknown> = {};
      if (
        req.query.patientId &&
        [
          'patients',
          'appointments',
          'notes',
          'charts',
          'plans',
          'prescriptions',
          'followups',
          'communications',
          'invoices',
          'documents',
        ].includes(resource) &&
        resource !== 'patients'
      )
        where.patientId = id.parse(req.query.patientId);
      if (
        req.query.active !== undefined &&
        ['catalog', 'charges', 'specialities', 'charge-groups'].includes(resource)
      )
        where.active = z.enum(['true', 'false']).parse(req.query.active) === 'true';
      if (req.query.chargeGroupId && ['catalog', 'charges'].includes(resource))
        where.chargeGroupId = id.parse(req.query.chargeGroupId);
      if (req.query.planId && resource === 'items') where.planId = id.parse(req.query.planId);
      if (req.query.itemId && resource === 'sessions') where.itemId = id.parse(req.query.itemId);
      if (
        req.query.q &&
        [
          'patients',
          'doctors',
          'catalog',
          'branches',
          'charges',
          'specialities',
          'charge-groups',
        ].includes(resource)
      ) {
        const contains = { contains: z.string().max(100).parse(req.query.q), mode: 'insensitive' };
        if (resource === 'patients') where.OR = [{ name: contains }, { phone: contains }];
        else where.name = contains;
      }
      const rows = await store.list(config.model, where, {
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      res.json(resource === 'documents' ? rows.map(({ storageKey: _key, ...r }: any) => r) : rows);
    }, false, ['specialities', 'charge-groups', 'charges', 'catalog'].includes(resource)),
  );
  clinicApi.get(
    `/${resource}/:id`,
    run(readCap, async (req: any, res: any, { store }: any) => {
      const row = await store.get(config.model, id.parse(req.params.id));
      if (resource === 'documents') delete row.storageKey;
      res.json(row);
    }),
  );
  if (!(resource in schemas)) continue;
  const c = schemas[resource];
  clinicApi.post(
    `/${resource}`,
    run(c.cap, async (req: any, res: any, { store, subscription }: any, actor: any) => {
      const data = c.schema.strict().parse(req.body);
      if (c.limit) {
        const filters = ['doctors', 'branches'].includes(c.limit) ? { active: true } : {};
        checkLimit(
          effectiveLimits(subscription)[c.limit],
          await store.totalCount(c.model, filters),
        );
      }
      for (const [field, model] of Object.entries(c.refs || {}))
        if (data[field]) await store.get(model, data[field]);
      if (['notes', 'charts', 'prescriptions'].includes(resource)) data.authorId = actor.userId;
      if (resource === 'items') assert(!(await store.list('dentalEncounter', { planId: data.planId, status: { not: 'DRAFT' } })).length, 409, 'This visit is closed. Add treatment in a new appointment.');
      await prepareMasterData(resource, data, store);
      if (resource === 'appointments') {
        await validateSlot(store, data);
        const doctor = await store.get('doctor', data.doctorId);
        const feeType = data.feeType ?? (data.useClinicFee ? 'clinic' : 'consultant');
        delete data.feeType;
        data.useClinicFee = feeType === 'clinic';
        data.consultationPaise = feeType === 'consultant' ? (doctor.consultationPaise ?? 30000) : 0;
        data.visitingConsultationPaise = feeType === 'visiting' ? (doctor.visitingConsultationPaise ?? 100000) : 0;
        data.clinicFeePaise = feeType === 'clinic' ? 30000 : 0;
      }
      const row = await store.create(c.model, data);
      await store.audit(actor.userId, `${resource}.created`, row.id);
      res.status(201).json(row);
    }),
  );
}
async function validateSlot(store: any, data: any, ignoreId?: string) {
  const doctor = await store.get('doctor', data.doctorId);
  assert(doctor.active, 409, 'Doctor is inactive.');
  if (data.branchId) {
    const branch = await store.get('branch', data.branchId);
    assert(branch.active, 409, 'Branch is inactive.');
    assert(
      doctorAvailableAt(doctor, data.branchId),
      409,
      'Doctor is assigned to a different branch.',
    );
  } else if (doctor.branchId) data.branchId = doctor.branchId;
  const candidates = await store.list('appointment', {
    doctorId: data.doctorId,
    status: { notIn: ['CANCELLED'] },
    startsAt: {
      gte: new Date(data.startsAt.getTime() - 480 * 60000),
      lt: new Date(data.startsAt.getTime() + data.durationMinutes * 60000),
    },
  });
  assert(
    !candidates.some(
      (a: any) =>
        a.id !== ignoreId &&
        a.startsAt.getTime() + a.durationMinutes * 60000 > data.startsAt.getTime(),
    ),
    409,
    'This doctor already has an appointment during that time.',
  );
}
clinicApi.patch(
  '/patients/:id',
  run('patients', async (req: any, res: any, { store }: any, actor: any) => {
    const data = schemas.patients.schema
      .partial()
      .extend({ archived: z.boolean().optional() })
      .strict()
      .parse(req.body);
    const row = await store.update('patient', id.parse(req.params.id), data);
    await store.audit(actor.userId, 'patient.updated', row.id);
    res.json(row);
  }),
);
clinicApi.patch(
  '/appointments/:id',
  run('appointments', async (req: any, res: any, { store }: any, actor: any) => {
    const data = z
      .object({
        status: z.enum(['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'ABSENT']).optional(),
        paymentStatus: z.enum(['PENDING', 'PAID', 'PARTIAL', 'NOT_REQUIRED']).optional(),
        startsAt: iso.optional(),
      })
      .strict()
      .parse(req.body);
    const old = await store.get('appointment', id.parse(req.params.id));
    const closedVisit = (await store.list('dentalEncounter', { appointmentId: old.id, status: { not: 'DRAFT' } })).length > 0;
    if (data.paymentStatus) assert(!closedVisit, 409, 'Record payments against the visit invoices in reception billing.');
    if (closedVisit) assert(!data.startsAt && (!data.status || data.status === 'COMPLETED'), 409, 'This treatment visit is closed. Schedule a new appointment to continue care.');
    if (data.startsAt) await validateSlot(store, { ...old, ...data }, old.id);
    const row = await store.update('appointment', old.id, data);
    await store.audit(actor.userId, 'appointment.updated', old.id);
    res.json(row);
  }),
);
for (const resource of [
  'doctors',
  'branches',
  'catalog',
  'specialities',
  'charge-groups',
  'charges',
])
  clinicApi.patch(
    `/${resource}/:id`,
    run(
      resource === 'doctors' ? 'doctors' : 'settings',
      async (req: any, res: any, { store, subscription }: any, actor: any) => {
        const c = schemas[resource];
        const data = c.schema
          .partial()
          .extend({ active: z.boolean().optional() })
          .strict()
          .parse(req.body);
        const old = await store.get(c.model, id.parse(req.params.id));
        if (data.active && !old.active && c.limit)
          checkLimit(
            effectiveLimits(subscription)[c.limit],
            await store.totalCount(c.model, { active: true }),
          );
        for (const [field, model] of Object.entries(c.refs || {}))
          if (data[field]) await store.get(model, data[field]);
        await prepareMasterData(resource, data, store, old);
        const row = await store.update(c.model, old.id, data);
        await store.audit(actor.userId, `${resource}.updated`, old.id);
        res.json(row);
      },
    ),
  );
clinicApi.delete(
  '/branches/:id',
  run('settings', async (req: any, res: any, { store, tx, tenant }: any, actor: any) => {
    const branch = await store.get('branch', id.parse(req.params.id));
    const linked = await Promise.all([
      store.count('doctor', { OR: [{ branchId: branch.id }, { branchIds: { has: branch.id } }] }),
      store.count('patient', { branchId: branch.id }),
      store.count('appointment', { branchId: branch.id }),
      tx.membership.count({ where: { tenantId: tenant.id, branchId: branch.id } }),
    ]);
    assert(!linked.some(Boolean), 409, 'This branch has linked doctors, patients, appointments or staff. Reassign them or deactivate the branch instead.');
    await store.remove('branch', branch.id);
    await store.audit(actor.userId, 'branches.deleted', branch.id);
    res.json({ deleted: true });
  }),
);
clinicApi.delete(
  '/appointments/:id',
  run('appointments', async (req: any, res: any, { store }: any, actor: any) => {
    const appointmentId = id.parse(req.params.id);
    assert(!(await store.list('dentalEncounter', { appointmentId, status: { not: 'DRAFT' } })).length, 409, 'A closed treatment visit cannot be cancelled.');
    const row = await store.update('appointment', appointmentId, { status: 'CANCELLED' });
    await store.audit(actor.userId, 'appointment.cancelled', row.id);
    res.json(row);
  }),
);
clinicApi.patch(
  '/plans/:id',
  run('clinical', async (req: any, res: any, { store }: any, actor: any) => {
    const data = z
      .object({ status: z.enum(['PROPOSED', 'ACCEPTED', 'COMPLETED', 'CANCELLED']) })
      .strict()
      .parse(req.body);
    const planId = id.parse(req.params.id);
    assert(!(await store.list('dentalEncounter', { planId, status: { not: 'DRAFT' } })).length, 409, 'This treatment visit is closed. Schedule a new appointment to continue care.');
    const row = await store.update('treatmentPlan', planId, data);
    await store.audit(actor.userId, 'plan.status', row.id);
    res.json(row);
  }),
);
clinicApi.patch(
  '/followups/:id',
  run('patients', async (req: any, res: any, { store }: any, actor: any) => {
    const data = z
      .object({ status: z.enum(['OPEN', 'DONE']) })
      .strict()
      .parse(req.body);
    const row = await store.update('followUp', id.parse(req.params.id), data);
    await store.audit(actor.userId, 'followup.status', row.id);
    res.json(row);
  }),
);
clinicApi.post(
  '/sessions',
  run('clinical', async (req: any, res: any, { store }: any, actor: any) => {
    const data = z
      .object({
        itemId: id,
        doctorId: id,
        notes: text,
        feePaise: money,
        performedAt: iso.optional(),
      })
      .strict()
      .parse(req.body);
    const item = await store.get('treatmentItem', data.itemId);
    const doctor = await store.get('doctor', data.doctorId);
    assert(doctor.active, 409, 'Doctor inactive.');
    const plan = await store.get('treatmentPlan', item.planId);
    assert(
      plan.status === 'ACCEPTED',
      409,
      'Accept the treatment plan before recording a session.',
    );
    const sessions = await store.list('treatmentSession', { itemId: item.id });
    assert(sessions.length < item.plannedSessions, 409, 'All planned sessions are complete.');
    assert(
      sessions.reduce((s: number, r: any) => s + r.feePaise, 0) + data.feePaise <= item.pricePaise,
      409,
      'Session fees cannot exceed the treatment price.',
    );
    const last = sessions.length + 1 === item.plannedSessions;
    assert(
      !last ||
        sessions.reduce((s: number, r: any) => s + r.feePaise, 0) + data.feePaise ===
          item.pricePaise,
      409,
      'Final session must bill the remaining treatment price.',
    );
    const row = await store.create('treatmentSession', data);
    await store.update('treatmentItem', item.id, { status: last ? 'COMPLETED' : 'IN_PROGRESS' });
    if (data.feePaise > 0)
      await store.create('invoice', {
        patientId: plan.patientId,
        sessionId: row.id,
        sourceKey: row.id,
        description: `${item.name} · Tooth ${item.tooth} · Session ${sessions.length + 1}`,
        totalPaise: data.feePaise,
      });
    await store.audit(actor.userId, 'session.created', row.id);
    res.status(201).json(row);
  }),
);
clinicApi.post(
  '/payments',
  run('billing', async (req: any, res: any, { store, tx, tenant }: any, actor: any) => {
    const data = z
      .object({
        invoiceId: id,
        amountPaise: money.refine((v) => v > 0),
        method: z.enum(['CASH', 'UPI', 'CARD', 'BANK']),
        reference: z.string().max(200).default(''),
        idempotencyKey: z.string().min(16).max(100),
      })
      .strict()
      .parse(req.body);
    const result = await recordInvoicePayment({ store, tx, tenant }, data, actor);
    res.status(result.replayed ? 200 : 201).json(result.payment);
  }),
);
clinicApi.post(
  '/commissions/:id/payout',
  run('commissions', async (req: any, res: any, { store }: any, actor: any) => {
    const { reference } = z.object({ reference: text }).strict().parse(req.body);
    const entry = await store.get('commission', id.parse(req.params.id));
    assert(entry.status === 'ACCRUED', 409, 'Commission already paid.');
    const row = await store.update('commission', entry.id, {
      status: 'PAID',
      payoutReference: reference,
    });
    await store.audit(actor.userId, 'commission.paid', row.id);
    res.json(row);
  }),
);
const staffRoles = z.enum(['MANAGER', 'BRANCH_ADMIN', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT']);
async function staffAssignment(data: any, ctx: any, actor: any, old?: any) {
  const { membership, tx, tenant, store } = ctx;
  const role = data.role ?? old?.role;
  const branchId = data.branchId === undefined ? old?.branchId : data.branchId;
  const doctorId = data.doctorId === undefined ? old?.doctorId : data.doctorId;
  if (membership.role === 'BRANCH_ADMIN') {
    assert(
      ['DOCTOR', 'RECEPTIONIST'].includes(role) &&
        (!old || ['DOCTOR', 'RECEPTIONIST'].includes(old.role)),
      403,
      'Branch admins can manage doctors and receptionists only.',
    );
    assert(
      !old || old.branchId === membership.branchId,
      403,
      'Staff member belongs to another branch.',
    );
    assert(!branchId || branchId === membership.branchId, 403, 'Choose your assigned branch.');
  } else if (old)
    assert(membership.role === 'OWNER', 403, 'Only an owner can change staff access.');
  assert(!old || old.userId !== actor.userId, 403, 'You cannot change your own access.');
  let assignedBranch = membership.role === 'BRANCH_ADMIN' ? membership.branchId : branchId || null;
  if (assignedBranch && data.active !== false)
    assert((await store.get('branch', assignedBranch)).active, 400, 'Choose an active branch.');
  if (role === 'BRANCH_ADMIN') assert(assignedBranch, 400, 'Choose a branch for the branch admin.');
  if (role === 'DOCTOR') {
    assert(doctorId, 400, 'Choose a doctor profile for this login.');
    const doctor = await store.get('doctor', doctorId);
    assert(data.active === false || doctor.active, 400, 'Choose an active doctor profile.');
    assert(
      !assignedBranch || doctorBranches(doctor).includes(assignedBranch),
      400,
      'Doctor profile must belong to the selected branch.',
    );
    assignedBranch = assignedBranch || doctor.branchId || null;
    assert(
      !(await tx.membership.findFirst({
        where: {
          tenantId: tenant.id,
          doctorId,
          active: true,
          ...(old ? { id: { not: old.id } } : {}),
        },
      })),
      409,
      'This doctor already has a staff login.',
    );
  }
  return { role, branchId: assignedBranch, doctorId: role === 'DOCTOR' ? doctorId : null };
}
clinicApi.get(
  '/staff',
  run('staff', async (_req: any, res: any, { tx, tenant, membership }: any) => {
    res.json(
      await tx.membership.findMany({
        where: {
          tenantId: tenant.id,
          ...(membership.role === 'BRANCH_ADMIN'
            ? { branchId: membership.branchId, role: { in: ['DOCTOR', 'RECEPTIONIST'] } }
            : {}),
        },
        select: {
          id: true,
          role: true,
          branchId: true,
          doctorId: true,
          active: true,
          user: { select: { id: true, name: true, email: true, verified: true } },
        },
      }),
    );
  }),
);
clinicApi.post(
  '/staff',
  run('staff', async (req: any, res: any, ctx: any, actor: any) => {
    const { tx, tenant, subscription, store } = ctx;
    const data = z
      .object({
        name: text,
        email: z
          .string()
          .email()
          .transform((s) => s.toLowerCase()),
        role: staffRoles,
        branchId: id.nullable().optional(),
        doctorId: id.nullable().optional(),
        password: z.string().min(12).max(128),
      })
      .strict()
      .parse(req.body);
    const assignment = await staffAssignment(data, ctx, actor);
    checkLimit(
      effectiveLimits(subscription).staff,
      await tx.membership.count({
        where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } },
      }),
    );
    assert(
      !(await tx.user.findUnique({ where: { email: data.email } })),
      409,
      'Account already exists. Ask support for a membership invitation.',
    );
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash: await bcrypt.hash(data.password, 12),
      },
    });
    const row = await tx.membership.create({
      data: { userId: user.id, tenantId: tenant.id, ...assignment },
    });
    await store.audit(actor.userId, 'staff.created', row.id);
    res.status(201).json(row);
  }),
);
clinicApi.patch(
  '/staff/:id',
  run('staff', async (req: any, res: any, ctx: any, actor: any) => {
    const { tx, tenant, subscription, store } = ctx;
    const data = z
      .object({
        role: staffRoles.optional(),
        branchId: id.nullable().optional(),
        doctorId: id.nullable().optional(),
        active: z.boolean().optional(),
      })
      .strict()
      .parse(req.body);
    const old = await tx.membership.findFirst({
      where: { id: id.parse(req.params.id), tenantId: tenant.id },
    });
    assert(old && old.role !== 'OWNER', 403, 'Cannot alter the owner membership.');
    const assignment = await staffAssignment(data, ctx, actor, old);
    if (data.active && !old.active)
      checkLimit(
        effectiveLimits(subscription).staff,
        await tx.membership.count({
          where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } },
        }),
      );
    const row = await tx.membership.update({
      where: { id: old.id },
      data: { ...assignment, ...(data.active !== undefined ? { active: data.active } : {}) },
    });
    await tx.session.deleteMany({ where: { userId: old.userId, tenantId: tenant.id } });
    await store.audit(actor.userId, 'staff.updated', row.id);
    res.json(row);
  }),
);
clinicApi.delete(
  '/staff/:id',
  run('staff', async (req: any, res: any, { tx, tenant, membership, store }: any, actor: any) => {
    const staff = await tx.membership.findFirst({ where: { id: id.parse(req.params.id), tenantId: tenant.id } });
    assert(staff, 404, 'Staff member not found in your clinic.');
    assert(staff.role !== 'OWNER', 403, 'Cannot delete the owner membership.');
    assert(staff.userId !== actor.userId, 403, 'You cannot delete your own access.');
    if (membership.role === 'BRANCH_ADMIN') {
      assert(staff.branchId === membership.branchId && ['DOCTOR', 'RECEPTIONIST'].includes(staff.role), 403, 'You can only delete doctors and receptionists in your assigned branch.');
    } else assert(membership.role === 'OWNER', 403, 'Only an owner can delete staff access.');
    await tx.session.deleteMany({ where: { userId: staff.userId, tenantId: tenant.id } });
    await tx.membership.delete({ where: { id: staff.id } });
    await store.audit(actor.userId, 'staff.deleted', staff.id);
    res.json({ deleted: true });
  }),
);
clinicApi.patch(
  '/settings',
  run(
    'settings',
    async (req: any, res: any, { tx, tenant, store, subscription }: any, actor: any) => {
      const input = z
        .object({
          name: text.optional(),
          phone: z.string().max(20).optional(),
          settings: z
            .object({
              address: string.optional(),
              contactEmail: z.union([z.string().email().max(200), z.literal('')]).optional(),
              website: z.union([z.string().url().max(1000), z.literal('')]).optional(),
              tagline: z.string().trim().max(200).optional(),
              logoUrl: z.union([z.string().url().max(1000), z.literal('')]).optional(),
              invoiceHeader: string.optional(),
              invoiceFooter: string.optional(),
              timezone: z
                .string()
                .refine((v) => {
                  try {
                    new Intl.DateTimeFormat('en', { timeZone: v });
                    return true;
                  } catch {
                    return false;
                  }
                }, 'Invalid time zone')
                .optional(),
              currency: z.literal('INR').optional(),
              appointmentHours: string.optional(),
              consultationPaise: money.optional(),
            })
            .strict()
            .optional(),
          onboarding: z.enum(['NEW', 'IN_PROGRESS', 'COMPLETE']).optional(),
        })
        .strict()
        .parse(req.body);
      if (input.settings?.logoUrl || input.settings?.invoiceHeader)
        assert(
          subscription.plan.features.customBranding,
          403,
          'Custom branding requires a plan with branding enabled.',
        );
      const row = await tx.tenant.update({
        where: { id: tenant.id },
        data: { ...input, settings: { ...tenant.settings, ...input.settings } },
      });
      await store.audit(actor.userId, 'settings.updated');
      res.json(row);
    },
  ),
);
clinicApi.get(
  '/usage',
  run(
    'settings',
    async (_req: any, res: any, { store, tx, tenant, subscription }: any) => {
      const [doctors, branches, patients, staff, docs] = await Promise.all([
        store.count('doctor', { active: true }),
        store.count('branch', { active: true }),
        store.count('patient'),
        tx.membership.count({
          where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } },
        }),
        store.list('document'),
      ]);
      res.json({
        limits: effectiveLimits(subscription),
        usage: {
          doctors,
          branches,
          patients,
          staff,
          storageBytes: docs.reduce((s: number, d: any) => s + d.bytes, 0),
        },
      });
    },
    true,
  ),
);
clinicApi.get('/accounts', run('reports', async (req: any, res: any, { store, tenant }: any) => {
  const dayFilter = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
  const filters = z.object({ from: dayFilter, to: dayFilter, period: z.enum(['all', 'today', 'yesterday', '7days', '1month', '3months', '6months', 'custom']).optional(), doctorId: z.string().optional(), procedure: z.string().optional() }).parse(req.query);
  assert(!filters.from || !filters.to || filters.from <= filters.to, 400, 'Start date must be before end date.');
  const [invoices, payments, commissions, sessions, doctors, patients] = await Promise.all(['invoice', 'payment', 'commission', 'treatmentSession', 'doctor', 'patient'].map(model => store.list(model)));
  res.json(accountsReport({ invoices, payments, commissions, sessions, doctors, patients }, filters, tenant.settings?.timezone || 'Asia/Kolkata'));
}));
clinicApi.get(
  '/reports',
  run('reports', async (_req: any, res: any, { store, tenant }: any) => {
    const invoices = await store.list('invoice');
    const payments = await store.list('payment');
    const commissions = await store.list('commission');
    const monthly: Record<string, number> = {};
    for (const p of payments) {
      const m = dateKey(p.createdAt, tenant.settings?.timezone || 'Asia/Kolkata').slice(0, 7);
      monthly[m] = (monthly[m] || 0) + p.amountPaise;
    }
    res.json({
      invoicedPaise: invoices.reduce((s: number, i: any) => s + i.totalPaise, 0),
      collectedPaise: payments.reduce((s: number, p: any) => s + p.amountPaise, 0),
      outstandingPaise: invoices.reduce((s: number, i: any) => s + i.totalPaise - i.paidPaise, 0),
      commissionPaise: commissions.reduce((s: number, c: any) => s + c.amountPaise, 0),
      monthly,
    });
  }),
);
clinicApi.get(
  '/export',
  run('settings', async (req: any, res: any, { store, subscription }: any, actor: any) => {
    assert(subscription.plan.features.export, 403, 'Data export is not enabled on this plan.');
    const patientId = req.query.patientId ? id.parse(req.query.patientId) : null;
    if (patientId) await store.get('patient', patientId);
    const result: Record<string, unknown> = {};
    if (!patientId)
      for (const model of ['speciality', 'chargeGroup', 'catalogItem'] as OwnedModel[])
        result[model] = await store.list(model);
    for (const model of [
      'patient',
      'appointment',
      'dentalEncounter',
      'internalReferral',
      'clinicalNote',
      'chartVersion',
      'treatmentPlan',
      'treatmentItem',
      'treatmentSession',
      'invoice',
      'payment',
      'commission',
      'document',
      'prescription',
      'followUp',
      'communication',
    ] as OwnedModel[])
      result[model] = await store.list(model);
    // Patient-only exports filter descendants by verified tenant-owned parent IDs.
    if (patientId) {
      const records = result as Record<string, any[]>;
      records.patient = records.patient.filter((r) => r.id === patientId);
      for (const key of [
        'appointment',
        'dentalEncounter',
        'internalReferral',
        'clinicalNote',
        'chartVersion',
        'treatmentPlan',
        'invoice',
        'document',
        'prescription',
        'followUp',
        'communication',
      ])
        records[key] = records[key].filter((r) => r.patientId === patientId);
      const plans = new Set(records.treatmentPlan.map((r) => r.id));
      records.treatmentItem = records.treatmentItem.filter((r) => plans.has(r.planId));
      const items = new Set(records.treatmentItem.map((r) => r.id));
      records.treatmentSession = records.treatmentSession.filter((r) => items.has(r.itemId));
      const invoices = new Set(records.invoice.map((r) => r.id));
      records.payment = records.payment.filter((r) => invoices.has(r.invoiceId));
      const payments = new Set(records.payment.map((r) => r.id));
      records.commission = records.commission.filter((r) => payments.has(r.paymentId));
    }
    result.document = (result.document as any[]).map(({ storageKey: _key, ...r }) => r);
    await store.audit(actor.userId, 'data.exported', patientId || undefined);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="clinic-${store.tenantId}-${Date.now()}.json"`,
    );
    res.json({
      schemaVersion: 1,
      tenantId: store.tenantId,
      exportedAt: new Date(),
      records: result,
    });
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
});
clinicApi.post(
  '/documents',
  upload.single('file'),
  run('documents', async (req: any, res: any, { store, subscription }: any, actor: any) => {
    const patientId = id.parse(req.body.patientId);
    await store.get('patient', patientId);
    assert(req.file, 400, 'Choose a file.');
    const f = req.file;
    const b: Buffer = f.buffer;
    let mime = '';
    if (b.subarray(0, 5).toString() === '%PDF-') mime = 'application/pdf';
    else if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) mime = 'image/jpeg';
    else if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      mime = 'image/png';
    assert(mime, 400, 'Only PDF, JPEG and PNG documents are supported.');
    const bytes = await store.documentBytes();
    const limit = effectiveLimits(subscription).storageBytes;
    assert(limit == null || bytes + f.size <= limit, 409, 'Document storage limit reached.');
    const storageKey = `${store.tenantId}/${opaque()}`;
    await saveDocument(storageKey, b, mime);
    try {
      const row = await store.create('document', {
        patientId,
        name: path
          .basename(f.originalname)
          .replace(/[^\w. -]/g, '_')
          .slice(0, 150),
        storageKey,
        mime,
        bytes: f.size,
      });
      await store.audit(actor.userId, 'document.uploaded', row.id);
      delete row.storageKey;
      res.status(201).json(row);
    } catch (e) {
      await deleteDocument(storageKey);
      throw e;
    }
  }),
);
clinicApi.get(
  '/documents/:id/download',
  run('documents', async (req: any, res: any, { store }: any, actor: any) => {
    const doc = await store.get('document', id.parse(req.params.id));
    assert(
      doc.storageKey.startsWith(`${store.tenantId}/`) && !doc.storageKey.includes('..'),
      500,
      'Invalid document path.',
    );
    const contents = await loadDocument(doc.storageKey);
    await store.audit(actor.userId, 'document.downloaded', doc.id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.name.replace(/["\r\n]/g, '_')}"`,
    );
    res.send(contents);
  }),
);
