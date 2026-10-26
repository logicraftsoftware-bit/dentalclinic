import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual, createHmac } from 'node:crypto';
import type { Request } from 'express';
import pino from 'pino';
import { z } from 'zod';
import { doctorAvailableAt, doctorBranches } from './doctor-branches.js';

const globalDb = globalThis as unknown as { dentaflowDb?: PrismaClient };
function databaseOptions() {
  const value = process.env.DATABASE_URL;
  if (!value || !/^mongodb(?:\+srv)?:\/\//.test(value))
    throw new Error('Set DATABASE_URL to a MongoDB replica-set connection string.');
  const uri = new URL(value);
  if (!uri.searchParams.has('maxPoolSize')) uri.searchParams.set('maxPoolSize', '10');
  if (!uri.searchParams.has('serverSelectionTimeoutMS'))
    uri.searchParams.set('serverSelectionTimeoutMS', '8000');
  return { datasources: { db: { url: uri.toString() } } };
}
export const db = globalDb.dentaflowDb ?? new PrismaClient(databaseOptions());
globalDb.dentaflowDb = db;
export async function lock(tx: Prisma.TransactionClient, key: string) {
  await tx.transactionLock.upsert({
    where: { id: key },
    create: { id: key, revision: 1 },
    update: { revision: { increment: 1 } },
  });
}
export async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  options: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, { maxWait: 15000, timeout: 20000, ...options });
    } catch (error: any) {
      const conflict =
        error.code === 'P2034' ||
        (error.code === 'P2002' && String(error.meta?.modelName) === 'TransactionLock');
      if (!conflict || attempt >= 5) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 30));
    }
  }
}
export const log = pino({ redact: ['password', 'token', 'cookie', 'authorization'] });
export const prod = process.env.NODE_ENV === 'production';
export const opaque = () => randomBytes(32).toString('hex');
export const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(condition: unknown, status: number, message: string): asserts condition {
  if (!condition) throw new ApiError(status, message);
}
export const money = z.number().int().min(0).max(1000000000);
export const id = z.string().uuid();
export const text = z.string().trim().min(1).max(200);
export const iso = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s));
export type Actor = {
  userId: string;
  tenantId: string | null;
  platformAdmin: boolean;
  name: string;
  email: string;
};
export async function authenticate(req: Request): Promise<Actor> {
  const token = req.cookies?.df_session;
  assert(typeof token === 'string', 401, 'Please sign in.');
  const session = await db.session.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: true },
  });
  assert(session && session.expiresAt > new Date(), 401, 'Session expired. Please sign in.');
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    platformAdmin: session.user.platformAdmin,
    name: session.user.name,
    email: session.user.email,
  };
}
export function permission(role: string, capability: string) {
  if (role === 'OWNER' || role === 'MANAGER') return true;
  const grants: Record<string, string[]> = {
    BRANCH_ADMIN: [
      'dashboard',
      'patients',
      'appointments',
      'billing',
      'clinical',
      'documents',
      'catalog',
      'reports',
      'commissions',
      'staff',
      'doctors',
    ],
    DOCTOR: ['dashboard', 'patients', 'appointments', 'clinical', 'documents', 'catalog'],
    RECEPTIONIST: ['dashboard', 'patients', 'appointments', 'billing', 'catalog'],
    ACCOUNTANT: ['dashboard', 'billing', 'reports', 'commissions'],
  };
  return grants[role]?.includes(capability) ?? false;
}
export function operational(
  tenant: { status: string },
  sub: {
    status: string;
    endsAt: Date;
    cancelAtPeriodEnd: boolean;
    plan: { graceDays: number };
  } | null,
  now = new Date(),
) {
  if (tenant.status !== 'ACTIVE' || !sub || ['CANCELLED', 'EXPIRED'].includes(sub.status))
    return false;
  const grace = sub.status === 'TRIAL' || sub.cancelAtPeriodEnd ? 0 : sub.plan.graceDays;
  return sub.endsAt.getTime() + grace * 86400000 > now.getTime();
}
export function effectiveLimits(sub: {
  plan: { limits: Prisma.JsonValue };
  overrides: Prisma.JsonValue;
}) {
  return {
    ...(sub.plan.limits as Record<string, number | null>),
    ...(sub.overrides as Record<string, number | null>),
  };
}
export function checkLimit(limit: number | null | undefined, count: number) {
  assert(
    limit == null || count < limit,
    409,
    'Your plan limit has been reached. Upgrade your subscription or contact support.',
  );
}
export const ownedModels = [
  'branch',
  'doctor',
  'patient',
  'appointment',
  'dentalEncounter',
  'internalReferral',
  'clinicalNote',
  'chartVersion',
  'catalogItem',
  'speciality',
  'chargeGroup',
  'treatmentPlan',
  'treatmentItem',
  'treatmentSession',
  'invoice',
  'payment',
  'patientAdjustment',
  'commission',
  'document',
  'prescription',
  'followUp',
  'communication',
  'clinicAudit',
  'jobRecord',
  'idempotencyRecord',
] as const;
export type OwnedModel = (typeof ownedModels)[number];
// This is the only repository available to clinic routes. No route receives raw Prisma.
export class TenantStore {
  constructor(
    private tx: Prisma.TransactionClient,
    readonly tenantId: string,
    readonly scope: {
      branchId?: string | null;
      doctorId?: string | null;
      role?: string;
      userId?: string;
    } = {},
  ) {}
  private readonly restrictions = new Map<OwnedModel, Promise<Record<string, unknown>>>();
  private async restriction(name: OwnedModel) {
    const { branchId, doctorId } = this.scope;
    let restriction: any = {};
    if (branchId || doctorId) {
      const ids = async (model: OwnedModel, condition: any) =>
        (
          await this.model(model).findMany({
            where: { tenantId: this.tenantId, ...condition },
            select: { id: true },
          })
        ).map((r: any) => r.id);
      // Only explicit referral handoffs can share a patient across branches.
      const sharedIds = branchId ? (doctorId
        ? await this.model('appointment').findMany({ where: { tenantId: this.tenantId, branchId, doctorId, referralId: { not: null } }, select: { patientId: true } })
        : await this.model('internalReferral').findMany({ where: { tenantId: this.tenantId, targetBranchId: branchId }, select: { patientId: true } })) : [];
      const patientWhere: any = branchId ? { OR: [{ branchId }, { id: { in: sharedIds.map((r: any) => r.patientId) } }] } : {};
      if (doctorId) {
        const appointments = await this.model('appointment').findMany({
          where: { tenantId: this.tenantId, doctorId },
          select: { patientId: true },
        });
        patientWhere.AND = [{ OR: [{ doctorId }, { id: { in: appointments.map((a: any) => a.patientId) } }] }];
      }
      if (name === 'branch') restriction = branchId ? { id: branchId } : {};
      else if (name === 'doctor') restriction = doctorId ? { id: doctorId } : { OR: [{ branchId }, { branchIds: { has: branchId } }] };
      else if (name === 'patient') restriction = patientWhere;
      else if (name === 'internalReferral') restriction = {
        ...(doctorId ? { OR: [{ fromDoctorId: doctorId }, { toDoctorId: doctorId }] } : {}),
        ...(branchId ? { AND: [{ OR: [{ sourceBranchId: branchId }, { targetBranchId: branchId }] }] } : {}),
      };
      else if (name === 'appointment')
        restriction = {
          ...(branchId ? { branchId } : {}),
          ...(doctorId ? { doctorId } : {}),
          patientId: { in: await ids('patient', patientWhere) },
        };
      else if (
        [
          'dentalEncounter',
          'clinicalNote',
          'chartVersion',
          'treatmentPlan',
          'invoice',
          'document',
          'prescription',
          'followUp',
          'communication',
          'treatmentItem',
          'treatmentSession',
          'payment',
          'patientAdjustment',
          'commission',
        ].includes(name)
      ) {
        const patients = await ids('patient', patientWhere);
        restriction = { patientId: { in: patients } };
        if (['treatmentItem', 'treatmentSession'].includes(name)) {
          const plans = await ids('treatmentPlan', { patientId: { in: patients } });
          restriction =
            name === 'treatmentItem'
              ? { planId: { in: plans } }
              : { itemId: { in: await ids('treatmentItem', { planId: { in: plans } }) } };
        }
        if (['payment', 'commission'].includes(name)) {
          const invoices = await ids('invoice', { patientId: { in: patients } });
          restriction =
            name === 'payment'
              ? { invoiceId: { in: invoices } }
              : { paymentId: { in: await ids('payment', { invoiceId: { in: invoices } }) } };
        }
      }
    }
    return restriction;
  }
  private async filter(name: OwnedModel, where: Record<string, unknown>) {
    if (!this.restrictions.has(name)) this.restrictions.set(name, this.restriction(name));
    return { tenantId: this.tenantId, AND: [{ ...where, tenantId: this.tenantId }, await this.restrictions.get(name)] };
  }
  private scopedData(name: OwnedModel, data: Record<string, unknown>, creating = false) {
    const result = { ...data };
    if (name === 'doctor' && this.scope.branchId && data.branchIds !== undefined) {
      assert(Array.isArray(data.branchIds) && data.branchIds.length === 1 && data.branchIds[0] === this.scope.branchId, 403, 'You can only assign doctors to your own branch.');
    }
    if (this.scope.branchId && ['patient', 'doctor', 'appointment'].includes(name)) {
      assert(
        !data.branchId || data.branchId === this.scope.branchId,
        403,
        'Choose a record in your assigned branch.',
      );
      result.branchId = this.scope.branchId;
    }
    if (this.scope.doctorId && ['patient', 'appointment', 'treatmentSession'].includes(name)) {
      assert(
        !data.doctorId || data.doctorId === this.scope.doctorId,
        403,
        'Choose your assigned doctor profile.',
      );
      if (creating || name !== 'patient' || data.doctorId !== undefined)
        result.doctorId = this.scope.doctorId;
    }
    return result;
  }
  private model(name: OwnedModel): any {
    assert(ownedModels.includes(name), 500, 'Unknown repository');
    return (this.tx as any)[name];
  }
  async list(
    name: OwnedModel,
    where: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ) {
    return this.model(name).findMany({ ...options, where: await this.filter(name, where) });
  }
  async documentBytes() {
    const result = await this.tx.document.aggregate({
      where: { tenantId: this.tenantId },
      _sum: { bytes: true },
    });
    return result._sum.bytes || 0;
  }
  totalCount(name: OwnedModel, where: Record<string, unknown> = {}) {
    return this.model(name).count({ where: { ...where, tenantId: this.tenantId } });
  }
  async count(name: OwnedModel, where: Record<string, unknown> = {}) {
    return this.model(name).count({ where: await this.filter(name, where) });
  }
  async get(name: OwnedModel, recordId: string) {
    const row = await this.model(name).findFirst({
      where: await this.filter(name, { id: recordId }),
    });
    assert(row, 404, 'Record not found in your clinic.');
    return row;
  }
  private async validateReferences(name: OwnedModel, data: Record<string, unknown>) {
    const references: Partial<Record<OwnedModel, Record<string, OwnedModel>>> = {
      patient: { branchId: 'branch', doctorId: 'doctor' },
      doctor: { branchId: 'branch', specialityId: 'speciality' },
      appointment: { patientId: 'patient', doctorId: 'doctor', branchId: 'branch' },
      clinicalNote: { patientId: 'patient' },
      chartVersion: { patientId: 'patient' },
      treatmentPlan: { patientId: 'patient' },
      treatmentItem: { planId: 'treatmentPlan', catalogItemId: 'catalogItem' },
      treatmentSession: { itemId: 'treatmentItem', doctorId: 'doctor' },
      catalogItem: { chargeGroupId: 'chargeGroup' },
      invoice: { patientId: 'patient', sessionId: 'treatmentSession' },
      payment: { invoiceId: 'invoice' },
      patientAdjustment: { patientId: 'patient', invoiceId: 'invoice' },
      commission: { doctorId: 'doctor', paymentId: 'payment' },
      document: { patientId: 'patient' },
      prescription: { patientId: 'patient' },
      followUp: { patientId: 'patient' },
      communication: { patientId: 'patient' },
    };
    for (const [field, model] of Object.entries(references[name] || {})) {
      const value = data[field];
      if (value != null) {
        assert(typeof value === 'string', 400, 'Invalid related record.');
        await this.get(model, value);
      }
    }
    if (name === 'doctor' && data.branchIds !== undefined) {
      assert(Array.isArray(data.branchIds), 400, 'Choose valid branches.');
      for (const branchId of data.branchIds) {
        assert(typeof branchId === 'string', 400, 'Choose valid branches.');
        await this.get('branch', branchId);
      }
    }
    if (name === 'patient' && data.doctorId) {
      const doctor = await this.get('doctor', data.doctorId as string);
      assert(
        !data.branchId || doctorAvailableAt(doctor, data.branchId as string),
        400,
        'Assigned doctor must belong to the patient branch.',
      );
      if (!data.branchId && doctor.branchId) data.branchId = doctor.branchId;
    }
    if (name === 'appointment' && data.patientId) {
      const patient = await this.get('patient', data.patientId as string);
      assert(
        !patient.branchId || patient.branchId === data.branchId || !!(data.referralId && (await this.model('internalReferral').findFirst({ where: { id: data.referralId, tenantId: this.tenantId, patientId: data.patientId, toDoctorId: data.doctorId, targetBranchId: data.branchId || null, status: data.id ? 'SCHEDULED' : 'PENDING', ...(data.id ? { scheduledAppointmentId: data.id } : {}) } }))),
        400,
        'Appointment must belong to the patient branch.',
      );
    }
    for (const [field, value] of Object.entries(data)) {
      const jsonField =
        (name === 'chartVersion' && field === 'teeth') ||
        (name === 'doctor' && field === 'branchIds') ||
        (name === 'idempotencyRecord' && ['body', 'headers'].includes(field));
      assert(
        value === null || typeof value !== 'object' || value instanceof Date || jsonField,
        400,
        'Nested writes are not supported.',
      );
    }
  }
  async create(name: OwnedModel, data: Record<string, unknown>) {
    data = this.scopedData(name, data, true);
    await this.validateReferences(name, data);
    const row = await this.model(name).create({ data: { ...data, tenantId: this.tenantId } });
    this.restrictions.clear();
    return row;
  }
  async update(name: OwnedModel, recordId: string, data: Record<string, unknown>) {
    const existing = await this.get(name, recordId);
    const { id: _id, tenantId: _tenant, ...safe } = data;
    if (name === 'patient' && safe.doctorId && safe.branchId === undefined && !existing.branchId) {
      safe.branchId = (await this.get('doctor', safe.doctorId as string)).branchId || null;
    }
    Object.assign(safe, this.scopedData(name, safe));
    await this.validateReferences(name, { ...existing, ...safe });
    this.restrictions.clear();
    return this.model(name).update({
      where: { tenantId_id: { tenantId: this.tenantId, id: recordId } },
      data: safe,
    });
  }
  async remove(name: OwnedModel, recordId: string) {
    await this.get(name, recordId);
    this.restrictions.clear();
    return this.model(name).delete({
      where: { tenantId_id: { tenantId: this.tenantId, id: recordId } },
    });
  }
  audit(actorId: string, action: string, recordId?: string) {
    return this.create('clinicAudit', { actorId, action, recordId });
  }
}
export async function clinic<T>(
  actor: Actor,
  capability: string,
  fn: (ctx: {
    store: TenantStore;
    tenant: any;
    subscription: any;
    membership: any;
    tx: Prisma.TransactionClient;
  }) => Promise<T>,
  options: { accessOnly?: boolean; hostname?: string; readOnly?: boolean; transactionTimeoutMs?: number } = {},
) {
  assert(actor.tenantId, 403, 'Choose an authorized clinic workspace.');
  const tenantId = actor.tenantId;
  return transaction(
    async (tx) => {
      // Serialize tenant writes/counts and recheck status after acquiring the lock.
      if (!options.readOnly) await lock(tx, tenantId);

      const membership = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: actor.userId, tenantId } },
      });
      assert(membership?.active, 403, 'No active membership in this clinic.');
      assert(
        permission(membership.role, capability),
        403,
        'Your role does not permit this operation.',
      );
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (options.hostname) {
        const host = options.hostname.toLowerCase();
        const base = process.env.BASE_DOMAIN || 'localhost';
        if (host !== base && !['localhost', '127.0.0.1'].includes(host)) {
          const domain = await tx.tenantDomain.findUnique({ where: { hostname: host } });
          assert(
            host === `${tenant.slug}.${base}` || (domain?.verified && domain.tenantId === tenantId),
            403,
            'This hostname does not match your clinic membership.',
          );
        }
      }
      const subscription = await tx.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      });
      if (!options.accessOnly)
        assert(
          operational(tenant, subscription),
          402,
          'Clinic access is paused. The owner can still manage subscription and support.',
        );
      if (membership.branchId) {
        assert(
          await tx.branch.findFirst({ where: { id: membership.branchId, tenantId, active: true } }),
          403,
          'Your assigned branch is inactive. Contact the clinic owner.',
        );
      }
      if (membership.role === 'BRANCH_ADMIN')
        assert(membership.branchId, 403, 'The owner must assign a branch.');
      if (membership.role === 'DOCTOR') {
        const profile = membership.doctorId
          ? await tx.doctor.findFirst({
              where: { id: membership.doctorId, tenantId, active: true },
            })
          : null;
        assert(
          profile && (membership.branchId ? doctorBranches(profile).includes(membership.branchId) : (membership.allDoctorBranches || !doctorBranches(profile).length)),
          403,
          'The owner must assign an active doctor profile in the correct branch.',
        );
      }
      return fn({
        store: new TenantStore(tx, tenantId, {
          branchId: membership.branchId,
          doctorId: membership.role === 'DOCTOR' ? membership.doctorId : null,
          userId: actor.userId,
          role: membership.role,
        }),
        tenant,
        subscription,
        membership,
        tx,
      });
    },
    { maxWait: 15000, timeout: options.transactionTimeoutMs ?? 20000 },
  );
}
export function verifyWebhook(raw: Buffer, signature: string, secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function periodEnd(start: Date, interval: string) {
  const end = new Date(start);
  const day = end.getUTCDate();
  end.setUTCDate(1);
  if (interval === 'ANNUAL') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(day, last));
  return end;
}
