import { db, TenantStore, log } from './core.js';
import { reconcilePayments } from './reconcile.js';
// Run hourly through your scheduler. Each job establishes its own transaction context.
export async function runJobs() {
  if (
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET &&
    process.env.RAZORPAY_WEBHOOK_SECRET
  ) {
    const result = await reconcilePayments();
    if (result.failedInvoiceIds.length)
      log.warn(
        { failedInvoiceIds: result.failedInvoiceIds },
        'Payment reconciliation needs review',
      );
  }
  for (const tenant of await db.tenant.findMany({ select: { id: true, ownerEmail: true } })) {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${tenant.id},0))`;
        await tx.$executeRaw`SELECT set_config('app.tenant_id',${tenant.id},true)`;
        const store = new TenantStore(tx, tenant.id);
        const sub = await tx.subscription.findUnique({
          where: { tenantId: tenant.id },
          include: { plan: true },
        });
        if (!sub) return;
        for (const record of await store.list(
          'idempotencyRecord',
          { createdAt: { lt: new Date(Date.now() - 86400000) } },
          { take: 500 },
        ))
          await store.remove('idempotencyRecord', record.id);
        const today = new Date().toISOString().slice(0, 10);
        const days = Math.ceil((sub.endsAt.getTime() - Date.now()) / 86400000);
        const key = `subscription-reminder:${sub.id}:${sub.endsAt.toISOString()}:${today}`;
        if (days >= 0 && days <= 3 && !(await store.list('jobRecord', { key })).length) {
          // Do not mark as sent unless the configured provider accepted the mail.
          if (process.env.SMTP_HOST) {
            const nodemailer = await import('nodemailer');
            const smtp = nodemailer.default.createTransport({
              host: process.env.SMTP_HOST,
              port: Number(process.env.SMTP_PORT || 587),
              secure: process.env.SMTP_PORT === '465',
              auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
            });
            await smtp.sendMail({
              from: process.env.MAIL_FROM,
              to: tenant.ownerEmail,
              subject: 'DentaFlow subscription reminder',
              text: `Your clinic subscription ends on ${sub.endsAt.toISOString().slice(0, 10)}. Please sign in to review your subscription.`,
            });
            await store.create('jobRecord', { key, status: 'SENT' });
          }
        }
        const grace = sub.status === 'TRIAL' || sub.cancelAtPeriodEnd ? 0 : sub.plan.graceDays;
        if (
          sub.endsAt.getTime() + grace * 86400000 <= Date.now() &&
          !['EXPIRED', 'CANCELLED'].includes(sub.status)
        ) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: sub.cancelAtPeriodEnd ? 'CANCELLED' : 'EXPIRED' },
          });
          await tx.subscriptionEvent.create({
            data: { tenantId: tenant.id, kind: 'SUBSCRIPTION_EXPIRED' },
          });
        }
      },
      { timeout: 20000 },
    );
  }
}
if (process.env.NODE_ENV !== 'test')
  runJobs()
    .then(() => log.info('Jobs completed'))
    .catch((e) => {
      log.error({ name: e.name }, 'Jobs failed');
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
