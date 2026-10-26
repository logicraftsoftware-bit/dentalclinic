import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
mkdirSync('.tools/screenshots', { recursive: true });
// Only the runner-owned ephemeral database may have its request counters reset.
test.beforeEach(async () => {
  const uri = new URL(process.env.DATABASE_URL || 'mongodb://invalid/');
  if (uri.hostname === '127.0.0.1' && uri.pathname === '/dentaflow_test') {
    const setup = new PrismaClient();
    try {
      await setup.rateBucket.deleteMany();
    } finally {
      await setup.$disconnect();
    }
  }
});

test('appointment fee checkboxes work independently and a clinic-only visit needs no doctor', async ({ page }) => {
  const headers={Origin:'http://localhost:5173'},password='Checkbox-Fees-Browser-123',email=`fees-${randomUUID()}@example.test`;
  const plans=await(await page.request.get('/api/public/plans')).json();
  expect((await page.request.post('/api/auth/register',{headers,data:{clinicName:'Fee checkbox clinic',name:'Owner',email,password,phone:'9876543210',planId:plans.find((p:any)=>p.name==='Enterprise').id,acceptTerms:true}})).status()).toBe(201);
  await page.request.post('/api/auth/login',{headers,data:{email,password}});
  async function create(resource:string,data:any){const result=await page.request.post(`/api/clinic/${resource}`,{headers,data});expect(result.status()).toBe(201);return result.json();}
  await create('patients',{name:'Checkbox Patient',phone:'9000098765'});
  await create('doctors',{name:'Dr Checkbox',consultationPaise:45000,visitingConsultationPaise:90000});
  await page.goto('/clinic/appointments/new');
  const clinic=page.getByRole('checkbox',{name:/^Clinic fee/});
  await expect(clinic).toBeVisible();await expect(clinic).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:/^Consultant fee/})).toHaveCount(0);
  await page.getByLabel('Search patient by name or phone number').fill('Checkbox');
  await page.getByRole('button',{name:'Checkbox Patient 9000098765'}).click();
  await clinic.check();
  await page.getByLabel('Search doctor by name').fill('Checkbox');
  await page.getByRole('button',{name:'Dr Checkbox',exact:false}).click();
  const consultant=page.getByRole('checkbox',{name:/^Consultant fee/}),visiting=page.getByRole('checkbox',{name:/^Visiting consultant fee/});
  await consultant.check();await visiting.check();await expect(clinic).toBeChecked();
  const total=page.locator('.appointment-selection').filter({hasText:'Total fees:'});
  await expect(total).toContainText('1,650');
  await consultant.uncheck();await expect(total).toContainText('1,200');
  await visiting.uncheck();await expect(total).toContainText('300');
  await page.getByLabel('Search doctor by name').fill('');
  await expect(consultant).toHaveCount(0);await expect(clinic).toBeChecked();
  const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
  await page.getByLabel(/^Date/).fill(date);await page.getByLabel(/^Time/).fill('10:00');
  const response=page.waitForResponse(r=>r.url().endsWith('/api/clinic/appointments')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Create appointment',exact:true}).click();
  const result=await response;expect(result.status()).toBe(201);const saved=await result.json();
  expect(saved.doctorId).toBeNull();expect(saved.clinicFeePaise).toBe(30000);expect(saved.consultationPaise).toBe(0);
  await page.goto(`/clinic/appointments/${date}/unassigned`);
  await expect(page.getByRole('heading',{name:'Unassigned appointments'})).toBeVisible();
  await expect(page.locator('.roster-entry')).toContainText('Checkbox Patient');
  await expect(page.getByRole('button',{name:'Open billing'})).toBeVisible();
});

test('receptionist sees today, marks attendance and bills procedures for multiple doctors', async ({ page }) => {
  const headers = { Origin: 'http://localhost:5173' }, password = 'Reception-Browser-Password-123';
  const plans = await (await page.request.get('/api/public/plans')).json();
  const email = `reception-owner-${randomUUID()}@example.test`;
  const signup = await page.request.post('/api/auth/register', { headers, data: { clinicName: 'Reception browser clinic', name: 'Owner', email, password, phone: '9876543210', planId: plans.find((p: any) => p.name === 'Enterprise').id, acceptTerms: true } });
  expect(signup.status()).toBe(201);
  await page.request.post('/api/auth/login', { headers, data: { email, password } });
  async function create(resource: string, data: any) { const r = await page.request.post(`/api/clinic/${resource}`, { headers, data }); expect(r.status()).toBe(201); return r.json(); }
  expect((await page.request.patch('/api/clinic/settings', { headers, data: { name: 'Medicity Guwahati Dental Clinic', phone: '9127539374', settings: { address: '123, GS Road, Guwahati - 781001, Assam', contactEmail: 'medicitydental@gmail.com', website: 'https://www.medicitydental.com', tagline: 'Your Oral Health, Our Priority' } } })).status()).toBe(200);
  const branch = await create('branches', { name: 'Reception branch' });
  const first = await create('doctors', { name: 'Dr Reception One', branchId: branch.id });
  const second = await create('doctors', { name: 'Dr Reception Two', branchId: branch.id });
  const patient = await create('patients', { name: 'Reception billing patient', phone: '9000011223', branchId: branch.id });
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const appointment = await create('appointments', { patientId: patient.id, doctorId: first.id, branchId: branch.id, startsAt: `${date}T09:00:00+05:30`, feeType: 'clinic' });
  const receptionist = `reception-browser-${randomUUID()}@example.test`;
  await create('staff', { name: 'Reception staff', email: receptionist, password, role: 'RECEPTIONIST', branchId: branch.id });
  await page.request.post('/api/auth/logout', { headers, data: {} });
  await page.request.post('/api/auth/login', { headers, data: { email: receptionist, password } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/clinic/dashboard');
  await expect(page.getByRole('heading', { name: 'Receptionist panel', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: "Today's patients", exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Absent', exact: true }).click();
  await expect(page.locator('.reception-patient .attendance-pill')).toHaveText('Absent');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.reception-patient .attendance-pill')).toHaveText('Present');
  await page.getByRole('button', { name: `Billing for ${patient.name}` }).click();
  await expect(page).toHaveURL(new RegExp('/clinic/reception/billing/' + appointment.id));
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await page.getByLabel('Procedure 2', { exact: true }).fill('Restoration');
  await page.getByLabel('Charge 2', { exact: true }).fill('1000');
  await page.getByLabel('Lab charge 2', { exact: true }).fill('200');
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  await page.getByLabel('Procedure 3', { exact: true }).fill('Scaling');
  await page.getByLabel('Doctor 3', { exact: true }).selectOption(second.id);
  await page.getByLabel('Charge 3', { exact: true }).fill('500');
  await page.getByLabel('Collect 1', { exact: true }).fill('300');
  await page.getByLabel('Discount 2', { exact: true }).fill('100');
  await page.getByLabel('Collect 2', { exact: true }).fill('400');
  await page.getByLabel('Payment method 2', { exact: true }).selectOption('UPI');
  await page.getByLabel('Payment reference 2', { exact: true }).fill('RESTORATION-UPI');
  await page.getByLabel('Discount 3', { exact: true }).fill('50');
  await page.getByLabel('Collect 3', { exact: true }).fill('200');
  await page.getByLabel('Payment method 3', { exact: true }).selectOption('CARD');
  await page.screenshot({ path: '.tools/screenshots/reception-billing-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Collect payment', exact: true }).click();
  const restoration = page.locator('tr[data-procedure="Restoration"]');
  const scaling = page.locator('tr[data-procedure="Scaling"]');
  await expect(restoration).toContainText('Saved discount: ₹100');
  await expect(scaling).toContainText('Saved discount: ₹50');
  const billSummary = page.getByLabel('Bill summary');
  const paidTotal = billSummary.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Already paid$/ }) }).locator('dd');
  const remainingBalance = billSummary.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Remaining balance$/ }) }).locator('dd');
  await expect(paidTotal).toHaveText('₹900');
  await expect(remainingBalance).toHaveText('₹950');
  await restoration.getByRole('button', { name: /^Collect balance/ }).click();
  await restoration.getByLabel(/^Payment method/).selectOption('BANK');
  await scaling.getByRole('button', { name: /^Collect balance/ }).click();
  await scaling.getByLabel(/^Payment method/).selectOption('CASH');
  await page.getByRole('button', { name: 'Collect payment', exact: true }).click();
  await expect(remainingBalance).toHaveText('₹0');
  await page.reload();
  await expect(restoration).toContainText('Paid by BANK, UPI');
  const saved = await (await page.request.get(`/api/clinic/reception/${appointment.id}`)).json();
  expect(saved.invoices.find((i: any) => i.description === 'Scaling').doctorId).toBe(second.id);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.receipt-summary')).toContainText('Total Discount₹150.00');
  await expect(page.locator('.receipt-summary')).toContainText('Net Payable₹1,850.00');
  await expect(page.locator('.receipt-procedure-table')).toContainText('BANK, UPI');
  await expect(page.locator('.receipt-procedure-table')).toContainText('700.00');
  await page.locator('.reception-receipt').screenshot({ path: '.tools/screenshots/reception-receipt.png' });
  const pdf = await page.pdf({ path: '.tools/screenshots/reception-receipt.pdf', format: 'A4', printBackground: true });
  expect((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length).toBe(1);
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Add procedure', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: '.tools/screenshots/reception-billing-mobile.png', fullPage: true });
});

test('marketing pages work on desktop and mobile without horizontal overflow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /More smiles/ })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/marketing-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: '.tools/screenshots/marketing-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Privacy policy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Privacy & data ownership' })).toBeVisible();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page).toHaveTitle('Privacy & data ownership | DentaFlow');
  expect(errors).toEqual([]);
});
test('platform administrator configures plans and audits clinic status without clinical membership', async ({
  page,
}) => {
  const db = new PrismaClient();
  const email = `platform-browser-${randomUUID()}@example.test`;
  const password = 'Platform-Browser-Password-123';
  await db.user.create({
    data: {
      email,
      name: 'Platform owner',
      passwordHash: await bcrypt.hash(password, 12),
      verified: true,
      platformAdmin: true,
    },
  });
  await db.$disconnect();
  const login = await page.request.post('/api/auth/login', {
    headers: { Origin: 'http://localhost:5173' },
    data: { email, password },
  });
  expect(login.ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your business at a glance' })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/platform-desktop.png', fullPage: true });
  const denied = await page.request.get('/api/clinic/patients');
  expect(denied.status()).toBe(403);
  await page
    .locator('.sidebar nav')
    .getByRole('button', { name: 'Subscription plans', exact: true })
    .click();
  await page.getByRole('button', { name: 'Create plan', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const name = `QA Practice ${randomUUID().slice(0, 8)}`;
  await dialog.getByLabel('Plan name').fill(name);
  await dialog.getByLabel('Monthly price (₹)').fill('1299');
  await dialog.getByLabel('Annual price (₹)').fill('12990');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Clinics', exact: true }).click();
  const row = page.locator('tbody tr').first();
  await row.getByRole('button', { name: 'Suspend', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Recorded reason').fill('Temporary QA suspension');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByRole('button', { name: 'Activate', exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Activate', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Recorded reason').fill('QA complete');
  await page.getByRole('dialog').getByRole('button', { name: 'Save changes' }).click();
  await expect(row.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible();
  await page
    .locator('.sidebar nav')
    .getByRole('button', { name: 'Audit trail', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Platform audit trail' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PLAN_CREATED', exact: true }).first()).toBeVisible();
  const allPlans = await (await page.request.get('/api/platform/plans')).json();
  const created = allPlans.find((p: any) => p.name === name);
  expect(created).toBeTruthy();
  await page.request.patch(`/api/platform/plans/${created.id}`, {
    headers: { Origin: 'http://localhost:5173' },
    data: { available: false },
  });
});
test('clinic owner completes signup, patient charting, session billing and payment through the UI', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const email = `browser-${randomUUID()}@example.test`;
  const password = 'Browser-Strong-Password-123';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Start free trial', exact: true }).first().click();
  await page.getByLabel('Clinic name', { exact: true }).fill('Sunrise Dental Clinic');
  await page.getByLabel('Owner name').fill('Dr. Aditi Sharma');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Phone number').fill('9876543210');
  await page.getByLabel(/^Password/).fill(password);
  await page
    .getByLabel('Choose your trial plan')
    .selectOption({ label: 'Professional · 14-day trial' });
  await page.locator('input[name=acceptTerms]').check();
  await page.getByRole('button', { name: 'Create clinic workspace' }).click();
  await expect(page.locator('.success-banner')).toContainText('ready');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Aditi' })).toBeVisible();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Masters', exact: true }).click();
  await page.getByRole('button', { name: 'Add speciality', exact: true }).click();
  let masterDialog = page.getByRole('dialog');
  await masterDialog.getByLabel('Speciality name').fill('Endodontist');
  await masterDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Endodontist', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Charge group master' }).click();
  await page.getByRole('button', { name: 'Add charge group', exact: true }).click();
  masterDialog = page.getByRole('dialog');
  await masterDialog.getByLabel('Group name').fill('Dental procedures');
  await masterDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Dental procedures', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Charge master', exact: true }).click();
  await page.getByRole('button', { name: 'Add charge', exact: true }).click();
  masterDialog = page.getByRole('dialog');
  await masterDialog
    .getByLabel('Charge group', { exact: true })
    .selectOption({ label: 'Dental procedures' });
  await masterDialog.getByLabel('Charge name').fill('Root canal');
  await masterDialog.getByLabel('Charge (₹)', { exact: true }).fill('2000');
  await masterDialog.getByLabel('Lab charge (₹)', { exact: true }).fill('500');
  await masterDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: 'Root canal', exact: true })).toBeVisible();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Doctors', exact: true }).click();
  await page.getByRole('button', { name: 'Add doctor', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Dr. Aditi Sharma');
  await dialog.getByLabel('Speciality', { exact: true }).selectOption({ label: 'Endodontist' });
  await dialog.getByLabel('Commission (%) on collections').fill('20');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Dr. Aditi Sharma', exact: true })).toBeVisible();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Patients', exact: true }).click();
  await page.getByRole('button', { name: 'Add patient', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Full name').fill('Ananya Das');
  await dialog.getByLabel('Phone number').fill('9876543211');
  await dialog.getByLabel('Gender').selectOption('Female');
  await dialog.getByLabel('Patient consent recorded').check();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Open record' }).click();
  await page.route('**/api/clinic/charts?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.getByRole('button', { name: 'Tooth chart', exact: true }).click();
  await page.getByRole('button', { name: 'Tooth 36: Healthy', exact: true }).click();
  await page.getByLabel('Condition', { exact: true }).selectOption('Caries');
  await page.getByLabel('Clinical notes', { exact: true }).fill('Occlusal caries');
  await page.getByRole('button', { name: 'Save chart' }).click();
  await expect(page.getByRole('button', { name: 'Tooth 36: Caries', exact: true })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/tooth-chart.png', fullPage: true });
  await page.getByRole('button', { name: 'Treatment plans', exact: true }).click();
  await page.getByRole('button', { name: 'New plan', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Plan title').fill('Root canal rehabilitation');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByLabel('Plan status').selectOption('ACCEPTED');
  await page.getByRole('button', { name: 'Add treatment', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('FDI tooth number (e.g. 36)').fill('36');
  await dialog.getByLabel('Charge master', { exact: true }).selectOption({ label: 'Root canal' });
  await expect(dialog.getByLabel('Lab charge (₹)', { exact: true })).toHaveValue('500');
  await dialog.getByLabel('Treatment name').fill('Root canal');
  await dialog.getByLabel('Total treatment price (₹)').fill('2000');
  await dialog.getByLabel('Planned sessions').fill('2');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await page.getByRole('button', { name: 'Record session', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Procedure notes').fill('Access opening and cleaning');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('1 of 2 sessions')).toBeVisible();
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
  await page.getByRole('button', { name: 'Record installment' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Amount received (₹)').fill('400');
  await dialog.getByLabel('Payment method').selectOption('UPI');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('table .badge')).toHaveText('Part paid');
  await page.getByRole('button', { name: 'Book appointment' }).click();
  await expect(page).toHaveURL(/\/clinic\/appointments\/new\?patientId=/);
  await expect(page.getByRole('heading', { name: 'Create appointment', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const patientSearch = page.getByLabel('Search patient by name or phone number');
  await expect(patientSearch).toHaveValue('Ananya Das');
  await patientSearch.fill('9876543211');
  await page.getByRole('button', { name: 'Ananya Das 9876543211' }).click();
  await expect(patientSearch).toHaveValue('Ananya Das');
  await expect(page.getByRole('button', { name: 'Dr. Aditi Sharma Endodontist' })).toHaveCount(0);
  await page.getByLabel('Search doctor by name').fill('Aditi');
  await page.getByRole('button', { name: 'Dr. Aditi Sharma Endodontist' }).click();
  await expect(page.locator('.appointment-fees')).toContainText('Consultant fee');
  await expect(page.locator('.appointment-fees')).toContainText('Visiting consultant fee');
  const clinicFee = page.getByRole('checkbox', { name: /^Clinic fee/ });
  await clinicFee.check();
  await expect(clinicFee).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /^Consultant fee/ })).not.toBeChecked();
  await page.getByRole('checkbox', { name: /^Visiting consultant fee/ }).check();
  await expect(clinicFee).toBeChecked();
  await page.getByRole('checkbox', { name: /^Consultant fee/ }).check();
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  await page.getByLabel('Date', { exact: false }).fill(local);
  await page.getByLabel(/^Time/).fill('10:00');
  await page.getByLabel('Notes (optional)').fill('Morning consultation');
  await page.getByRole('button', { name: 'Create appointment', exact: true }).click();
  await expect(page).toHaveURL(/\/clinic\/appointments$/);
  await page.getByRole('button', { name: local + ', 1 appointment', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/clinic/appointments/' + local));
  await expect(page.getByRole('button', { name: /Dr. Aditi Sharma.*Endodontist/ })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/appointment-doctors.png', fullPage: true });
  await page.getByRole('button', { name: /Dr. Aditi Sharma.*Endodontist/ }).click();
  await expect(page.getByRole('heading', { name: 'Dr. Aditi Sharma', exact: true })).toBeVisible();
  await expect(page.locator('.roster-entry')).toContainText('Ananya Das');
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(page.locator('.attendance-pill')).toHaveText('Checked in');
  await page.getByLabel('Payment status for Ananya Das').selectOption('PAID');
  await expect(page.getByLabel('Payment status for Ananya Das')).toHaveValue('PAID');
  await page.reload();
  await expect(page.locator('.attendance-pill')).toHaveText('Checked in');
  await expect(page.getByLabel('Payment status for Ananya Das')).toHaveValue('PAID');
  await page.getByLabel('Search patients in roster').fill('no match');
  await expect(page.locator('.roster-entry')).toHaveCount(0);
  await page.getByLabel('Search patients in roster').fill('9876543211');
  await expect(page.locator('.roster-entry')).toHaveCount(1);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('appointments-' + local + '.csv');
  await page.screenshot({ path: '.tools/screenshots/appointment-roster.png', fullPage: true });
  await page.getByRole('button', { name: 'Back to doctors' }).click();
  await page.getByRole('button', { name: 'Back to calendar' }).click();
  await expect(page.getByRole('button', { name: local + ', 1 appointment', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Department', exact: true }).selectOption('Endodontist');
  await expect(page.getByRole('button', { name: local + ', 1 appointment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(page.getByText('Loading calendar...', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(page.getByRole('button', { name: local + ', 1 appointment', exact: true })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/appointment-calendar.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.sidebar nav').getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Aditi' })).toBeVisible();
  await page.screenshot({ path: '.tools/screenshots/clinic-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: '.tools/screenshots/clinic-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.locator('.sidebar nav').getByRole('button', { name: 'Patients', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patients', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('staff creation selects branch and each role opens its permitted panel', async ({ page }) => {
  const password = 'Role-Panel-Test-Password-123';
  const ownerEmail = `${randomUUID()}@example.test`;
  const headers = { Origin: 'http://localhost:5173' };
  const plans = await (await page.request.get('/api/public/plans')).json();
  const plan = plans.find((p: any) => p.name === 'Enterprise');
  const signup = await page.request.post('/api/auth/register', {
    headers,
    data: {
      clinicName: 'Role Panel Clinic',
      name: 'Role owner',
      email: ownerEmail,
      password,
      phone: '9876543210',
      planId: plan.id,
      acceptTerms: true,
    },
  });
  expect(signup.status()).toBe(201);
  await page.request.post('/api/auth/login', { headers, data: { email: ownerEmail, password } });
  const branch = await (
    await page.request.post('/api/clinic/branches', { headers, data: { name: 'Main branch' } })
  ).json();
  const doctor = await (
    await page.request.post('/api/clinic/doctors', {
      headers,
      data: { name: 'Doctor panel profile', branchId: branch.id },
    })
  ).json();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page
    .locator('.sidebar nav')
    .getByRole('button', { name: 'Team & branches', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add staff', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const adminEmail = `${randomUUID()}@example.test`;
  await dialog.getByLabel('Name', { exact: true }).fill('Main branch administrator');
  await dialog.getByLabel('Email', { exact: true }).fill(adminEmail);
  await dialog.getByLabel('Initial password (12+ characters)').fill(password);
  await dialog.getByLabel('Role', { exact: true }).selectOption('BRANCH_ADMIN');
  await dialog.getByLabel('Branch (required for branch admin)').selectOption(branch.id);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('cell', { name: adminEmail, exact: true })).toBeVisible();
  const logins = [
    { role: 'BRANCH_ADMIN', email: adminEmail, panel: 'Branch admin panel' },
    { role: 'RECEPTIONIST', email: `${randomUUID()}@example.test`, panel: 'Receptionist panel' },
    { role: 'DOCTOR', email: `${randomUUID()}@example.test`, panel: 'Doctor panel' },
  ];
  for (const login of logins.slice(1)) {
    const result = await page.request.post('/api/clinic/staff', {
      headers,
      data: {
        name: login.role,
        email: login.email,
        password,
        role: login.role,
        branchId: branch.id,
        ...(login.role === 'DOCTOR' ? { doctorId: doctor.id } : {}),
      },
    });
    expect(result.status()).toBe(201);
  }
  for (const login of logins) {
    await page.request.post('/api/auth/logout', { headers });
    const result = await page.request.post('/api/auth/login', {
      headers,
      data: { email: login.email, password },
    });
    expect(result.status()).toBe(200);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: login.panel, exact: true })).toBeVisible();
    const nav = page.locator('.sidebar nav');
    await expect(nav.getByRole('button', { name: 'Appointments', exact: true })).toBeVisible();
    await expect(
      page.locator('.nav-bottom').getByRole('button', { name: 'Settings', exact: true }),
    ).toHaveCount(0);
    await expect(nav.getByRole('button', { name: 'Team & branches', exact: true })).toHaveCount(
      login.role === 'BRANCH_ADMIN' ? 1 : 0,
    );
    await expect(nav.getByRole('button', { name: 'Billing & payments', exact: true })).toHaveCount(
      login.role === 'DOCTOR' ? 0 : 1,
    );
    await expect(nav.getByRole('button', { name: 'Treatments', exact: true })).toHaveCount(
      login.role === 'RECEPTIONIST' ? 0 : 1,
    );
    await page.screenshot({
      path: `.tools/screenshots/${login.role.toLowerCase()}-panel.png`,
      fullPage: true,
    });
  }
});

test('shared named URLs survive sign-in, refresh and browser history', async ({ page }) => {
  const headers = { Origin: 'http://localhost:5173' };
  const email = `${randomUUID()}@example.test`,
    password = 'Shared-Link-Password-123';
  const plans = await (await page.request.get('/api/public/plans')).json();
  const signup = await page.request.post('/api/auth/register', {
    headers,
    data: {
      clinicName: 'Shared links clinic',
      name: 'Link owner',
      email,
      password,
      phone: '9876543210',
      planId: plans.find((p: any) => p.name === 'Enterprise').id,
      acceptTerms: true,
    },
  });
  expect(signup.status()).toBe(201);
  await page.request.post('/api/auth/login', { headers, data: { email, password } });
  const created = await page.request.post('/api/clinic/patients', {
    headers,
    data: { name: 'Shared record patient', phone: '9000000099' },
  });
  expect(created.status()).toBe(201);
  const patient = await created.json();
  await page.request.post('/api/auth/logout', { headers });
  const shared = `/clinic/patients/${patient.id}/tooth-chart`;
  await page.goto(shared);
  await expect(page).toHaveURL(new RegExp('/login\\?next='));
  await expect(page).toHaveTitle('Log in | DentaFlow');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to your workspace', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(shared + '$'));
  await expect(
    page.getByRole('heading', { name: 'Shared record patient', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Patient record - Tooth chart | DentaFlow');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tooth 36: Healthy', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/clinic/patients/${patient.id}/billing$`));
  await expect(page).toHaveTitle('Patient record - Billing | DentaFlow');
  await page.goBack();
  await expect(page).toHaveTitle('Patient record - Tooth chart | DentaFlow');
  await page.goForward();
  await expect(page).toHaveTitle('Patient record - Billing | DentaFlow');
  await page.locator('.sidebar nav').getByRole('button', { name: 'Masters', exact: true }).click();
  await page.getByRole('tab', { name: 'Charge master', exact: true }).click();
  await expect(page).toHaveURL(/\/clinic\/masters\/charges$/);
  await expect(page).toHaveTitle('Charge master | DentaFlow');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Charge master', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/unknown-page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
});

test('doctor login, tooth treatment, referral reception scheduling and inherited history work through the UI', async ({ page }) => {
  const headers={Origin:'http://localhost:5173'}, password='Dental-Workflow-Password-123';
  const plans=await (await page.request.get('/api/public/plans')).json(), plan=plans.find((p:any)=>p.name==='Enterprise');
  const email=`dental-owner-${randomUUID()}@example.test`;
  expect((await page.request.post('/api/auth/register',{headers,data:{clinicName:'Dental workflow clinic',name:'Workflow owner',email,password,phone:'9876543210',planId:plan.id,acceptTerms:true}})).status()).toBe(201);
  await page.request.post('/api/auth/login',{headers,data:{email,password}});
  async function create(resource:string,data:any){const r=await page.request.post('/api/clinic/'+resource,{headers,data});expect(r.status()).toBe(201);return r.json();}
  const branch=await create('branches',{name:'Dental clinic branch'});
  const alpha=await create('doctors',{name:'Doctor Alpha',branchId:branch.id,consultationPaise:10000,visitingConsultationPaise:20000});
  const beta=await create('doctors',{name:'Doctor Beta',branchId:branch.id});
  const patient=await create('patients',{name:'Dental workflow patient',phone:'9000054321',branchId:branch.id,doctorId:alpha.id});
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  await create('appointments',{patientId:patient.id,doctorId:alpha.id,branchId:branch.id,startsAt:new Date(date+'T10:00:00+05:30').toISOString()});
  const recepEmail=`dental-recep-${randomUUID()}@example.test`, alphaEmail=`alpha-${randomUUID()}@example.test`, betaEmail=`beta-${randomUUID()}@example.test`;
  await create('staff',{name:'Dental receptionist',email:recepEmail,password,role:'RECEPTIONIST',branchId:branch.id});
  await page.goto('/clinic/doctors');
  for(const [name,loginEmail] of [['Doctor Alpha',alphaEmail],['Doctor Beta',betaEmail]]){
    await page.locator('.doctor-card').filter({has:page.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Manage login'}).click();
    const dialog=page.getByRole('dialog'); await dialog.getByLabel('Login email').fill(loginEmail); await dialog.getByLabel('Password (at least 12 characters)').fill(password);
    await dialog.getByRole('button',{name:'Save changes'}).click(); await expect(dialog).toHaveCount(0);
  }
  async function signIn(loginEmail:string){await page.request.post('/api/auth/logout',{headers});await page.goto('/login');await page.getByLabel('Email address').fill(loginEmail);await page.getByLabel(/^Password/).fill(password);await page.getByRole('button',{name:'Sign in to your workspace'}).click();}
  await signIn(alphaEmail); await expect(page).toHaveURL(/\/clinic\/appointments$/);
  await page.getByRole('button',{name:date+', 1 appointment',exact:true}).click(); await expect(page).toHaveURL(new RegExp(alpha.id));
  await page.getByRole('button',{name:'Open treatment',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Dental workflow patient',exact:true})).toBeVisible();
  await page.getByLabel('Chief complaint').fill('Pain in tooth 36');await page.getByLabel('Diagnosis',{exact:true}).fill('Deep caries');
  await page.getByRole('button',{name:'Select tooth 36',exact:true}).click(); await page.getByRole('combobox',{name:'Condition for tooth 36',exact:true}).selectOption('Caries');
  await page.getByRole('button',{name:'Add treatment',exact:true}).click();await expect(page.getByLabel('Treatment 1 tooth',{exact:true})).toHaveValue('36');
  await page.getByLabel('Treatment 1 name',{exact:true}).fill('Dental restoration');await page.getByLabel('Treatment 1 fee',{exact:true}).fill('1000');await page.getByLabel('Treatment 1 lab fee',{exact:true}).fill('200');
  await page.getByLabel('Treatment 1 lab name',{exact:true}).fill('Clinic laboratory');
  await page.getByLabel('Patient consent recorded for treatment').check();await expect(page.getByLabel('Surgery date (optional)')).toHaveValue('');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.locator('.dental-visit > header .badge')).toHaveText('DRAFT');
  await page.reload();await expect(page.getByLabel('Treatment 1 name',{exact:true})).toHaveValue('Dental restoration');
  await page.getByRole('switch',{name:'Refer internally to another doctor'}).check();await page.getByRole('combobox',{name:'Referral doctor',exact:true}).selectOption(beta.id);
  await page.getByRole('button',{name:'Add treatment',exact:true}).click();
  await page.getByLabel('Treatment 2 tooth',{exact:true}).selectOption('');
  await page.getByLabel('Treatment 2 name',{exact:true}).fill('Second treatment');
  await page.getByRole('button',{name:'Close visit & refer to reception',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveText('Please correct the highlighted fields. Your entries have been kept.');
  await expect(page.getByLabel('Treatment 2 tooth',{exact:true})).toBeFocused();
  await expect(page.getByText('Treatment 2: select a tooth from the list.',{exact:true})).toBeVisible();
  await expect(page.getByText('Enter a referral reason for the receiving doctor.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Treatment 1 name',{exact:true})).toHaveValue('Dental restoration');
  await expect(page.locator('.dental-visit > header .badge')).toHaveText('DRAFT');
  await page.locator('.dental-treatment-line').nth(1).getByRole('button',{name:'Remove treatment',exact:true}).click();
  await page.getByLabel('Referral reason').fill('Internal specialist review');
  await page.screenshot({path:'.tools/screenshots/dental-treatment-form.png',fullPage:true});
  await page.getByRole('button',{name:'Close visit & refer to reception',exact:true}).click();await expect(page).toHaveURL(/\/clinic\/appointments$/);
  await page.getByRole('button',{name:date+', 1 appointment',exact:true}).click();
  await expect(page.getByText('Referred / closed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open treatment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'View treatment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Follow-up',exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Referred / closed',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Open treatment',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save draft',exact:true})).toHaveCount(0);
  await signIn(recepEmail);await page.locator('.sidebar nav').getByRole('button',{name:'Internal referrals',exact:true}).click();
  await page.getByRole('button',{name:'Review & schedule',exact:true}).click();await expect(page.getByLabel('Referred doctor',{exact:true})).toHaveValue('Doctor Beta');
  await page.locator('.dental-history').first().locator('summary').click();await expect(page.locator('.dental-history').first()).toContainText('Dental restoration');
  await page.getByRole('button',{name:'Record payment',exact:true}).first().click();const paymentDialog=page.getByRole('dialog');await paymentDialog.getByRole('button',{name:'Save changes'}).click();await expect(paymentDialog).toHaveCount(0);
  await page.getByLabel('Appointment date',{exact:true}).fill(date);await page.getByLabel('Appointment time',{exact:true}).fill('14:30');
  await page.getByRole('button',{name:'Schedule referred appointment',exact:true}).click();await expect(page).toHaveURL(new RegExp(beta.id));
  await signIn(betaEmail);await page.getByRole('button',{name:date+', 1 appointment',exact:true}).click();await page.getByRole('button',{name:'Open treatment',exact:true}).click();
  await expect(page.getByText('Internal referral visit. Previous treatments and clinical notes are preserved below.',{exact:true})).toBeVisible();
  await page.locator('.dental-history').first().locator('summary').click();await expect(page.locator('.dental-history').first()).toContainText('Dental restoration');
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
