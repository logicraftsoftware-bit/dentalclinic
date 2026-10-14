import { db, transaction, lock, TenantStore, log, opaque } from './core.js';
import { reconcilePayments } from './reconcile.js';
import nodemailer from 'nodemailer';
// Cursor and lease persist across function instances. A run processes at most 10 clinics.
export async function runJobs() {
  const owner = opaque();
  const claimed = await transaction(async tx => {
    await lock(tx, 'cron:jobs');
    const current = await tx.cronState.findUnique({ where: { id: 'jobs' } });
    if (current && current.leaseExpiresAt > new Date()) return null;
    return tx.cronState.upsert({ where: { id: 'jobs' }, create: { id: 'jobs', owner, leaseExpiresAt: new Date(Date.now() + 300000) }, update: { owner, leaseExpiresAt: new Date(Date.now() + 300000) } });
  });
  if (!claimed) return { skipped: true };
  let cursor = claimed.cursor;
  let processed = 0;
  try {
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.RAZORPAY_WEBHOOK_SECRET) {
      const result = await reconcilePayments();
      if (result.failedInvoiceIds.length) log.warn({ count: result.failedInvoiceIds.length }, 'Payment reconciliation needs review');
    }
    const tenants = await db.tenant.findMany({ where: cursor ? { id: { gt: cursor } } : {}, orderBy: { id: 'asc' }, take: 10, select: { id: true, ownerEmail: true } });
    for (const tenant of tenants) {
      const reminder = await transaction(async tx => {
        await lock(tx, tenant.id);
        const store = new TenantStore(tx, tenant.id);
        const sub = await tx.subscription.findUnique({ where: { tenantId: tenant.id }, include: { plan: true } });
        if (!sub) return null;
        for (const record of await store.list('idempotencyRecord', { createdAt: { lt: new Date(Date.now() - 86400000) } }, { take: 100 })) await store.remove('idempotencyRecord', record.id);
        const days = Math.ceil((sub.endsAt.getTime() - Date.now()) / 86400000);
        const key = `subscription-reminder:${sub.id}:${sub.endsAt.toISOString()}:${new Date().toISOString().slice(0, 10)}`;
        let mail: { id: string; endsAt: Date } | null = null;
        if (process.env.SMTP_HOST && days >= 0 && days <= 3) {
          const previous = (await store.list('jobRecord', { key }))[0];
          if (!previous || previous.status === 'FAILED') {
            const record = previous ? await tx.jobRecord.update({ where: { id: previous.id }, data: { status: 'SENDING' } }) : await store.create('jobRecord', { key, status: 'SENDING' });
            mail = { id: record.id, endsAt: sub.endsAt };
          }
        }
        const grace = sub.status === 'TRIAL' || sub.cancelAtPeriodEnd ? 0 : sub.plan.graceDays;
        if (sub.endsAt.getTime() + grace * 86400000 <= Date.now() && !['EXPIRED', 'CANCELLED'].includes(sub.status)) {
          await tx.subscription.update({ where: { id: sub.id }, data: { status: sub.cancelAtPeriodEnd ? 'CANCELLED' : 'EXPIRED' } });
          await tx.subscriptionEvent.create({ data: { tenantId: tenant.id, kind: 'SUBSCRIPTION_EXPIRED' } });
        }
        return mail;
      });
      if (reminder) {
        try {
          const smtp = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }, connectionTimeout: 8000, socketTimeout: 10000 });
          await smtp.sendMail({ from: process.env.MAIL_FROM, to: tenant.ownerEmail, subject: 'DentaFlow subscription reminder', text: `Your clinic subscription ends on ${reminder.endsAt.toISOString().slice(0,10)}. Please sign in to review your subscription.` });
          await db.jobRecord.update({ where: { id: reminder.id }, data: { status: 'SENT' } });
        } catch { await db.jobRecord.update({ where: { id: reminder.id }, data: { status: 'FAILED' } }); }
      }
      cursor = tenant.id; processed++;
    }
    if (tenants.length < 10) cursor = '';
    return { processed };
  } finally {
    await db.cronState.updateMany({ where: { id: 'jobs', owner }, data: { cursor, leaseExpiresAt: new Date(0) } });
  }
}
