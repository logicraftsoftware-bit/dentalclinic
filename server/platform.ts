import { Router } from 'express';
import { z } from 'zod';
import {
  authenticate,
  db,
  transaction,
  lock,
  assert,
  id,
  text,
  money,
  clinic,
  periodEnd,
  verifyWebhook,
  hash,
  opaque,
  TenantStore,
  type Actor,
} from './core.js';
import { sendToken } from './mail.js';
import { transactionalReply, Reply } from './reply.js';

export const platformApi = Router();
export const billingApi = Router();
const admin = (fn: any) => (req: any, res: any, next: any) =>
  authenticate(req)
    .then(async (actor) => {
      assert(actor.platformAdmin, 403, 'Platform administrator access required.');
      const reply = new Reply();
      await fn(req, reply, actor);
      reply.flush(res);
    })
    .catch(next);
const owner = (fn: any) => (req: any, res: any, next: any) =>
  authenticate(req)
    .then((actor) =>
      clinic(
        actor,
        'settings',
        (ctx) => {
          assert(
            ctx.membership.role === 'OWNER',
            403,
            'Only the clinic owner can manage subscriptions.',
          );
          return transactionalReply(req, ctx.store, (reply) => fn(req, reply, ctx, actor));
        },
        { accessOnly: true, hostname: req.hostname },
      ),
    )
    .then((reply) => reply.flush(res))
    .catch(next);
async function audit(tx: any, actor: Actor, action: string, tenantId?: string, details: any = {}) {
  await tx.platformAudit.create({ data: { actorId: actor.userId, tenantId, action, details } });
}
const planSchema = z
  .object({
    name: text,
    monthlyPaise: money,
    annualPaise: money,
    trialDays: z.number().int().min(0).max(90),
    graceDays: z.number().int().min(0).max(30),
    available: z.boolean(),
    limits: z
      .object({
        doctors: z.number().int().min(1).nullable(),
        staff: z.number().int().min(0).nullable(),
        branches: z.number().int().min(1).nullable(),
        patients: z.number().int().min(0).nullable(),
        storageBytes: z.number().int().min(0).nullable(),
      })
      .strict(),
    features: z
      .object({
        export: z.boolean(),
        customBranding: z.boolean(),
        advancedReports: z.boolean(),
        advancedCommissions: z.boolean(),
        prioritySupport: z.boolean(),
      })
      .strict(),
  })
  .strict();
platformApi.get(
  '/dashboard',
  admin(async (_req: any, res: any) => {
    const [tenants, subscriptions, payments, events, plans, support] = await Promise.all([
      db.tenant.findMany(),
      db.subscription.findMany({ include: { plan: true } }),
      db.subscriptionPayment.findMany(),
      db.subscriptionEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      db.plan.findMany(),
      db.supportRequest.count({ where: { status: 'OPEN' } }),
    ]);
    const now = new Date();
    const active = subscriptions.filter((s) => s.status === 'ACTIVE' && s.endsAt > now);
    const mrr = active.reduce(
      (sum, s) =>
        sum + (s.interval === 'ANNUAL' ? Math.round(s.recurringPaise / 12) : s.recurringPaise),
      0,
    );
    const started = subscriptions.length;
    const cancelled = subscriptions.filter(
      (s) => s.cancelAtPeriodEnd || s.status === 'CANCELLED',
    ).length;
    res.json({
      totalClinics: tenants.length,
      active: active.length,
      trial: subscriptions.filter((s) => s.status === 'TRIAL' && s.endsAt > now).length,
      expired: subscriptions.filter((s) => s.endsAt <= now).length,
      suspended: tenants.filter((t) => t.status === 'SUSPENDED').length,
      mrrPaise: mrr,
      arrPaise: mrr * 12,
      collectionsPaise: payments.reduce((s, p) => s + p.amountPaise - p.refundedPaise, 0),
      newThisMonth: tenants.filter(
        (t) => t.createdAt >= new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      ).length,
      cancellations: cancelled,
      cancellationRate: started ? cancelled / started : 0,
      failedPayments: await db.subscriptionEvent.count({ where: { kind: 'PAYMENT_FAILED' } }),
      trialToPaid: started ? subscriptions.filter((s) => s.recurringPaise > 0).length / started : 0,
      openSupport: support,
      plans: plans.map((p) => ({
        ...p,
        count: subscriptions.filter((s) => s.planId === p.id).length,
      })),
      events,
    });
  }),
);
platformApi.get(
  '/tenants',
  admin(async (req: any, res: any) => {
    const q = z
      .string()
      .max(100)
      .parse(req.query.q || '');
    const tenants = await db.tenant.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { ownerEmail: { contains: q, mode: 'insensitive' } },
              { phone: { contains: q } },
              { slug: { contains: q } },
              { id: { contains: q } },
              {
                memberships: {
                  some: { role: 'OWNER', user: { name: { contains: q, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {},
      include: {
        subscription: { include: { plan: true } },
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(tenants);
  }),
);
platformApi.patch(
  '/tenants/:id',
  admin(async (req: any, res: any, actor: Actor) => {
    const tenantId = id.parse(req.params.id);
    const input = z
      .object({
        status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
        reason: text,
        onboarding: z.enum(['NEW', 'IN_PROGRESS', 'COMPLETE']).optional(),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(async (tx) => {
      await lock(tx, tenantId);
      const row = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          status: input.status,
          onboarding: input.onboarding,
          suspensionReason:
            input.status === undefined
              ? undefined
              : input.status === 'SUSPENDED'
                ? input.reason
                : null,
        },
      });
      await audit(tx, actor, 'TENANT_UPDATED', tenantId, input);
      return row;
    });
    res.json(row);
  }),
);
platformApi.post(
  '/tenants/:id/subscription',
  admin(async (req: any, res: any, actor: Actor) => {
    const tenantId = id.parse(req.params.id);
    const input = z
      .object({
        planId: id,
        status: z.enum(['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED']),
        interval: z.enum(['MONTHLY', 'ANNUAL']),
        days: z.number().int().min(1).max(730),
        reason: text,
        overrides: z
          .object({
            doctors: z.number().int().min(1).nullable().optional(),
            staff: z.number().int().min(0).nullable().optional(),
            branches: z.number().int().min(1).nullable().optional(),
            patients: z.number().int().min(0).nullable().optional(),
            storageBytes: z.number().int().min(0).nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(async (tx) => {
      await lock(tx, tenantId);
      const plan = await tx.plan.findUnique({ where: { id: input.planId } });
      assert(plan, 404, 'Plan not found.');
      const row = await tx.subscription.update({
        where: { tenantId },
        data: {
          planId: input.planId,
          status: input.status,
          interval: input.interval,
          endsAt: new Date(Date.now() + input.days * 86400000),
          cancelAtPeriodEnd: false,
          overrides: input.overrides,
          recurringPaise:
            input.status === 'ACTIVE'
              ? input.interval === 'ANNUAL'
                ? plan.annualPaise
                : plan.monthlyPaise
              : 0,
        },
      });
      await audit(tx, actor, 'MANUAL_SUBSCRIPTION', tenantId, input);
      await tx.subscriptionEvent.create({
        data: { tenantId, kind: 'MANUAL_SUBSCRIPTION', details: input },
      });
      return row;
    });
    res.json(row);
  }),
);
platformApi.get(
  '/plans',
  admin(async (_req: any, res: any) =>
    res.json(await db.plan.findMany({ orderBy: { monthlyPaise: 'asc' } })),
  ),
);
platformApi.post(
  '/plans',
  admin(async (req: any, res: any, actor: Actor) => {
    const data = planSchema.parse(req.body);
    const row = await transaction(async (tx) => {
      const row = await tx.plan.create({ data });
      await audit(tx, actor, 'PLAN_CREATED', undefined, { planId: row.id });
      return row;
    });
    res.status(201).json(row);
  }),
);
platformApi.patch(
  '/plans/:id',
  admin(async (req: any, res: any, actor: Actor) => {
    const data = planSchema.partial().parse(req.body);
    const row = await transaction(async (tx) => {
      const row = await tx.plan.update({ where: { id: id.parse(req.params.id) }, data });
      await audit(tx, actor, 'PLAN_UPDATED', undefined, { planId: row.id, changes: data });
      return row;
    });
    res.json(row);
  }),
);
platformApi.get(
  '/subscriptions',
  admin(async (_req: any, res: any) =>
    res.json(
      await db.subscription.findMany({
        include: { tenant: true, plan: true },
        orderBy: { startsAt: 'desc' },
      }),
    ),
  ),
);
platformApi.get(
  '/invoices',
  admin(async (_req: any, res: any) =>
    res.json(
      await db.subscriptionInvoice.findMany({
        include: { payments: true },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  ),
);
platformApi.post(
  '/reconcile',
  admin(async (req: any, res: any, actor: Actor) => {
    const { invoiceId } = z.object({ invoiceId: id.optional() }).strict().parse(req.body);
    const { reconcilePayments } = await import('./reconcile.js');
    const result = await reconcilePayments(invoiceId);
    await audit(db, actor, 'PAYMENT_RECONCILIATION', undefined, result);
    res.json(result);
  }),
);
platformApi.get(
  '/audit',
  admin(async (_req: any, res: any) =>
    res.json(await db.platformAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 500 })),
  ),
);
platformApi.get(
  '/settings',
  admin(async (_req: any, res: any) =>
    res.json((await db.platformSettings.findUnique({ where: { id: 'platform' } }))?.data || {}),
  ),
);
platformApi.patch(
  '/settings',
  admin(async (req: any, res: any, actor: Actor) => {
    const data = z
      .object({
        productName: text,
        supportEmail: z.string().email(),
        supportPhone: z.string().max(30),
        taxBps: z.number().int().min(0).max(3000),
        defaultTrialDays: z.number().int().min(0).max(90),
        currency: z.literal('INR'),
        termsUrl: z.union([z.string().url(), z.literal('')]),
        privacyUrl: z.union([z.string().url(), z.literal('')]),
        maintenanceNotice: z.string().max(1000),
      })
      .strict()
      .parse(req.body);
    await transaction(async (tx) => {
      await tx.platformSettings.upsert({
        where: { id: 'platform' },
        create: { data },
        update: { data },
      });
      await audit(tx, actor, 'PLATFORM_SETTINGS_UPDATED', undefined, data);
    });
    res.json(data);
  }),
);
platformApi.get(
  '/support',
  admin(async (_req: any, res: any) =>
    res.json(await db.supportRequest.findMany({ orderBy: { createdAt: 'desc' } })),
  ),
);
platformApi.patch(
  '/support/:id',
  admin(async (req: any, res: any, actor: Actor) => {
    const data = z
      .object({
        status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(),
        notes: z.string().max(10000).optional(),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(async (tx) => {
      const row = await tx.supportRequest.update({ where: { id: id.parse(req.params.id) }, data });
      await audit(tx, actor, 'SUPPORT_UPDATED', row.tenantId, { requestId: row.id, ...data });
      return row;
    });
    res.json(row);
  }),
);
platformApi.get(
  '/support-grants',
  admin(async (_req: any, res: any) =>
    res.json(await db.supportAccessGrant.findMany({ orderBy: { createdAt: 'desc' } })),
  ),
);
platformApi.get(
  '/support-access/:id',
  admin(async (req: any, res: any, actor: Actor) => {
    const initial = await db.supportAccessGrant.findUnique({
      where: { id: id.parse(req.params.id) },
    });
    assert(initial, 404, 'Grant not found.');
    const summary = await transaction(async (tx) => {
      await lock(tx, initial.tenantId);
      const grant = await tx.supportAccessGrant.findUniqueOrThrow({ where: { id: initial.id } });
      assert(
        grant.adminUserId === actor.userId &&
          !grant.revoked &&
          grant.expiresAt > new Date() &&
          grant.patientId,
        403,
        'No current, patient-scoped customer authorization.',
      );
      const consent = await tx.membership.findUnique({
        where: { userId_tenantId: { userId: grant.consentedBy, tenantId: grant.tenantId } },
      });
      assert(
        consent?.active && consent.role === 'OWNER',
        403,
        'Customer consent is no longer valid.',
      );

      const store = new TenantStore(tx, grant.tenantId);
      const patient = await store.get('patient', grant.patientId);
      const [notes, charts, plans] = await Promise.all([
        store.list('clinicalNote', { patientId: patient.id }),
        store.list('chartVersion', { patientId: patient.id }),
        store.list('treatmentPlan', { patientId: patient.id }),
      ]);
      await audit(tx, actor, 'AUTHORIZED_CLINICAL_SUPPORT_READ', grant.tenantId, {
        grantId: grant.id,
        patientId: patient.id,
        reason: grant.reason,
      });
      await store.audit(actor.userId, 'support.clinical_summary_read', patient.id);
      return {
        grant: { id: grant.id, reason: grant.reason, expiresAt: grant.expiresAt },
        patient: {
          id: patient.id,
          name: patient.name,
          allergies: patient.allergies,
          medicalHistory: patient.medicalHistory,
        },
        notes,
        charts,
        plans,
      };
    });
    res.json(summary);
  }),
);
platformApi.get(
  '/coupons',
  admin(async (_req: any, res: any) => res.json(await db.coupon.findMany())),
);
platformApi.post(
  '/tenants/:id/reset-owner',
  admin(async (req: any, res: any, actor: Actor) => {
    const tenant = await db.tenant.findUnique({ where: { id: id.parse(req.params.id) } });
    assert(tenant, 404, 'Clinic not found.');
    const user = await db.user.findUnique({ where: { email: tenant.ownerEmail } });
    assert(user, 404, 'Owner account not found.');
    const token = opaque();
    await transaction(async (tx) => {
      await tx.authToken.create({
        data: {
          tokenHash: hash(token),
          userId: user.id,
          purpose: 'RESET',
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      await audit(tx, actor, 'OWNER_RESET_REQUESTED', tenant.id);
    });
    const sent = await sendToken(user.email, token, 'RESET');
    res.json({ message: 'Password reset requested.', ...sent });
  }),
);
platformApi.post(
  '/coupons',
  admin(async (req: any, res: any, actor: Actor) => {
    const data = z
      .object({
        code: z.string().regex(/^[A-Z0-9_-]{3,30}$/),
        percent: z.number().int().min(1).max(100),
        expiresAt: z
          .string()
          .datetime()
          .transform((v) => new Date(v)),
        active: z.boolean(),
      })
      .strict()
      .parse(req.body);
    const row = await transaction(async (tx) => {
      const row = await tx.coupon.create({ data });
      await audit(tx, actor, 'COUPON_CREATED', undefined, { code: data.code });
      return row;
    });
    res.json(row);
  }),
);

billingApi.get(
  '/',
  owner(async (_req: any, res: any, { tx, tenant, subscription }: any) => {
    res.json({
      subscription,
      invoices: await tx.subscriptionInvoice.findMany({
        where: { tenantId: tenant.id },
        include: { payments: true },
        orderBy: { createdAt: 'desc' },
      }),
      plans: await tx.plan.findMany({
        where: { available: true },
        orderBy: { monthlyPaise: 'asc' },
      }),
    });
  }),
);
billingApi.post(
  '/cancel',
  owner(async (_req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const row = await tx.subscription.update({
      where: { tenantId: tenant.id },
      data: { cancelAtPeriodEnd: true },
    });
    await tx.subscriptionEvent.create({
      data: { tenantId: tenant.id, kind: 'CANCELLATION_REQUESTED' },
    });
    await store.audit(actor.userId, 'subscription.cancelled');
    res.json(row);
  }),
);
billingApi.post(
  '/resume',
  owner(async (_req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const row = await tx.subscription.update({
      where: { tenantId: tenant.id },
      data: { cancelAtPeriodEnd: false },
    });
    await store.audit(actor.userId, 'subscription.resumed');
    res.json(row);
  }),
);
billingApi.post(
  '/checkout',
  owner(async (req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    assert(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET,
      503,
      'Razorpay is not configured. Contact support for manual activation.',
    );
    const data = z
      .object({
        planId: id,
        interval: z.enum(['MONTHLY', 'ANNUAL']),
        coupon: z.string().max(30).optional(),
      })
      .strict()
      .parse(req.body);
    const plan = await tx.plan.findFirst({ where: { id: data.planId, available: true } });
    assert(plan, 404, 'Plan unavailable.');
    let subtotal = data.interval === 'ANNUAL' ? plan.annualPaise : plan.monthlyPaise;
    if (data.coupon) {
      const coupon = await tx.coupon.findUnique({ where: { code: data.coupon.toUpperCase() } });
      assert(coupon?.active && coupon.expiresAt > new Date(), 400, 'Coupon invalid or expired.');
      subtotal = Math.round((subtotal * (100 - coupon.percent)) / 100);
    }
    assert(subtotal > 0, 400, 'A fully discounted subscription requires manual activation.');
    const settings = (await tx.platformSettings.findUnique({ where: { id: 'platform' } }))
      ?.data as any;
    const tax = Math.round((subtotal * (settings?.taxBps || 0)) / 10000);
    const invoice = await tx.subscriptionInvoice.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        interval: data.interval,
        subtotalPaise: subtotal,
        taxPaise: tax,
        totalPaise: subtotal + tax,
      },
    });
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: invoice.totalPaise,
        currency: 'INR',
        receipt: invoice.id,
        notes: { invoiceId: invoice.id },
      }),
      signal: AbortSignal.timeout(8000),
    });
    assert(response.ok, 502, 'Payment provider could not create checkout. Please retry.');
    const order: any = await response.json();
    await tx.subscriptionInvoice.update({
      where: { id: invoice.id },
      data: { providerOrderId: order.id },
    });
    await store.audit(actor.userId, 'subscription.checkout', invoice.id);
    res.json({
      key: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: invoice.totalPaise,
      currency: 'INR',
      invoiceId: invoice.id,
    });
  }),
);
billingApi.get(
  '/support',
  owner(async (_req: any, res: any, { tx, tenant }: any) =>
    res.json(
      await tx.supportRequest.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  ),
);
billingApi.post(
  '/support',
  owner(async (req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const data = z
      .object({ subject: text, message: z.string().min(1).max(10000) })
      .strict()
      .parse(req.body);
    const row = await tx.supportRequest.create({ data: { tenantId: tenant.id, ...data } });
    await store.audit(actor.userId, 'support.created', row.id);
    res.status(201).json(row);
  }),
);
billingApi.post(
  '/closure',
  owner(async (req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const { reason } = z.object({ reason: text }).strict().parse(req.body);
    const row = await tx.supportRequest.create({
      data: { tenantId: tenant.id, subject: 'Account closure request', message: reason },
    });
    await store.audit(actor.userId, 'closure.requested', row.id);
    res.status(201).json({
      message:
        'Closure request recorded. Support will confirm export, retention and deletion dates before closing the account.',
      request: row,
    });
  }),
);
billingApi.get(
  '/support-grants',
  owner(async (_req: any, res: any, { tx, tenant }: any) =>
    res.json(
      await tx.supportAccessGrant.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: 'desc' },
      }),
    ),
  ),
);
billingApi.post(
  '/support-grants',
  owner(async (req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const data = z
      .object({
        adminUserId: id,
        patientId: id,
        reason: text,
        hours: z.number().int().min(1).max(24),
        consent: z.literal(true),
      })
      .strict()
      .parse(req.body);
    await store.get('patient', data.patientId);
    const admin = await tx.user.findFirst({ where: { id: data.adminUserId, platformAdmin: true } });
    assert(admin, 404, 'Administrator not found.');
    const row = await tx.supportAccessGrant.create({
      data: {
        tenantId: tenant.id,
        patientId: data.patientId,
        adminUserId: data.adminUserId,
        reason: data.reason,
        consentedBy: actor.userId,
        expiresAt: new Date(Date.now() + data.hours * 3600000),
      },
    });
    await store.audit(actor.userId, 'support.consent', row.id);
    res.json(row);
  }),
);
billingApi.delete(
  '/support-grants/:id',
  owner(async (req: any, res: any, { tx, tenant, store }: any, actor: Actor) => {
    const grant = await tx.supportAccessGrant.findFirst({
      where: { id: id.parse(req.params.id), tenantId: tenant.id },
    });
    assert(grant, 404, 'Grant not found.');
    await tx.supportAccessGrant.update({ where: { id: grant.id }, data: { revoked: true } });
    await store.audit(actor.userId, 'support.revoked', grant.id);
    res.json({ ok: true });
  }),
);

export async function processWebhook(raw: Buffer, signature: string, eventId: string) {
  assert(Buffer.isBuffer(raw), 400, 'Webhook body must be raw application/json bytes.');
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  assert(secret, 503, 'Webhook secret is not configured.');
  assert(verifyWebhook(raw, signature, secret), 400, 'Invalid webhook signature.');
  const event = JSON.parse(raw.toString());
  const key = eventId || hash(raw.toString());
  return transaction(
    async (tx) => {
      await lock(tx, `webhook:${key}`);
      if (await tx.subscriptionEvent.findUnique({ where: { providerEventId: key } }))
        return { duplicate: true };
      const payment = event.payload?.payment?.entity;
      const refund = event.payload?.refund?.entity;
      let tenantId: string | undefined;
      if (event.event === 'payment.captured') {
        assert(payment?.id && payment?.order_id, 400, 'Invalid captured payment payload.');
        const invoice = await tx.subscriptionInvoice.findUnique({
          where: { providerOrderId: payment.order_id },
        });
        // Ignore payments belonging to other products in a shared gateway account.
        if (invoice) {
          tenantId = invoice.tenantId;
          await lock(tx, tenantId);
          assert(
            payment.status === 'captured' &&
              payment.currency === invoice.currency &&
              payment.amount === invoice.totalPaise,
            400,
            'Payment amount, currency or status mismatch.',
          );
          const exists = await tx.subscriptionPayment.findUnique({
            where: { providerPaymentId: payment.id },
          });
          if (!exists && invoice.status !== 'PAID') {
            await tx.subscriptionPayment.create({
              data: {
                tenantId,
                invoiceId: invoice.id,
                providerPaymentId: payment.id,
                amountPaise: payment.amount,
              },
            });
            await tx.subscriptionInvoice.update({
              where: { id: invoice.id },
              data: { status: 'PAID' },
            });
            const sub = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
            const samePlan = sub.planId === invoice.planId && sub.interval === invoice.interval;
            const start =
              samePlan && sub.endsAt > new Date() && sub.status === 'ACTIVE'
                ? sub.endsAt
                : new Date();
            await tx.subscription.update({
              where: { tenantId },
              data: {
                planId: invoice.planId,
                interval: invoice.interval,
                status: 'ACTIVE',
                endsAt: periodEnd(start, invoice.interval),
                cancelAtPeriodEnd: false,
                recurringPaise: invoice.subtotalPaise,
              },
            });
          }
        }
      } else if (event.event === 'payment.failed' && payment?.order_id) {
        const invoice = await tx.subscriptionInvoice.findUnique({
          where: { providerOrderId: payment.order_id },
        });
        if (invoice) {
          tenantId = invoice.tenantId;
          await tx.subscriptionInvoice.updateMany({
            where: { id: invoice.id, status: { not: 'PAID' } },
            data: { status: 'FAILED' },
          });
        }
      } else if (event.event === 'refund.processed' && refund?.payment_id) {
        const initial = await tx.subscriptionPayment.findUnique({
          where: { providerPaymentId: refund.payment_id },
        });
        if (initial) {
          tenantId = initial.tenantId;
          await lock(tx, tenantId);
          const p = await tx.subscriptionPayment.findUniqueOrThrow({ where: { id: initial.id } });
          assert(
            typeof refund.id === 'string' && Number.isInteger(refund.amount) && refund.amount > 0,
            400,
            'Invalid refund payload.',
          );
          if (
            !(await tx.subscriptionRefund.findUnique({ where: { providerRefundId: refund.id } }))
          ) {
            assert(
              p.refundedPaise + refund.amount <= p.amountPaise,
              409,
              'Refund exceeds captured amount.',
            );
            await tx.subscriptionRefund.create({
              data: { paymentId: p.id, providerRefundId: refund.id, amountPaise: refund.amount },
            });
            await tx.subscriptionPayment.update({
              where: { id: p.id },
              data: { refundedPaise: p.refundedPaise + refund.amount },
            });
          }
        }
      }
      await tx.subscriptionEvent.create({
        data: {
          providerEventId: key,
          tenantId,
          kind: event.event === 'payment.failed' ? 'PAYMENT_FAILED' : event.event || 'UNKNOWN',
          details: {
            paymentId: payment?.id || refund?.payment_id || null,
            refundId: refund?.id || null,
          },
        },
      });
      return { received: true };
    },
    { maxWait: 15000, timeout: 20000 },
  );
}
