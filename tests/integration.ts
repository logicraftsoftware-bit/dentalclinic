import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'integration-webhook-secret';
const { app } = await import('../server/index.js');
const { db } = await import('../server/core.js');
const bcrypt = (await import('bcryptjs')).default;
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address() as any;
const root = `http://127.0.0.1:${address.port}/api`;
const password = 'Testing-Strong-Password-123';
let a: any,
  b: any,
  plan: any,
  adminCookie = '',
  patientA: any,
  patientB: any,
  doctorA: any,
  documentB: any,
  invoiceA: any;
async function request(path: string, method = 'GET', body?: any, cookie?: string) {
  const response = await fetch(root + path, {
    method,
    headers: {
      Origin: 'http://localhost:5173',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body instanceof FormData ? {} : body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  const type = response.headers.get('content-type');
  const data = type?.includes('json') ? await response.json() : await response.arrayBuffer();
  return {
    status: response.status,
    data,
    cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
  };
}
async function register(name: string) {
  const email = `${randomUUID()}@example.test`;
  const data = {
    clinicName: name,
    name: 'Test owner',
    email,
    phone: '9876543210',
    password,
    planId: plan.id,
    acceptTerms: true,
  };
  const signup = await request('/auth/register', 'POST', data);
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  const retry = await request('/auth/register', 'POST', data);
  assert.equal(retry.data.tenantId, signup.data.tenantId);
  assert.equal(
    (await request('/auth/verify', 'POST', { token: retry.data.developmentToken })).status,
    200,
  );
  const login = await request('/auth/login', 'POST', { email, password });
  assert.equal(login.status, 200);
  return { tenantId: signup.data.tenantId, cookie: login.cookie, email };
}
before(async () => {
  await db.$runCommandRaw({ ping: 1 });
  plan = await db.plan.findUniqueOrThrow({ where: { name: 'Starter' } });
  a = await register('Isolation Clinic A');
  b = await register('Isolation Clinic B');
  patientA = (
    await request('/clinic/patients', 'POST', { name: 'Patient A', phone: '9000000001' }, a.cookie)
  ).data;
  patientB = (
    await request('/clinic/patients', 'POST', { name: 'Patient B', phone: '9000000002' }, b.cookie)
  ).data;
  const email = `admin-${randomUUID()}@example.test`;
  await db.user.create({
    data: {
      name: 'Test platform admin',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      verified: true,
      platformAdmin: true,
    },
  });
  adminCookie = (await request('/auth/login', 'POST', { email, password })).cookie;
});
after(async () => {
  server.close();
  await db.$disconnect();
});
test('registration is idempotent and clinic sessions run concurrently', async () => {
  const [aa, bb] = await Promise.all([
    request('/clinic/patients', 'GET', undefined, a.cookie),
    request('/clinic/patients', 'GET', undefined, b.cookie),
  ]);
  assert.equal(aa.status, 200);
  assert.equal(bb.status, 200);
  assert.deepEqual(
    aa.data.map((p: any) => p.id),
    [patientA.id],
  );
  assert.deepEqual(
    bb.data.map((p: any) => p.id),
    [patientB.id],
  );
});
test('cross-tenant detail, update, search and exports are denied', async () => {
  assert.equal(
    (await request(`/clinic/patients/${patientB.id}`, 'GET', undefined, a.cookie)).status,
    404,
  );
  assert.equal(
    (await request(`/clinic/patients/${patientB.id}`, 'PATCH', { name: 'Hijacked' }, a.cookie))
      .status,
    404,
  );
  assert.equal(
    (await request('/clinic/patients?q=Patient%20B', 'GET', undefined, a.cookie)).data.length,
    0,
  );
  assert.equal(
    (await request(`/clinic/export?patientId=${patientB.id}`, 'GET', undefined, a.cookie)).status,
    403,
  ); // Starter does not allow export.
  assert.equal(
    (
      await request(
        '/clinic/patients',
        'POST',
        { name: 'Attack', phone: '9000000003', tenantId: b.tenantId },
        a.cookie,
      )
    ).status,
    400,
  );
});
test('MongoDB repository rejects cross-clinic relationships and scopes every read', async () => {
  const { TenantStore, transaction, lock } = await import('../server/core.js');
  await assert.rejects(transaction(async tx => {
    await lock(tx, a.tenantId);
    const store = new TenantStore(tx, a.tenantId);
    await store.create('invoice', { patientId: patientB.id, description: 'Invalid', totalPaise: 100 });
  }), /Record not found/);
  await transaction(async tx => {
    const store = new TenantStore(tx, a.tenantId);
    assert.equal((await store.list('patient', { tenantId: b.tenantId })).every((row: any) => row.tenantId === a.tenantId), true);
    await assert.rejects(store.get('patient', patientB.id), /Record not found/);
    await assert.rejects(store.update('patient', patientA.id, { name: { set: 'Nested write' } }), /Nested writes/);
  });
});

test('concurrent doctor creation cannot race through plan limits', async () => {
  const results = await Promise.all(
    [1, 2, 3].map((i) =>
      request('/clinic/doctors', 'POST', { name: `Doctor ${i}`, commissionPercent: 20 }, a.cookie),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 2);
  assert.equal(results.filter((r) => r.status === 409).length, 1);
  doctorA = results.find((r) => r.status === 201)!.data;
});
test('cross-tenant appointment create and cancel reject foreign IDs', async () => {
  assert.equal(
    (
      await request(
        '/clinic/appointments',
        'POST',
        {
          patientId: patientB.id,
          doctorId: doctorA.id,
          startsAt: new Date(Date.now() + 86400000).toISOString(),
        },
        a.cookie,
      )
    ).status,
    404,
  );
  const doctorB = (await request('/clinic/doctors', 'POST', { name: 'Doctor B' }, b.cookie)).data;
  const appt = (
    await request(
      '/clinic/appointments',
      'POST',
      {
        patientId: patientB.id,
        doctorId: doctorB.id,
        startsAt: new Date(Date.now() + 86400000).toISOString(),
      },
      b.cookie,
    )
  ).data;
  assert.equal(
    (await request(`/clinic/appointments/${appt.id}`, 'DELETE', undefined, a.cookie)).status,
    404,
  );
});
test('tooth charts retain versions and clinical notes remain clinic scoped', async () => {
  for (const condition of ['Caries', 'Filled'])
    assert.equal(
      (
        await request(
          '/clinic/charts',
          'POST',
          { patientId: patientA.id, teeth: { '36': { condition, notes: 'Test finding' } } },
          a.cookie,
        )
      ).status,
      201,
    );
  assert.equal(
    (await request(`/clinic/charts?patientId=${patientA.id}`, 'GET', undefined, a.cookie)).data
      .length,
    2,
  );
  assert.equal(
    (await request(`/clinic/charts?patientId=${patientA.id}`, 'GET', undefined, b.cookie)).data
      .length,
    0,
  );
  assert.equal(
    (
      await request(
        '/clinic/notes',
        'POST',
        { patientId: patientB.id, complaint: 'Attempt' },
        a.cookie,
      )
    ).status,
    404,
  );
});
test('sessions generate invoices and installment retries accrue commission once', async () => {
  const plan = (
    await request(
      '/clinic/plans',
      'POST',
      { patientId: patientA.id, title: 'Root canal' },
      a.cookie,
    )
  ).data;
  const item = (
    await request(
      '/clinic/items',
      'POST',
      { planId: plan.id, tooth: '36', name: 'Root canal', pricePaise: 100000, plannedSessions: 2 },
      a.cookie,
    )
  ).data;
  assert.equal(
    (
      await request(
        '/clinic/sessions',
        'POST',
        { itemId: item.id, doctorId: doctorA.id, notes: 'Session 1', feePaise: 50000 },
        a.cookie,
      )
    ).status,
    409,
  );
  await request(`/clinic/plans/${plan.id}`, 'PATCH', { status: 'ACCEPTED' }, a.cookie);
  assert.equal(
    (
      await request(
        '/clinic/sessions',
        'POST',
        { itemId: item.id, doctorId: doctorA.id, notes: 'Session 1', feePaise: 50000 },
        a.cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await request(
        '/clinic/sessions',
        'POST',
        { itemId: item.id, doctorId: doctorA.id, notes: 'Final session', feePaise: 40000 },
        a.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        '/clinic/sessions',
        'POST',
        { itemId: item.id, doctorId: doctorA.id, notes: 'Final session', feePaise: 50000 },
        a.cookie,
      )
    ).status,
    201,
  );
  invoiceA = (await request('/clinic/invoices', 'GET', undefined, a.cookie)).data[0];
  const body = {
    invoiceId: invoiceA.id,
    amountPaise: 20000,
    method: 'UPI',
    idempotencyKey: randomUUID(),
  };
  const [one, two] = await Promise.all([
    request('/clinic/payments', 'POST', body, a.cookie),
    request('/clinic/payments', 'POST', body, a.cookie),
  ]);
  assert.equal(one.data.id, two.data.id);
  assert.equal((await request('/clinic/commissions', 'GET', undefined, a.cookie)).data.length, 1);
  assert.equal(
    (await request(`/clinic/invoices/${invoiceA.id}`, 'GET', undefined, a.cookie)).data.paidPaise,
    20000,
  );
  assert.equal(
    (
      await request(
        '/clinic/payments',
        'POST',
        { ...body, idempotencyKey: randomUUID(), amountPaise: 40000 },
        a.cookie,
      )
    ).status,
    409,
  );
});
test('patient reports and SaaS financial tables remain separate', async () => {
  const aa = (await request('/clinic/reports', 'GET', undefined, a.cookie)).data;
  const bb = (await request('/clinic/reports', 'GET', undefined, b.cookie)).data;
  assert.equal(aa.collectedPaise, 20000);
  assert.equal(bb.collectedPaise, 0);
  assert.equal(await db.subscriptionPayment.count({ where: { tenantId: a.tenantId } }), 0);
});
test('tenant document downloads cannot be guessed from another clinic', async () => {
  const form = new FormData();
  form.append('patientId', patientB.id);
  form.append(
    'file',
    new Blob([Buffer.from('%PDF-1.4\nTest clinic document')], { type: 'application/pdf' }),
    'xray.pdf',
  );
  const result = await request('/clinic/documents', 'POST', form, b.cookie);
  assert.equal(result.status, 201);
  documentB = result.data;
  assert.equal(documentB.storageKey, undefined);
  assert.equal(
    (await request(`/clinic/documents/${documentB.id}/download`, 'GET', undefined, a.cookie))
      .status,
    404,
  );
  assert.equal(
    (await request(`/clinic/documents/${documentB.id}/download`, 'GET', undefined, b.cookie))
      .status,
    200,
  );
});
test('platform administrators manage clinics without implicit clinical access', async () => {
  assert.equal((await request('/platform/tenants', 'GET', undefined, adminCookie)).status, 200);
  assert.equal((await request('/clinic/patients', 'GET', undefined, adminCookie)).status, 403);
  assert.equal((await request('/platform/tenants', 'GET', undefined, a.cookie)).status, 403);
});
test('suspension blocks protected operations but keeps owner support and billing', async () => {
  await request(
    `/platform/tenants/${a.tenantId}`,
    'PATCH',
    { status: 'SUSPENDED', reason: 'Integration check' },
    adminCookie,
  );
  assert.equal((await request('/clinic/patients', 'GET', undefined, a.cookie)).status, 402);
  assert.equal((await request('/subscription', 'GET', undefined, a.cookie)).status, 200);
  assert.equal(
    (
      await request(
        '/subscription/support',
        'POST',
        { subject: 'Access paused', message: 'Please review' },
        a.cookie,
      )
    ).status,
    201,
  );
  await request(
    `/platform/tenants/${a.tenantId}`,
    'PATCH',
    { status: 'ACTIVE', reason: 'Integration check complete' },
    adminCookie,
  );
});
test('verified captured-payment webhooks activate once even with different event IDs', async () => {
  const invoice = await db.subscriptionInvoice.create({
    data: {
      tenantId: a.tenantId,
      planId: plan.id,
      interval: 'MONTHLY',
      subtotalPaise: 99900,
      taxPaise: 0,
      totalPaise: 99900,
      providerOrderId: `order_${randomUUID()}`,
    },
  });
  const paymentId = `pay_${randomUUID()}`;
  const event = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: invoice.providerOrderId,
          status: 'captured',
          currency: 'INR',
          amount: 99900,
        },
      },
    },
  };
  async function webhook(payload: any, eventId: string, bad = false) {
    const raw = JSON.stringify(payload);
    const response = await fetch(root + '/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-event-id': eventId,
        'x-razorpay-signature': bad
          ? 'f'.repeat(64)
          : createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET!).update(raw).digest('hex'),
      },
      body: raw,
    });
    return { status: response.status, data: await response.json() };
  }
  assert.equal((await webhook(event, randomUUID(), true)).status, 400);
  const eventId = randomUUID();
  assert.equal((await webhook(event, eventId)).status, 200);
  const first = await db.subscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
  assert.equal(first.status, 'ACTIVE');
  assert.equal((await webhook(event, eventId)).data.duplicate, true);
  await webhook(event, randomUUID());
  const second = await db.subscription.findUniqueOrThrow({ where: { tenantId: a.tenantId } });
  assert.equal(first.endsAt.toISOString(), second.endsAt.toISOString());
  assert.equal(await db.subscriptionPayment.count({ where: { providerPaymentId: paymentId } }), 1);
  const refund = {
    event: 'refund.processed',
    payload: {
      refund: { entity: { id: `rfnd_${randomUUID()}`, payment_id: paymentId, amount: 10000 } },
    },
  };
  await webhook(refund, randomUUID());
  await webhook(refund, randomUUID());
  assert.equal(
    (await db.subscriptionPayment.findUniqueOrThrow({ where: { providerPaymentId: paymentId } }))
      .refundedPaise,
    10000,
  );
});
test('upgrades enable exports and downgrades retain records', async () => {
  const professional = await db.plan.findUniqueOrThrow({ where: { name: 'Professional' } });
  await request(
    `/platform/tenants/${a.tenantId}/subscription`,
    'POST',
    {
      planId: professional.id,
      status: 'ACTIVE',
      interval: 'MONTHLY',
      days: 30,
      reason: 'Upgrade test',
    },
    adminCookie,
  );
  const exported = await request('/clinic/export', 'GET', undefined, a.cookie);
  assert.equal(exported.status, 200);
  assert.deepEqual(
    exported.data.records.patient.map((p: any) => p.id),
    [patientA.id],
  );
  assert.equal(
    (await request(`/clinic/export?patientId=${patientB.id}`, 'GET', undefined, a.cookie)).status,
    404,
  );
  await request(
    `/platform/tenants/${a.tenantId}/subscription`,
    'POST',
    { planId: plan.id, status: 'ACTIVE', interval: 'MONTHLY', days: 30, reason: 'Downgrade test' },
    adminCookie,
  );
  assert.equal((await request('/clinic/doctors', 'GET', undefined, a.cookie)).data.length, 2);
  assert.equal((await request('/clinic/patients', 'GET', undefined, a.cookie)).data.length, 1);
});
test('request origin checks reject cross-site mutations', async () => {
  const response = await fetch(root + '/clinic/patients', {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.test',
      Cookie: a.cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: 'Attack', phone: '0000000000' }),
  });
  assert.equal(response.status, 403);
});
test('support access requires current patient-scoped consent and records every read', async () => {
  const admin = (await request('/auth/me', 'GET', undefined, adminCookie)).data;
  const granted = await request(
    '/subscription/support-grants',
    'POST',
    {
      adminUserId: admin.userId,
      patientId: patientA.id,
      reason: 'Investigate chart display',
      hours: 1,
      consent: true,
    },
    a.cookie,
  );
  assert.equal(granted.status, 200);
  assert.equal(
    (await request(`/platform/support-access/${granted.data.id}`, 'GET', undefined, adminCookie))
      .status,
    200,
  );
  assert.equal(
    await db.platformAudit.count({
      where: { action: 'AUTHORIZED_CLINICAL_SUPPORT_READ', tenantId: a.tenantId },
    }),
    1,
  );
  await request(`/subscription/support-grants/${granted.data.id}`, 'DELETE', undefined, a.cookie);
  assert.equal(
    (await request(`/platform/support-access/${granted.data.id}`, 'GET', undefined, adminCookie))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        '/subscription/support-grants',
        'POST',
        {
          adminUserId: admin.userId,
          patientId: patientB.id,
          reason: 'Cross tenant',
          hours: 1,
          consent: true,
        },
        a.cookie,
      )
    ).status,
    404,
  );
});
test('request idempotency keys prevent duplicate patient provisioning and reject changed bodies', async () => {
  const key = randomUUID();
  const body = { name: 'Idempotent patient', phone: '9000000099' };
  async function create(data: any) {
    const r = await fetch(root + '/clinic/patients', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Cookie: b.cookie,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(data),
    });
    return { status: r.status, data: await r.json() };
  }
  const [one, two] = await Promise.all([create(body), create(body)]);
  assert.equal(one.status, 201);
  assert.equal(one.data.id, two.data.id);
  assert.equal((await create({ ...body, name: 'Changed' })).status, 409);
});
test('expiry uses paid grace and trials have no paid grace', async () => {
  await db.subscription.update({
    where: { tenantId: a.tenantId },
    data: { status: 'ACTIVE', endsAt: new Date(Date.now() - 86400000), cancelAtPeriodEnd: false },
  });
  assert.equal((await request('/clinic/patients', 'GET', undefined, a.cookie)).status, 200);
  await db.subscription.update({ where: { tenantId: a.tenantId }, data: { status: 'TRIAL' } });
  assert.equal((await request('/clinic/patients', 'GET', undefined, a.cookie)).status, 402);
  assert.equal((await request('/subscription', 'GET', undefined, a.cookie)).status, 200);
  await db.subscription.update({
    where: { tenantId: a.tenantId },
    data: { status: 'ACTIVE', endsAt: new Date(Date.now() + 86400000) },
  });
});
test('server-side reconciliation settles only matching captured provider payments', async () => {
  const { reconcilePayments } = await import('../server/reconcile.js');
  process.env.RAZORPAY_KEY_ID = 'test-key';
  process.env.RAZORPAY_KEY_SECRET = 'test-secret';
  const invoice = await db.subscriptionInvoice.create({
    data: {
      tenantId: b.tenantId,
      planId: plan.id,
      interval: 'MONTHLY',
      subtotalPaise: 99900,
      taxPaise: 0,
      totalPaise: 99900,
      providerOrderId: `order_${randomUUID()}`,
    },
  });
  const payment = {
    id: `pay_${randomUUID()}`,
    order_id: invoice.providerOrderId,
    status: 'captured',
    currency: 'INR',
    amount: 99900,
  };
  const fakeFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ items: [payment] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  const result = await reconcilePayments(invoice.id, fakeFetch);
  assert.equal(result.settled, 1);
  assert.equal(
    (await db.subscriptionInvoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
    'PAID',
  );
  const second = await reconcilePayments(invoice.id, fakeFetch);
  assert.equal(second.scanned, 0);
  const wrong = await db.subscriptionInvoice.create({
    data: {
      tenantId: b.tenantId,
      planId: plan.id,
      interval: 'MONTHLY',
      subtotalPaise: 99900,
      taxPaise: 0,
      totalPaise: 99900,
      providerOrderId: `order_${randomUUID()}`,
    },
  });
  const invalid = await reconcilePayments(wrong.id, fakeFetch);
  assert.equal(invalid.settled, 0);
  assert.deepEqual(invalid.failedInvoiceIds, [wrong.id]);
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

test('shared rate counters apply across concurrent requests and cron rejects missing secrets', async () => {
  const bucket = `test:${randomUUID()}`;
  const { sharedRateLimit } = await import('../server/rate-limit.js');
  const limiter = sharedRateLimit(bucket, 60000, 2);
  const statuses = await Promise.all([1,2,3,4,5].map(() => new Promise<number>((resolve, reject) => {
    const res: any = { setHeader() {}, status(code: number) { this.code = code; return this; }, json() { resolve(this.code); } };
    limiter({ ip: '192.0.2.1', socket: {} } as any, res, (error?: any) => error ? reject(error) : resolve(200));
  })));
  assert.equal(statuses.filter(code => code === 200).length, 2);
  assert.equal(statuses.filter(code => code === 429).length, 3);
  assert.equal((await request('/cron/jobs')).status, 401);
  const counters: any = await db.rateBucket.findMany({ where: { id: { startsWith: bucket } } });
  assert.equal(counters[0].count, 5);
  assert(counters[0].expiresAt instanceof Date);
});

test('MongoDB optional provider identities allow multiple pending invoices and events', async () => {
  const [first, second] = await Promise.all([1,2].map(() => db.subscriptionInvoice.create({ data: { tenantId: a.tenantId, planId: plan.id, interval: 'MONTHLY', subtotalPaise: 100, taxPaise: 0, totalPaise: 100 } })));
  assert.notEqual(first.providerOrderId, second.providerOrderId);
  const events = await Promise.all([1,2].map(() => db.subscriptionEvent.create({ data: { kind: 'TEST_INTERNAL' } })));
  assert.notEqual(events[0].providerEventId, events[1].providerEventId);
});

test('Vercel document storage refuses an ephemeral filesystem fallback', async () => {
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const form = new FormData();
    form.append('patientId', patientB.id);
    form.append('file', new Blob(['%PDF-1.7 synthetic']), 'synthetic.pdf');
    const result = await request('/clinic/documents', 'POST', form, b.cookie);
    assert.equal(result.status, 503, JSON.stringify(result.data));
    assert.match(result.data.error, /private storage|S3_BUCKET/);
  } finally { if (previous === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous; }
});

test('cron respects an active persisted lease and processes a bounded clinic page', async () => {
  const { runJobs } = await import('../server/jobs.js');
  await db.cronState.upsert({ where: { id: 'jobs' }, create: { id: 'jobs', leaseExpiresAt: new Date(Date.now() + 60000) }, update: { leaseExpiresAt: new Date(Date.now() + 60000) } });
  assert.deepEqual(await runJobs(), { skipped: true });
  await db.cronState.update({ where: { id: 'jobs' }, data: { leaseExpiresAt: new Date(0) } });
  const oldKey = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  try {
    const result = await runJobs();
    assert(typeof result.processed === 'number' && result.processed <= 10);
    const state = await db.cronState.findUniqueOrThrow({ where: { id: 'jobs' } });
    assert.equal(state.leaseExpiresAt.getTime(), 0);
  } finally { if (oldKey) process.env.RAZORPAY_KEY_ID = oldKey; }
});

test('health checks do not depend on the shared rate counter', async () => {
  const previous = db.rateBucket.upsert;
  (db.rateBucket as any).upsert = async () => { throw new Error('Synthetic counter failure'); };
  try {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
  } finally { (db.rateBucket as any).upsert = previous; }
});
