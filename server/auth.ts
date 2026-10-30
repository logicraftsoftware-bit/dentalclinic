import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, transaction, lock, opaque, hash, assert, prod, authenticate, text, id, clinic } from './core.js';
import { sendToken } from './mail.js';
import { workspaceData } from './workspace.js';

export const auth = Router();
const password = z.string().min(12).max(128);
const email = z
  .string()
  .email()
  .max(200)
  .transform((s) => s.toLowerCase());
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
async function session(res: any, userId: string, tenantId: string | null) {
  const token = opaque();
  await db.session.create({
    data: {
      tokenHash: hash(token),
      userId,
      tenantId,
      expiresAt: new Date(Date.now() + 8 * 3600000),
    },
  });
  res.cookie('df_session', token, {
    httpOnly: true,
    secure: prod,
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 3600000,
  });
}
auth.post(
  '/register',
  wrap(async (req: any, res: any) => {
    const input = z
      .object({
        clinicName: text,
        name: text,
        email,
        phone: z.string().min(8).max(20),
        password,
        planId: id,
        acceptTerms: z.literal(true),
      })
      .strict()
      .parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    const result = await transaction(async (tx) => {
      await lock(tx, input.email);
      const existing = await tx.user.findUnique({ where: { email: input.email } });
      if (existing) {
        assert(
          await bcrypt.compare(input.password, existing.passwordHash),
          409,
          'This email is already registered. Sign in or reset your password.',
        );
        const member = await tx.membership.findFirst({ where: { userId: existing.id } });
        assert(member, 409, 'Account exists. Contact support.');
        return { tenantId: member.tenantId };
      }
      const plan = await tx.plan.findFirst({ where: { id: input.planId, available: true } });
      assert(plan, 400, 'Plan unavailable.');
      const slugBase =
        input.clinicName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40) || 'clinic';
      const tenant = await tx.tenant.create({
        data: {
          name: input.clinicName,
          ownerEmail: input.email,
          phone: input.phone,
          slug: `${slugBase}-${opaque().slice(0, 8)}`,
          settings: {
            currency: 'INR',
            timezone: 'Asia/Kolkata',
            invoiceFooter: 'Thank you for trusting us with your smile.',
            appointmentHours: 'Mon–Sat, 9:00–18:00',
          },
        },
      });
      const user = await tx.user.create({
        data: { email: input.email, name: input.name, passwordHash },
      });
      await tx.membership.create({ data: { userId: user.id, tenantId: tenant.id, role: 'OWNER' } });
      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          endsAt: new Date(Date.now() + plan.trialDays * 86400000),
        },
      });

      await tx.branch.create({ data: { tenantId: tenant.id, name: 'Main clinic' } });
      await tx.catalogItem.createMany({
        data: [
          ['Consultation', 50000, 1],
          ['Scaling & polishing', 150000, 1],
          ['Root canal treatment', 600000, 3],
          ['Dental crown', 800000, 2],
        ].map(([name, pricePaise, sessions]) => ({
          tenantId: tenant.id,
          name: String(name),
          pricePaise: Number(pricePaise),
          sessions: Number(sessions),
        })),
      });
      await tx.subscriptionEvent.create({ data: { tenantId: tenant.id, kind: 'TRIAL_STARTED' } });
      return { tenantId: tenant.id };
    });
    res
      .status(201)
      .json({
        ...result,
        message: 'Clinic workspace is ready. Sign in with your email and password.',
      });
  }),
);
auth.post(
  '/verify',
  wrap(async (req: any, res: any) => {
    const { token } = z.object({ token: z.string().length(64) }).parse(req.body);
    await transaction(async (tx) => {
      const t = await tx.authToken.findUnique({ where: { tokenHash: hash(token) } });
      assert(
        t && t.purpose === 'VERIFY' && t.expiresAt > new Date(),
        400,
        'Verification code is invalid or expired.',
      );
      await tx.authToken.delete({ where: { id: t.id } });
      await tx.user.update({ where: { id: t.userId }, data: { verified: true } });
    });
    res.json({ message: 'Email verified. You can now sign in.' });
  }),
);
auth.post(
  '/login',
  wrap(async (req: any, res: any) => {
    const input = z.object({ email: z.string().trim().min(1).max(254).transform(s => s.toLowerCase()), password: z.string().max(128) }).parse(req.body);
    const user = input.email.includes('@') ? await db.user.findUnique({ where: { email: input.email } }) : await db.user.findFirst({ where: { username: input.email } });
    const valid = await bcrypt.compare(
      input.password,
      user?.passwordHash || '$2b$12$mEZsINPRgkd/6rFmcVKnhOF16lxWI7VEIKKsDBBpmJnzWdqs.VBr.',
    );
    assert(user && valid, 401, 'Email, username or password is incorrect.');
    const member = await db.membership.findFirst({
      where: { userId: user.id, active: true },
      orderBy: { id: 'asc' },
    });
    await session(res, user.id, member?.tenantId || null);
    res.json({ ok: true });
  }),
);
auth.post(
  '/logout',
  wrap(async (req: any, res: any) => {
    if (req.cookies?.df_session)
      await db.session.deleteMany({ where: { tokenHash: hash(req.cookies.df_session) } });
    res.clearCookie('df_session', { path: '/' }).json({ ok: true });
  }),
);
auth.get(
  '/me',
  wrap(async (req: any, res: any) => {
    const actor = await authenticate(req);
    const memberships = await db.membership.findMany({
      where: { userId: actor.userId, active: true },
      include: { tenant: true },
    });
    res.json({
      ...actor,
      ...(req.query.workspace === 'true' && actor.tenantId ? {
        workspace: await clinic(actor, 'dashboard', async ctx => workspaceData(ctx), { accessOnly: true, readOnly: true, hostname: req.hostname }),
      } : {}),
      memberships: memberships.map((m) => ({
        tenantId: m.tenantId,
        role: m.role,
        name: m.tenant.name,
        slug: m.tenant.slug,
      })),
    });
  }),
);
auth.post(
  '/switch',
  wrap(async (req: any, res: any) => {
    const actor = await authenticate(req);
    const { tenantId } = z.object({ tenantId: id }).parse(req.body);
    const m = await db.membership.findUnique({
      where: { userId_tenantId: { userId: actor.userId, tenantId } },
    });
    assert(m?.active, 403, 'Unauthorized clinic.');
    await db.session.update({
      where: { tokenHash: hash(req.cookies.df_session) },
      data: { tenantId },
    });
    res.json({ ok: true });
  }),
);
auth.post(
  '/forgot',
  wrap(async (req: any, res: any) => {
    const input = z.object({ email }).parse(req.body);
    const user = await db.user.findUnique({ where: { email: input.email } });
    let development = {};
    if (user) {
      const token = opaque();
      await db.authToken.create({
        data: {
          tokenHash: hash(token),
          userId: user.id,
          purpose: 'RESET',
          expiresAt: new Date(Date.now() + 1800000),
        },
      });
      development = await sendToken(user.email, token, 'RESET');
    }
    res.json({ message: 'If an account exists, a reset code has been sent.', ...development });
  }),
);
auth.post(
  '/reset',
  wrap(async (req: any, res: any) => {
    const input = z.object({ token: z.string().length(64), password }).parse(req.body);
    const passwordHash = await bcrypt.hash(input.password, 12);
    await transaction(async (tx) => {
      const t = await tx.authToken.findUnique({ where: { tokenHash: hash(input.token) } });
      assert(
        t && t.purpose === 'RESET' && t.expiresAt > new Date(),
        400,
        'Reset code invalid or expired.',
      );
      await tx.authToken.delete({ where: { id: t.id } });
      await tx.user.update({ where: { id: t.userId }, data: { passwordHash } });
      await tx.authToken.deleteMany({ where: { userId: t.userId, purpose: 'RESET' } });
      await tx.session.deleteMany({ where: { userId: t.userId } });
    });
    res.json({ message: 'Password updated. Sign in again.' });
  }),
);
