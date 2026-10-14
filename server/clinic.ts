import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'node:path';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import {
  authenticate,
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
import { sendToken } from './mail.js';
import { transactionalReply } from './reply.js';
import { zonedDayRange, dateKey } from './time.js';

export const clinicApi = Router();
const run =
  (capability: string, fn: any, accessOnly = false) =>
  (req: any, res: any, next: any) =>
    authenticate(req)
      .then((actor) =>
        clinic(
          actor,
          capability,
          (ctx) => transactionalReply(req, ctx.store, (reply) => fn(req, reply, ctx, actor)),
          { accessOnly, hostname: req.hostname },
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
    cap: 'settings',
    limit: 'doctors',
    schema: z.object({
      name: text,
      email: z.union([z.string().email(), z.literal('')]).default(''),
      phone: string,
      specialty: z.string().max(200).default('General Dentistry'),
      registrationNumber: string,
      commissionPercent: z.number().int().min(0).max(100).default(0),
      consultationPaise: money.default(50000),
      branchId: id.optional(),
    }),
    refs: { branchId: 'branch' },
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
  catalog: {
    model: 'catalogItem',
    cap: 'settings',
    schema: z.object({
      name: text,
      pricePaise: money,
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
      tooth: z.string().regex(/^(?:[1-4][1-8]|[5-8][1-5])$/),
      name: text,
      pricePaise: money,
      plannedSessions: z.number().int().min(1).max(30).default(1),
    }),
    refs: { planId: 'treatmentPlan' },
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
        ['OWNER', 'MANAGER', 'DOCTOR', 'RECEPTIONIST'].includes(membership.role)
          ? store.list('followUp', { status: 'OPEN' }, { orderBy: { dueAt: 'asc' }, take: 5 })
          : Promise.resolve([]),
      ]);
      const appts = await Promise.all(
        appointments.map(async (a: any) => ({
          ...a,
          patientName: (await store.get('patient', a.patientId)).name,
          doctorName: (await store.get('doctor', a.doctorId)).name,
        })),
      );
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
  return ['OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST'].includes(role);
}
clinicApi.get(
  '/workspace',
  run(
    'dashboard',
    async (_req: any, res: any, { tenant, subscription, membership }: any) =>
      res.json({ tenant, subscription, role: membership.role }),
    true,
  ),
);
for (const [resource, config] of Object.entries({ ...schemas, ...readOnly })) {
  // Catalog is readable by the clinical/reception team; settings permission is required for changes.
  const readCap =
    resource === 'catalog'
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
      if (req.query.planId && resource === 'items') where.planId = id.parse(req.query.planId);
      if (req.query.itemId && resource === 'sessions') where.itemId = id.parse(req.query.itemId);
      if (req.query.q && ['patients', 'doctors', 'catalog', 'branches'].includes(resource))
        where.name = { contains: z.string().max(100).parse(req.query.q), mode: 'insensitive' };
      const rows = await store.list(config.model, where, {
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      res.json(resource === 'documents' ? rows.map(({ storageKey: _key, ...r }: any) => r) : rows);
    }),
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
        checkLimit(effectiveLimits(subscription)[c.limit], await store.count(c.model, filters));
      }
      for (const [field, model] of Object.entries(c.refs || {}))
        if (data[field]) await store.get(model, data[field]);
      if (['notes', 'charts', 'prescriptions'].includes(resource)) data.authorId = actor.userId;
      if (resource === 'appointments') await validateSlot(store, data);
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
      !doctor.branchId || doctor.branchId === data.branchId,
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
        status: z.enum(['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED']).optional(),
        startsAt: iso.optional(),
      })
      .strict()
      .parse(req.body);
    const old = await store.get('appointment', id.parse(req.params.id));
    if (data.startsAt) await validateSlot(store, { ...old, ...data }, old.id);
    const row = await store.update('appointment', old.id, data);
    await store.audit(actor.userId, 'appointment.updated', old.id);
    res.json(row);
  }),
);
for (const resource of ['doctors', 'branches', 'catalog'])
  clinicApi.patch(
    `/${resource}/:id`,
    run('settings', async (req: any, res: any, { store, subscription }: any, actor: any) => {
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
          await store.count(c.model, { active: true }),
        );
      for (const [field, model] of Object.entries(c.refs || {}))
        if (data[field]) await store.get(model, data[field]);
      const row = await store.update(c.model, old.id, data);
      await store.audit(actor.userId, `${resource}.updated`, old.id);
      res.json(row);
    }),
  );
clinicApi.delete(
  '/appointments/:id',
  run('appointments', async (req: any, res: any, { store }: any, actor: any) => {
    const row = await store.update('appointment', id.parse(req.params.id), { status: 'CANCELLED' });
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
    const row = await store.update('treatmentPlan', id.parse(req.params.id), data);
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
        description: `${item.name} · Tooth ${item.tooth} · Session ${sessions.length + 1}`,
        totalPaise: data.feePaise,
      });
    await store.audit(actor.userId, 'session.created', row.id);
    res.status(201).json(row);
  }),
);
clinicApi.post(
  '/payments',
  run('billing', async (req: any, res: any, { store }: any, actor: any) => {
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
    const previous = await store.list('payment', { idempotencyKey: data.idempotencyKey });
    if (previous.length) {
      assert(
        previous[0].invoiceId === data.invoiceId &&
          previous[0].amountPaise === data.amountPaise &&
          previous[0].method === data.method &&
          previous[0].reference === data.reference,
        409,
        'Idempotency key reused with different payment data.',
      );
      res.json(previous[0]);
      return;
    }
    const invoice = await store.get('invoice', data.invoiceId);
    assert(
      data.amountPaise <= invoice.totalPaise - invoice.paidPaise,
      409,
      'Payment exceeds the invoice balance.',
    );
    const row = await store.create('payment', data);
    const paid = invoice.paidPaise + data.amountPaise;
    await store.update('invoice', invoice.id, {
      paidPaise: paid,
      status: paid === invoice.totalPaise ? 'PAID' : 'PARTIAL',
    });
    if (invoice.sessionId) {
      const s = await store.get('treatmentSession', invoice.sessionId);
      const doctor = await store.get('doctor', s.doctorId);
      if (doctor.commissionPercent)
        await store.create('commission', {
          doctorId: doctor.id,
          paymentId: row.id,
          percent: doctor.commissionPercent,
          amountPaise: Math.round((data.amountPaise * doctor.commissionPercent) / 100),
        });
    }
    await store.audit(actor.userId, 'payment.received', row.id);
    res.status(201).json(row);
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
clinicApi.get(
  '/staff',
  run('settings', async (_req: any, res: any, { tx, tenant }: any) => {
    res.json(
      await tx.membership.findMany({
        where: { tenantId: tenant.id },
        select: {
          id: true,
          role: true,
          active: true,
          user: { select: { id: true, name: true, email: true, verified: true } },
        },
      }),
    );
  }),
);
clinicApi.post(
  '/staff',
  run(
    'settings',
    async (req: any, res: any, { tx, tenant, subscription, store }: any, actor: any) => {
      const data = z
        .object({
          name: text,
          email: z
            .string()
            .email()
            .transform((s) => s.toLowerCase()),
          role: z.enum(['MANAGER', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT']),
          password: z.string().min(12).max(128),
        })
        .strict()
        .parse(req.body);
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
        data: { userId: user.id, tenantId: tenant.id, role: data.role },
      });
      const token = opaque();
      await tx.authToken.create({
        data: {
          tokenHash: hash(token),
          userId: user.id,
          purpose: 'VERIFY',
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      const sent = await sendToken(data.email, token, 'VERIFY');
      await store.audit(actor.userId, 'staff.created', row.id);
      res.status(201).json({ ...row, ...sent });
    },
  ),
);
clinicApi.patch(
  '/staff/:id',
  run(
    'settings',
    async (
      req: any,
      res: any,
      { tx, tenant, subscription, store, membership }: any,
      actor: any,
    ) => {
      assert(membership.role === 'OWNER', 403, 'Only an owner can change staff access.');
      const data = z
        .object({
          role: z.enum(['MANAGER', 'DOCTOR', 'RECEPTIONIST', 'ACCOUNTANT']).optional(),
          active: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const old = await tx.membership.findFirst({
        where: { id: id.parse(req.params.id), tenantId: tenant.id },
      });
      assert(old && old.role !== 'OWNER', 403, 'Cannot alter the owner membership.');
      if (data.active && !old.active)
        checkLimit(
          effectiveLimits(subscription).staff,
          await tx.membership.count({
            where: { tenantId: tenant.id, active: true, role: { not: 'OWNER' } },
          }),
        );
      const row = await tx.membership.update({ where: { id: old.id }, data });
      await tx.session.deleteMany({ where: { userId: old.userId, tenantId: tenant.id } });
      await store.audit(actor.userId, 'staff.updated', row.id);
      res.json(row);
    },
  ),
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
    for (const model of [
      'patient',
      'appointment',
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
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
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
    const docs = await store.list('document');
    const limit = effectiveLimits(subscription).storageBytes;
    assert(
      limit == null || docs.reduce((s: number, d: any) => s + d.bytes, 0) + f.size <= limit,
      409,
      'Document storage limit reached.',
    );
    const root = path.resolve(process.env.STORAGE_PATH || 'storage');
    const dir = path.join(root, store.tenantId);
    await mkdir(dir, { recursive: true });
    const storageKey = `${store.tenantId}/${opaque()}`;
    await writeFile(path.join(root, storageKey), b, { flag: 'wx' });
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
      await unlink(path.join(root, storageKey));
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
    const contents = await readFile(
      path.resolve(process.env.STORAGE_PATH || 'storage', doc.storageKey),
    );
    await store.audit(actor.userId, 'document.downloaded', doc.id);
    res.setHeader('Content-Type', doc.mime);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${doc.name.replace(/["\r\n]/g, '_')}"`,
    );
    res.send(contents);
  }),
);
