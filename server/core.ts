import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomBytes, createHash, timingSafeEqual, createHmac } from 'node:crypto';
import type { Request } from 'express';
import pino from 'pino';
import { z } from 'zod';

export const db = new PrismaClient();
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
  assert(session.user.verified, 403, 'Verify your email before signing in.');
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
  'clinicalNote',
  'chartVersion',
  'catalogItem',
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
  ) {}
  private model(name: OwnedModel): any {
    assert(ownedModels.includes(name), 500, 'Unknown repository');
    return (this.tx as any)[name];
  }
  list(
    name: OwnedModel,
    where: Record<string, unknown> = {},
    options: Record<string, unknown> = {},
  ) {
    return this.model(name).findMany({ ...options, where: { ...where, tenantId: this.tenantId } });
  }
  count(name: OwnedModel, where: Record<string, unknown> = {}) {
    return this.model(name).count({ where: { ...where, tenantId: this.tenantId } });
  }
  async get(name: OwnedModel, recordId: string) {
    const row = await this.model(name).findFirst({
      where: { id: recordId, tenantId: this.tenantId },
    });
    assert(row, 404, 'Record not found in your clinic.');
    return row;
  }
  create(name: OwnedModel, data: Record<string, unknown>) {
    return this.model(name).create({ data: { ...data, tenantId: this.tenantId } });
  }
  async update(name: OwnedModel, recordId: string, data: Record<string, unknown>) {
    await this.get(name, recordId);
    const { id: _id, tenantId: _tenant, ...safe } = data;
    return this.model(name).update({
      where: { tenantId_id: { tenantId: this.tenantId, id: recordId } },
      data: safe,
    });
  }
  async remove(name: OwnedModel, recordId: string) {
    await this.get(name, recordId);
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
  options: { accessOnly?: boolean; hostname?: string } = {},
) {
  assert(actor.tenantId, 403, 'Choose an authorized clinic workspace.');
  const tenantId = actor.tenantId;
  return db.$transaction(
    async (tx) => {
      // Serialize tenant writes/counts and recheck status after acquiring the lock.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
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
      return fn({ store: new TenantStore(tx, tenantId), tenant, subscription, membership, tx });
    },
    { maxWait: 15000, timeout: 20000 },
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
