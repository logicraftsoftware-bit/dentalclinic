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
  assert.equal(signup.data.developmentToken, undefined);
  assert.equal(await db.authToken.count({ where: { purpose: 'VERIFY', user: { email } } }), 0);
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
  await assert.rejects(
    transaction(async (tx) => {
      await lock(tx, a.tenantId);
      const store = new TenantStore(tx, a.tenantId);
      await store.create('invoice', {
        patientId: patientB.id,
        description: 'Invalid',
        totalPaise: 100,
      });
    }),
    /Record not found/,
  );
  await transaction(async (tx) => {
    const store = new TenantStore(tx, a.tenantId);
    assert.equal(
      (await store.list('patient', { tenantId: b.tenantId })).every(
        (row: any) => row.tenantId === a.tenantId,
      ),
      true,
    );
    await assert.rejects(store.get('patient', patientB.id), /Record not found/);
    await assert.rejects(
      store.update('patient', patientA.id, { name: { set: 'Nested write' } }),
      /Nested writes/,
    );
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
  const statuses = await Promise.all(
    [1, 2, 3, 4, 5].map(
      () =>
        new Promise<number>((resolve, reject) => {
          const res: any = {
            setHeader() {},
            status(code: number) {
              this.code = code;
              return this;
            },
            json() {
              resolve(this.code);
            },
          };
          limiter({ ip: '192.0.2.1', socket: {} } as any, res, (error?: any) =>
            error ? reject(error) : resolve(200),
          );
        }),
    ),
  );
  assert.equal(statuses.filter((code) => code === 200).length, 2);
  assert.equal(statuses.filter((code) => code === 429).length, 3);
  assert.equal((await request('/cron/jobs')).status, 401);
  const counters: any = await db.rateBucket.findMany({ where: { id: { startsWith: bucket } } });
  assert.equal(counters[0].count, 5);
  assert(counters[0].expiresAt instanceof Date);
});

test('MongoDB optional provider identities allow multiple pending invoices and events', async () => {
  const [first, second] = await Promise.all(
    [1, 2].map(() =>
      db.subscriptionInvoice.create({
        data: {
          tenantId: a.tenantId,
          planId: plan.id,
          interval: 'MONTHLY',
          subtotalPaise: 100,
          taxPaise: 0,
          totalPaise: 100,
        },
      }),
    ),
  );
  assert.notEqual(first.providerOrderId, second.providerOrderId);
  const events = await Promise.all(
    [1, 2].map(() => db.subscriptionEvent.create({ data: { kind: 'TEST_INTERNAL' } })),
  );
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
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test('cron respects an active persisted lease and processes a bounded clinic page', async () => {
  const { runJobs } = await import('../server/jobs.js');
  await db.cronState.upsert({
    where: { id: 'jobs' },
    create: { id: 'jobs', leaseExpiresAt: new Date(Date.now() + 60000) },
    update: { leaseExpiresAt: new Date(Date.now() + 60000) },
  });
  assert.deepEqual(await runJobs(), { skipped: true });
  await db.cronState.update({ where: { id: 'jobs' }, data: { leaseExpiresAt: new Date(0) } });
  const oldKey = process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_ID;
  try {
    const result = await runJobs();
    assert(typeof result.processed === 'number' && result.processed <= 10);
    const state = await db.cronState.findUniqueOrThrow({ where: { id: 'jobs' } });
    assert.equal(state.leaseExpiresAt.getTime(), 0);
  } finally {
    if (oldKey) process.env.RAZORPAY_KEY_ID = oldKey;
  }
});

test('health checks do not depend on the shared rate counter', async () => {
  const previous = db.rateBucket.upsert;
  (db.rateBucket as any).upsert = async () => {
    throw new Error('Synthetic counter failure');
  };
  try {
    const health = await request('/health');
    assert.equal(health.status, 200);
    assert.equal(health.data.status, 'ok');
  } finally {
    (db.rateBucket as any).upsert = previous;
  }
});

test('staff accounts sign in and use their membership without email verification or SMTP', async () => {
  const email = `staff-${randomUUID()}@example.test`;
  const created = await request(
    '/clinic/staff',
    'POST',
    { name: 'New receptionist', email, role: 'RECEPTIONIST', password },
    a.cookie,
  );
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.developmentToken, undefined);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  assert.equal(user.verified, false);
  assert.equal(await db.authToken.count({ where: { userId: user.id, purpose: 'VERIFY' } }), 0);
  const login = await request('/auth/login', 'POST', { email, password });
  assert.equal(login.status, 200);
  assert.equal((await request('/auth/me', 'GET', undefined, login.cookie)).status, 200);
  assert.equal((await request('/clinic/patients', 'GET', undefined, login.cookie)).status, 200);
});

test('team deletion protects owners and linked branches and revokes removed staff sessions', async () => {
  const branch = await db.branch.create({ data: { tenantId: a.tenantId, name: 'Deletion test branch' } });
  const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, name: 'Removed staff', passwordHash: await bcrypt.hash(password, 12) } });
  const membership = await db.membership.create({ data: { tenantId: a.tenantId, userId: user.id, branchId: branch.id, role: 'RECEPTIONIST' } });
  const login = await request('/auth/login', 'POST', { email: user.email, password });
  assert.equal(login.status, 200);
  assert.equal((await request(`/clinic/branches/${branch.id}`, 'DELETE', undefined, a.cookie)).status, 409);
  assert.equal((await request(`/clinic/branches/${branch.id}`, 'DELETE', undefined, b.cookie)).status, 404);
  const owner = await db.membership.findFirstOrThrow({ where: { tenantId: a.tenantId, role: 'OWNER' } });
  assert.equal((await request(`/clinic/staff/${owner.id}`, 'DELETE', undefined, a.cookie)).status, 403);
  assert.equal((await request(`/clinic/staff/${membership.id}`, 'DELETE', undefined, b.cookie)).status, 404);
  assert.equal((await request(`/clinic/staff/${membership.id}`, 'DELETE', undefined, a.cookie)).status, 200);
  assert.equal(await db.membership.findUnique({ where: { id: membership.id } }), null);
  assert.ok(await db.user.findUnique({ where: { id: user.id } }));
  assert.equal((await request('/clinic/patients', 'GET', undefined, login.cookie)).status, 401);
  assert.equal((await request(`/clinic/branches/${branch.id}`, 'DELETE', undefined, a.cookie)).status, 200);
  assert.equal(await db.branch.findUnique({ where: { id: branch.id } }), null);
});

test('doctors support both fees and selected branches without crossing clinic or staff scope', async () => {
  const clinic = await register('Multi branch doctors');
  await db.subscription.update({ where: { tenantId: clinic.tenantId }, data: { overrides: { branches: null, staff: null } } });
  const create = async (resource: string, body: any) => {
    const response = await request(`/clinic/${resource}`, 'POST', body, clinic.cookie);
    assert.equal(response.status, 201, JSON.stringify(response.data));
    return response.data;
  };
  const first = await create('branches', { name: 'First' });
  const second = await create('branches', { name: 'Second' });
  const third = await create('branches', { name: 'Not selected' });
  const doctor = await create('doctors', { name: 'Shared doctor', branchIds: [first.id, second.id], qualification: 'MDS' });
  assert.deepEqual(doctor.branchIds, [first.id, second.id]);
  assert.equal(doctor.consultationPaise, 30000);
  assert.equal(doctor.visitingConsultationPaise, 100000);
  assert.equal(doctor.commissionPercent, 40);
  assert.equal(doctor.qualification, 'MDS');
  for (const [i, branch] of [first, second].entries()) {
    const patient = await create('patients', { name: `Branch patient ${i}`, phone: '9000000090', branchId: branch.id, doctorId: doctor.id });
    await create('appointments', { patientId: patient.id, doctorId: doctor.id, branchId: branch.id, startsAt: new Date(Date.now() + (i + 1) * 86400000).toISOString() });
  }
  const patient = await create('patients', { name: 'Other patient', phone: '9000000091', branchId: third.id });
  assert.equal((await request('/clinic/appointments', 'POST', { patientId: patient.id, doctorId: doctor.id, branchId: third.id, startsAt: new Date(Date.now() + 4 * 86400000).toISOString() }, clinic.cookie)).status, 409);
  assert.equal((await request(`/clinic/branches/${second.id}`, 'DELETE', undefined, clinic.cookie)).status, 409);
  const foreign = await db.branch.findFirstOrThrow({ where: { tenantId: b.tenantId } });
  assert.equal((await request(`/clinic/doctors/${doctor.id}`, 'PATCH', { branchIds: [first.id, foreign.id] }, clinic.cookie)).status, 404);
  const email = `${randomUUID()}@example.test`;
  await create('staff', { name: 'Second branch admin', email, password, role: 'BRANCH_ADMIN', branchId: second.id });
  const login = await request('/auth/login', 'POST', { email, password });
  const visible = await request('/clinic/doctors', 'GET', undefined, login.cookie);
  assert.equal(visible.status, 200);
  assert.ok(visible.data.some((row: any) => row.id === doctor.id));
  assert.equal((await request('/clinic/doctors', 'POST', { name: 'Unauthorized assignment', branchIds: [first.id, second.id] }, login.cookie)).status, 404);
  const doctorEmail = `${randomUUID()}@example.test`;
  await create('staff', { name: 'Shared doctor login', email: doctorEmail, password, role: 'DOCTOR', branchId: second.id, doctorId: doctor.id });
  const doctorLogin = await request('/auth/login', 'POST', { email: doctorEmail, password });
  assert.equal((await request('/clinic/workspace', 'GET', undefined, doctorLogin.cookie)).status, 200);
  const fees = await request(`/clinic/doctors/${doctor.id}`, 'PATCH', { consultationPaise: 35000, visitingConsultationPaise: 110000, commissionPercent: 45 }, clinic.cookie);
  assert.equal(fees.status, 200);
  assert.deepEqual(fees.data.branchIds, [first.id, second.id]);
  assert.equal(fees.data.visitingConsultationPaise, 110000);
});

let masterSpeciality: any, masterGroup: any, masterCharge: any;
test('masters create on a clinic, normalize names and reject duplicate or invalid amounts', async () => {
  const speciality = await request(
    '/clinic/specialities',
    'POST',
    { name: '  Orthodontics  ' },
    a.cookie,
  );
  assert.equal(speciality.status, 201, JSON.stringify(speciality.data));
  masterSpeciality = speciality.data;
  assert.equal(masterSpeciality.name, 'Orthodontics');
  assert.equal(
    (await request('/clinic/specialities', 'POST', { name: 'orthodontics' }, a.cookie)).status,
    409,
  );
  const group = await request(
    '/clinic/charge-groups',
    'POST',
    { name: 'Laboratory services' },
    a.cookie,
  );
  assert.equal(group.status, 201, JSON.stringify(group.data));
  masterGroup = group.data;
  const lockBeforeReads = await db.transactionLock.findUniqueOrThrow({ where: { id: a.tenantId } });
  const masterReads = await Promise.all(
    Array.from({ length: 4 }, () => ['specialities', 'charge-groups', 'charges']).flat()
      .map((resource) => request(`/clinic/${resource}`, 'GET', undefined, a.cookie)),
  );
  for (const response of masterReads) assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.ok(masterReads[1].data.some((row: any) => row.id === masterGroup.id));
  const lockAfterReads = await db.transactionLock.findUniqueOrThrow({ where: { id: a.tenantId } });
  assert.equal(lockAfterReads.revision, lockBeforeReads.revision, 'Master reads must not write the clinic lock');
  const charge = await request(
    '/clinic/charges',
    'POST',
    {
      chargeGroupId: masterGroup.id,
      name: 'Ceramic crown',
      pricePaise: 250075,
      labChargePaise: 50025,
    },
    a.cookie,
  );
  assert.equal(charge.status, 201, JSON.stringify(charge.data));
  masterCharge = charge.data;
  assert.equal(masterCharge.pricePaise, 250075);
  assert.equal(masterCharge.labChargePaise, 50025);
  assert.equal(
    (
      await request(
        '/clinic/charges',
        'POST',
        { chargeGroupId: masterGroup.id, name: 'ceramic crown', pricePaise: 1, labChargePaise: 0 },
        a.cookie,
      )
    ).status,
    409,
  );
  for (const invalid of [{ pricePaise: -1 }, { labChargePaise: -1 }, { pricePaise: 1.5 }]) {
    assert.equal(
      (
        await request(
          '/clinic/charges',
          'POST',
          {
            chargeGroupId: masterGroup.id,
            name: 'Invalid amount',
            pricePaise: 100,
            labChargePaise: 0,
            ...invalid,
          },
          a.cookie,
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (await request('/clinic/charges', 'GET', undefined, a.cookie)).data.some(
      (row: any) => row.id === masterCharge.id,
    ),
    true,
  );
});

test('master references and mutations remain tenant scoped and staff cannot manage them', async () => {
  for (const [resource, row] of [
    ['specialities', masterSpeciality],
    ['charge-groups', masterGroup],
    ['charges', masterCharge],
  ] as const) {
    assert.equal(
      (await request(`/clinic/${resource}/${row.id}`, 'GET', undefined, b.cookie)).status,
      404,
    );
    assert.equal(
      (await request(`/clinic/${resource}/${row.id}`, 'PATCH', { name: 'Foreign edit' }, b.cookie))
        .status,
      404,
    );
    assert.equal(
      (await request(`/clinic/${resource}`, 'GET', undefined, b.cookie)).data.some(
        (item: any) => item.id === row.id,
      ),
      false,
    );
  }
  assert.equal(
    (
      await request(
        '/clinic/charges',
        'POST',
        { chargeGroupId: masterGroup.id, name: 'Foreign group', pricePaise: 100 },
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await request(
        '/clinic/doctors',
        'POST',
        { name: 'Foreign speciality', specialityId: masterSpeciality.id },
        b.cookie,
      )
    ).status,
    404,
  );
  const member = await db.membership.findFirstOrThrow({
    where: { tenantId: a.tenantId, role: 'RECEPTIONIST' },
    include: { user: true },
  });
  const cookie = (await request('/auth/login', 'POST', { email: member.user.email, password }))
    .cookie;
  assert.equal((await request('/clinic/charges', 'GET', undefined, cookie)).status, 200);
  assert.equal(
    (await request('/clinic/specialities', 'POST', { name: 'Unauthorized master' }, cookie)).status,
    403,
  );
  assert.equal(
    (await request(`/clinic/charges/${masterCharge.id}`, 'PATCH', { active: false }, cookie))
      .status,
    403,
  );
});

test('master edits, dependencies and deactivation preserve treatment price and lab snapshots', async () => {
  assert.equal(
    (
      await request(
        `/clinic/doctors/${doctorA.id}`,
        'PATCH',
        { specialityId: masterSpeciality.id },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        `/clinic/specialities/${masterSpeciality.id}`,
        'PATCH',
        { active: false },
        a.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/clinic/specialities/${masterSpeciality.id}`,
        'PATCH',
        { name: 'Orthodontic care' },
        a.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request(`/clinic/charge-groups/${masterGroup.id}`, 'PATCH', { active: false }, a.cookie))
      .status,
    409,
  );
  const plan = (
    await request(
      '/clinic/plans',
      'POST',
      { patientId: patientA.id, title: 'Master charge snapshots' },
      a.cookie,
    )
  ).data;
  const item = await request(
    '/clinic/items',
    'POST',
    {
      planId: plan.id,
      tooth: '26',
      name: masterCharge.name,
      pricePaise: masterCharge.pricePaise,
      labChargePaise: masterCharge.labChargePaise,
      catalogItemId: masterCharge.id,
      plannedSessions: 1,
    },
    a.cookie,
  );
  assert.equal(item.status, 201, JSON.stringify(item.data));
  assert.equal(
    (
      await request(
        `/clinic/charges/${masterCharge.id}`,
        'PATCH',
        { name: 'Updated ceramic crown', pricePaise: 999900, labChargePaise: 123400 },
        a.cookie,
      )
    ).status,
    200,
  );
  const saved = (await request(`/clinic/items/${item.data.id}`, 'GET', undefined, a.cookie)).data;
  assert.equal(saved.name, 'Ceramic crown');
  assert.equal(saved.pricePaise, 250075);
  assert.equal(saved.labChargePaise, 50025);
  assert.equal(
    (await request(`/clinic/charges/${masterCharge.id}`, 'PATCH', { active: false }, a.cookie))
      .status,
    200,
  );
  assert.equal(
    (await request(`/clinic/charge-groups/${masterGroup.id}`, 'PATCH', { active: false }, a.cookie))
      .status,
    200,
  );
  assert.equal(
    (await request(`/clinic/charges/${masterCharge.id}`, 'PATCH', { active: true }, a.cookie))
      .status,
    409,
  );
  assert.equal(
    (await request('/clinic/charges?active=true', 'GET', undefined, a.cookie)).data.some(
      (row: any) => row.id === masterCharge.id,
    ),
    false,
  );
  assert.equal(
    (
      await request(
        '/clinic/items',
        'POST',
        {
          planId: plan.id,
          tooth: '27',
          name: 'Inactive charge',
          catalogItemId: masterCharge.id,
          pricePaise: 100,
        },
        a.cookie,
      )
    ).status,
    409,
  );
  assert.equal(
    (await request(`/clinic/charge-groups/${masterGroup.id}`, 'PATCH', { active: true }, a.cookie))
      .status,
    200,
  );
  assert.equal(
    (await request(`/clinic/charges/${masterCharge.id}`, 'PATCH', { active: true }, a.cookie))
      .status,
    200,
  );
});

test('branch admins delegate staff safely and branch/doctor panels isolate records', async () => {
  const c = await register('Branch permissions clinic');
  const enterprise = await db.plan.findUniqueOrThrow({ where: { name: 'Enterprise' } });
  await db.subscription.update({
    where: { tenantId: c.tenantId },
    data: { planId: enterprise.id },
  });
  async function create(path: string, body: any, cookie = c.cookie) {
    const result = await request('/clinic/' + path, 'POST', body, cookie);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    return result.data;
  }
  const north = await create('branches', { name: 'North branch' });
  const south = await create('branches', { name: 'South branch' });
  const d1 = await create('doctors', { name: 'North doctor', branchId: north.id });
  const d2 = await create('doctors', { name: 'South doctor', branchId: south.id });
  const northPatient = await create('patients', {
    name: 'North patient',
    phone: '9000000031',
    branchId: north.id,
    doctorId: d1.id,
  });
  const southPatient = await create('patients', {
    name: 'South patient',
    phone: '9000000032',
    branchId: south.id,
    doctorId: d2.id,
  });
  const unassigned = await create('patients', { name: 'Legacy unassigned', phone: '9000000033' });
  const northPlan = await create('plans', { patientId: northPatient.id, title: 'North treatment' });
  const southPlan = await create('plans', { patientId: southPatient.id, title: 'South treatment' });
  const southInvoice = await create('invoices', {
    patientId: southPatient.id,
    description: 'South invoice',
    totalPaise: 10000,
  });
  async function staff(role: string, branchId: string, doctorId?: string, cookie = c.cookie) {
    const email = `${randomUUID()}@example.test`;
    const membership = await create(
      'staff',
      { name: role, email, password, role, branchId, ...(doctorId ? { doctorId } : {}) },
      cookie,
    );
    const login = await request('/auth/login', 'POST', { email, password });
    assert.equal(login.status, 200);
    return { cookie: login.cookie, membership, email };
  }
  assert.equal(
    (
      await request(
        '/clinic/staff',
        'POST',
        {
          name: 'Missing branch',
          email: `${randomUUID()}@example.test`,
          password,
          role: 'BRANCH_ADMIN',
        },
        c.cookie,
      )
    ).status,
    400,
  );
  const admin = await staff('BRANCH_ADMIN', north.id);
  const receptionist = await staff('RECEPTIONIST', north.id, undefined, admin.cookie);
  const doctor = await staff('DOCTOR', north.id, d1.id, admin.cookie);
  const workspace = await request('/clinic/workspace', 'GET', undefined, admin.cookie);
  assert.equal(workspace.data.role, 'BRANCH_ADMIN');
  assert.equal(workspace.data.branchId, north.id);
  assert.equal(workspace.data.capabilities.includes('staff'), true);
  assert.equal(workspace.data.capabilities.includes('settings'), false);
  for (const cookie of [admin.cookie, receptionist.cookie, doctor.cookie]) {
    const patients = await request('/clinic/patients', 'GET', undefined, cookie);
    assert.deepEqual(
      patients.data.map((p: any) => p.id),
      [northPatient.id],
    );
    for (const hidden of [southPatient, unassigned]) {
      assert.equal(
        (await request(`/clinic/patients/${hidden.id}`, 'GET', undefined, cookie)).status,
        404,
      );
      assert.equal(
        (await request(`/clinic/patients/${hidden.id}`, 'PATCH', { name: 'Forbidden' }, cookie))
          .status,
        404,
      );
    }
    assert.equal(
      (await request('/clinic/settings', 'PATCH', { name: 'Hijack' }, cookie)).status,
      403,
    );
    assert.equal((await request('/clinic/export', 'GET', undefined, cookie)).status, 403);
    assert.equal(
      (
        await request(
          '/clinic/appointments',
          'POST',
          {
            patientId: southPatient.id,
            doctorId: d1.id,
            branchId: north.id,
            startsAt: '2031-01-01T10:00:00Z',
          },
          cookie,
        )
      ).status,
      404,
    );
  }
  assert.equal(
    (await request(`/clinic/plans/${southPlan.id}`, 'GET', undefined, doctor.cookie)).status,
    404,
  );
  assert.equal(
    (await request(`/clinic/plans/${northPlan.id}`, 'GET', undefined, doctor.cookie)).status,
    200,
  );
  assert.equal(
    (await request(`/clinic/invoices/${southInvoice.id}`, 'GET', undefined, admin.cookie)).status,
    404,
  );
  assert.equal((await request('/clinic/invoices', 'GET', undefined, doctor.cookie)).status, 403);
  assert.equal(
    (
      await request(
        '/clinic/notes',
        'POST',
        { patientId: northPatient.id, complaint: 'Reception cannot write clinical notes' },
        receptionist.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        '/clinic/staff',
        'POST',
        { name: 'Escalation', email: `${randomUUID()}@example.test`, password, role: 'MANAGER' },
        admin.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/clinic/staff/${receptionist.membership.id}`,
        'PATCH',
        { role: 'BRANCH_ADMIN' },
        admin.cookie,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/clinic/staff/${receptionist.membership.id}`,
        'PATCH',
        { branchId: south.id },
        admin.cookie,
      )
    ).status,
    403,
  );
  assert.equal((await request('/clinic/staff', 'GET', undefined, receptionist.cookie)).status, 403);
  assert.equal(
    (
      await request(
        '/clinic/staff',
        'POST',
        {
          name: 'Foreign doctor',
          email: `${randomUUID()}@example.test`,
          password,
          role: 'DOCTOR',
          branchId: north.id,
          doctorId: d2.id,
        },
        admin.cookie,
      )
    ).status,
    404,
  );
  const auto = await create(
    'patients',
    { name: 'Reception new patient', phone: '9000000034' },
    receptionist.cookie,
  );
  assert.equal(auto.branchId, north.id);
  assert.equal(
    (await request(`/clinic/patients/${auto.id}`, 'GET', undefined, doctor.cookie)).status,
    404,
  );
  const appointment = await create(
    'appointments',
    { patientId: auto.id, doctorId: d1.id, startsAt: '2031-01-01T12:00:00Z' },
    receptionist.cookie,
  );
  assert.equal(appointment.branchId, north.id);
  assert.equal(
    (await request(`/clinic/patients/${auto.id}`, 'GET', undefined, doctor.cookie)).status,
    200,
  );
  const coveringDoctor = await create('doctors', {
    name: 'Covering North doctor',
    branchId: north.id,
  });
  const item = await create('items', {
    planId: northPlan.id,
    tooth: '26',
    name: 'Shared care session',
    pricePaise: 10000,
    plannedSessions: 1,
  });
  assert.equal(
    (await request(`/clinic/plans/${northPlan.id}`, 'PATCH', { status: 'ACCEPTED' }, c.cookie))
      .status,
    200,
  );
  await create('sessions', {
    itemId: item.id,
    doctorId: coveringDoctor.id,
    notes: 'Completed by covering clinician',
    feePaise: 10000,
  });
  assert.equal(
    (
      await request(
        '/clinic/sessions',
        'POST',
        {
          itemId: item.id,
          doctorId: d1.id,
          notes: 'Cannot exceed shared treatment sessions',
          feePaise: 10000,
        },
        doctor.cookie,
      )
    ).status,
    409,
  );
  const assigned = await request(
    `/clinic/patients/${unassigned.id}`,
    'PATCH',
    { doctorId: d1.id },
    c.cookie,
  );
  assert.equal(assigned.status, 200);
  assert.equal(assigned.data.branchId, north.id);
  assert.equal(
    (await request(`/clinic/patients/${unassigned.id}`, 'GET', undefined, doctor.cookie)).status,
    200,
  );
  const floating = await create('doctors', { name: 'Initially unassigned clinician' });
  const floatingEmail = `${randomUUID()}@example.test`;
  await create('staff', {
    name: 'Floating doctor',
    email: floatingEmail,
    password,
    role: 'DOCTOR',
    doctorId: floating.id,
  });
  const floatingLogin = await request('/auth/login', 'POST', { email: floatingEmail, password });
  assert.equal(
    (await request('/clinic/workspace', 'GET', undefined, floatingLogin.cookie)).status,
    200,
  );
  assert.equal(
    (await request(`/clinic/doctors/${floating.id}`, 'PATCH', { branchId: north.id }, c.cookie))
      .status,
    200,
  );
  assert.equal(
    (await request('/clinic/workspace', 'GET', undefined, floatingLogin.cookie)).status,
    403,
  );
  const staffRows = (await request('/clinic/staff', 'GET', undefined, admin.cookie)).data;
  assert.equal(
    staffRows.every(
      (s: any) => s.branchId === north.id && ['DOCTOR', 'RECEPTIONIST'].includes(s.role),
    ),
    true,
  );
  assert.equal(
    (
      await request(
        `/clinic/staff/${receptionist.membership.id}`,
        'PATCH',
        { active: false },
        admin.cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (await request('/clinic/patients', 'GET', undefined, receptionist.cookie)).status,
    401,
  );
});

test('appointments snapshot doctor fees, optional clinic fee and notes', async () => {
  const clinic = await register('Appointment fees clinic');
  const patient = (await request('/clinic/patients', 'POST', { name: 'Fee patient', phone: '9000012345' }, clinic.cookie)).data;
  const doctor = (await request('/clinic/doctors', 'POST', {
    name: 'Appointment fee doctor', consultationPaise: 45000, visitingConsultationPaise: 90000,
  }, clinic.cookie)).data;
  for (const useClinicFee of [false, true]) {
    const result = await request('/clinic/appointments', 'POST', {
      patientId: patient.id, doctorId: doctor.id,
      startsAt: new Date(Date.now() + (useClinicFee ? 12 : 11) * 86400000).toISOString(),
      useClinicFee, notes: 'Patient requested a morning visit.',
    }, clinic.cookie);
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.consultationPaise, 45000);
    assert.equal(result.data.visitingConsultationPaise, 90000);
    assert.equal(result.data.clinicFeePaise, useClinicFee ? 30000 : 0);
    assert.equal(result.data.notes, 'Patient requested a morning visit.');
  }
  const results = await request(`/clinic/patients?q=${encodeURIComponent(patient.phone)}`, 'GET', undefined, clinic.cookie);
  assert.equal(results.status, 200);
  assert.ok(results.data.some((p: any) => p.id === patient.id));
});

test('ordinary clinic reads do not acquire or modify the clinic write lock', async () => {
  const clinic = await register('Concurrent reads clinic');
  assert.equal((await request('/clinic/patients', 'POST', { name: 'Initial patient', phone: '9000023455' }, clinic.cookie)).status, 201);
  const before = await db.transactionLock.findUniqueOrThrow({ where: { id: clinic.tenantId } });
  const responses = await Promise.all(['/clinic/patients', '/clinic/doctors', '/clinic/appointments', '/clinic/workspace', '/clinic/overview'].map(path => request(path, 'GET', undefined, clinic.cookie)));
  for (const response of responses) assert.equal(response.status, 200, JSON.stringify(response.data));
  const after = await db.transactionLock.findUniqueOrThrow({ where: { id: clinic.tenantId } });
  assert.equal(after.revision, before.revision);
  const created = await request('/clinic/patients', 'POST', { name: 'Locked write', phone: '9000023456' }, clinic.cookie);
  assert.equal(created.status, 201);
  const written = await db.transactionLock.findUniqueOrThrow({ where: { id: clinic.tenantId } });
  assert.ok(written.revision > after.revision);
});

test('calendar returns all scoped visits beyond 500 and respects clinic day boundaries', async () => {
  const clinic = await register('Calendar clinic');
  const patient = (await request('/clinic/patients', 'POST', { name: 'Calendar patient', phone: '9000034567' }, clinic.cookie)).data;
  const doctor = (await request('/clinic/doctors', 'POST', { name: 'Calendar doctor', specialty: 'Dental' }, clinic.cookie)).data;
  const base = { tenantId: clinic.tenantId, patientId: patient.id, doctorId: doctor.id };
  await db.appointment.createMany({ data: [
    ...Array.from({ length: 505 }, () => ({ ...base, startsAt: new Date('2026-10-08T04:30:00Z') })),
    { ...base, startsAt: new Date('2026-10-07T18:30:00Z') },
    { ...base, startsAt: new Date('2026-10-07T18:29:59Z') },
    { ...base, startsAt: new Date('2026-10-08T18:30:00Z') },
  ] });
  const url = '/clinic/appointment-calendar?from=2026-10-08&to=2026-10-09';
  const response = await request(url, 'GET', undefined, clinic.cookie);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  assert.equal(response.data.appointments.length, 506);
  assert.ok(response.data.appointments.every((row: any) => row.date === '2026-10-08' && row.patientName === patient.name && row.patientPhone === patient.phone));
  assert.equal(response.data.doctors[0].name, doctor.name);
  const foreign = await request(url, 'GET', undefined, b.cookie);
  assert.ok(foreign.data.appointments.every((row: any) => row.tenantId !== clinic.tenantId));
  const appointment = response.data.appointments[0];
  const updated = await request(`/clinic/appointments/${appointment.id}`, 'PATCH', { status: 'ABSENT', paymentStatus: 'PARTIAL' }, clinic.cookie);
  assert.equal(updated.status, 200);
  assert.equal(updated.data.status, 'ABSENT');
  assert.equal(updated.data.paymentStatus, 'PARTIAL');
  assert.equal((await request(`/clinic/appointments/${appointment.id}`, 'PATCH', { paymentStatus: 'PAID' }, b.cookie)).status, 404);
  for (const query of ['from=2026-02-30&to=2026-03-02', 'from=2026-01-01&to=2026-12-31', 'from=2026-10-09&to=2026-10-08'])
    assert.equal((await request('/clinic/appointment-calendar?' + query, 'GET', undefined, clinic.cookie)).status, 400);
});

test('doctor treatment closes into reception billing and a cross-branch internal referral preserves history', async () => {
  const testDatabase = new URL(process.env.DATABASE_URL || 'mongodb://invalid/');
  if (testDatabase.hostname === '127.0.0.1' && testDatabase.pathname === '/dentaflow_test') await db.rateBucket.deleteMany();
  const clinic = await register('Dental referral clinic');
  await db.subscription.update({ where: { tenantId: clinic.tenantId }, data: { overrides: { staff: null, branches: null, doctors: null } } });
  const create = async (resource: string, body: any) => { const r=await request(`/clinic/${resource}`,'POST',body,clinic.cookie); assert.equal(r.status,201,JSON.stringify(r.data)); return r.data; };
  const north=await create('branches',{name:'Dental north'}), south=await create('branches',{name:'Dental south'});
  const first=await create('doctors',{name:'Treating dentist',branchId:north.id,branchIds:[north.id,south.id],consultationPaise:35000,visitingConsultationPaise:50000});
  const second=await create('doctors',{name:'Referred specialist',branchId:south.id,consultationPaise:20000,visitingConsultationPaise:25000});
  const emailA=`dentist-a-${randomUUID()}@example.test`, emailB=`dentist-b-${randomUUID()}@example.test`;
  for (const [doctor,email] of [[first,emailA],[second,emailB]]) {
    const r=await request(`/clinic/doctors/${doctor.id}/login`,'POST',{email,password},clinic.cookie);
    assert.equal(r.status,200,JSON.stringify(r.data));
    assert.equal(JSON.stringify(r.data).includes('password'),false);
  }
  const loginA=await request('/auth/login','POST',{email:emailA,password}), loginB=await request('/auth/login','POST',{email:emailB,password});
  const receptionEmail=`dental-reception-${randomUUID()}@example.test`;
  await create('staff',{name:'Receiving receptionist',email:receptionEmail,password,role:'RECEPTIONIST',branchId:south.id});
  const reception=await request('/auth/login','POST',{email:receptionEmail,password});
  const patient=await create('patients',{name:'Referred dental patient',phone:'9000067890',branchId:north.id,doctorId:first.id,allergies:'Latex'});
  const appointment=await create('appointments',{patientId:patient.id,doctorId:first.id,branchId:north.id,startsAt:new Date(Date.now()+86400000).toISOString(),useClinicFee:true});
  const otherPatient=await create('patients',{name:'Same doctor other branch',phone:'9000067891',branchId:south.id,doctorId:first.id});
  await create('appointments',{patientId:otherPatient.id,doctorId:first.id,branchId:south.id,startsAt:new Date(Date.now()+3*86400000).toISOString()});
  const ownAppointments=await request('/clinic/appointments','GET',undefined,loginA.cookie);
  assert.equal(ownAppointments.status,200); assert.equal(ownAppointments.data.length,2); assert.ok(ownAppointments.data.every((a:any)=>a.doctorId===first.id));
  assert.equal((await request('/clinic/appointments','GET',undefined,loginB.cookie)).data.length,0);
  const body={complaint:'Pain in lower molar',findings:'Deep caries',diagnosis:'Pulpitis',advice:'Review with specialist',medication:'Prescription recorded by treating dentist',medicalHistory:'No prior surgery',allergies:'Latex',consent:true,surgeryDate:null,teeth:{'36':{condition:'Caries',notes:'Occlusal lesion'}},lines:[{tooth:'36',name:'Pulp therapy',pricePaise:80000,labChargePaise:20000,labName:'Dental lab',labNotes:'Preserve shade record'}]};
  assert.equal((await request(`/clinic/dental-visits/${appointment.id}`,'PUT',body,reception.cookie)).status,403);
  assert.equal((await request(`/clinic/dental-visits/${appointment.id}`,'GET',undefined,loginB.cookie)).status,404);
  assert.equal((await request(`/clinic/dental-visits/${appointment.id}`,'GET',undefined,b.cookie)).status,404);
  const draft=await request(`/clinic/dental-visits/${appointment.id}`,'PUT',body,loginA.cookie);
  assert.equal(draft.status,200,JSON.stringify(draft.data));
  assert.equal(draft.data.status,'DRAFT');
  assert.equal(await db.invoice.count({where:{tenantId:clinic.tenantId}}),0);
  const invalid=await request(`/clinic/dental-visits/${appointment.id}`,'PUT',{...body,finalize:true,referral:{doctorId:doctorA.id,reason:'Must not cross clinics'}},loginA.cookie);
  assert.equal(invalid.status,404);
  assert.equal(await db.invoice.count({where:{tenantId:clinic.tenantId}}),0);
  const complete={...body,finalize:true,referral:{doctorId:second.id,branchId:south.id,reason:'Specialist review for tooth 36'}};
  const key=randomUUID();
  async function close() { const r=await fetch(root+`/clinic/dental-visits/${appointment.id}`,{method:'PUT',headers:{Origin:'http://localhost:5173',Cookie:loginA.cookie,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(complete)}); const d=await r.json(); assert.equal(r.status,200,JSON.stringify(d)); return d; }
  const closed=await close(); await close();
  assert.equal(closed.status,'REFERRED'); assert.equal(closed.surgeryDate,null);
  assert.equal((await request(`/clinic/appointments/${appointment.id}`,'PATCH',{status:'SCHEDULED'},clinic.cookie)).status,409);
  assert.equal((await request(`/clinic/appointments/${appointment.id}`,'DELETE',undefined,clinic.cookie)).status,409);
  assert.equal((await request(`/clinic/dental-visits/${appointment.id}`,'PUT',body,loginA.cookie)).status,409);
  const invoices=await db.invoice.findMany({where:{tenantId:clinic.tenantId,appointmentId:appointment.id}});
  assert.equal(invoices.length,5); assert.equal(invoices.reduce((s,i)=>s+i.totalPaise,0),215000);
  const referrals=await request('/clinic/internal-referrals','GET',undefined,reception.cookie);
  assert.equal(referrals.status,200,JSON.stringify(referrals.data)); assert.equal(referrals.data.rows.length,1);
  const referral=referrals.data.rows[0];
  const detail=await request(`/clinic/internal-referrals/${referral.id}`,'GET',undefined,reception.cookie);
  assert.equal(detail.status,200,JSON.stringify(detail.data)); assert.equal(detail.data.doctor.id,second.id); assert.equal(detail.data.encounter.lines[0].tooth,'36');
  assert.equal((await request(`/clinic/patients/${patient.id}`,'GET',undefined,loginB.cookie)).status,404);
  assert.equal((await request(`/clinic/internal-referrals/${referral.id}/schedule`,'POST',{startsAt:new Date(Date.now()+2*86400000).toISOString()},loginA.cookie)).status,403);
  const scheduled=await request(`/clinic/internal-referrals/${referral.id}/schedule`,'POST',{startsAt:new Date(Date.now()+2*86400000).toISOString()},reception.cookie);
  assert.equal(scheduled.status,201,JSON.stringify(scheduled.data)); assert.equal(scheduled.data.doctorId,second.id); assert.equal(scheduled.data.referralId,referral.id);
  assert.equal((await request(`/clinic/internal-referrals/${referral.id}/schedule`,'POST',{startsAt:new Date(Date.now()+3*86400000).toISOString()},reception.cookie)).status,409);
  const next=await request(`/clinic/dental-visits/${scheduled.data.id}`,'GET',undefined,loginB.cookie);
  assert.equal(next.status,200,JSON.stringify(next.data)); assert.equal(next.data.history[0].lines[0].labNotes,'Preserve shade record');
  const nextClose=await request(`/clinic/dental-visits/${scheduled.data.id}`,'PUT',{complaint:'Referred review',diagnosis:'Reviewed tooth 36',finalize:true,surgeryDate:'2026-12-01T12:00:00.000Z'},loginB.cookie);
  assert.equal(nextClose.status,200,JSON.stringify(nextClose.data)); assert.equal(nextClose.data.status,'CLOSED');
  assert.equal((await request(`/clinic/appointments/${appointment.id}`,'PATCH',{paymentStatus:'PAID'},clinic.cookie)).status,409);
  for (const invoice of invoices) {
    const paid=await request('/clinic/payments','POST',{invoiceId:invoice.id,amountPaise:invoice.totalPaise,method:'CASH',idempotencyKey:randomUUID()},reception.cookie);
    assert.equal(paid.status,201,JSON.stringify(paid.data));
  }
  assert.equal((await db.appointment.findUniqueOrThrow({where:{id:appointment.id}})).paymentStatus,'PAID');
  const commissions=await db.commission.findMany({where:{tenantId:clinic.tenantId}});
  assert.equal(commissions.length,1); assert.equal(commissions[0].amountPaise,32000);
  assert.equal((await request(`/clinic/doctors/${first.id}/login`,'POST',{email:emailA,password:'New-Doctor-Password-123'},clinic.cookie)).status,200);
  assert.equal((await request('/clinic/workspace','GET',undefined,loginA.cookie)).status,401);
  assert.equal((await request('/auth/login','POST',{email:emailA,password},undefined)).status,401);
});
