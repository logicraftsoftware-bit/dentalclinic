import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
mkdirSync('.tools/screenshots', { recursive: true });
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
  await masterDialog.getByLabel('Charge group', { exact: true }).selectOption({ label: 'Dental procedures' });
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
  await page.route('**/api/clinic/charts?*', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
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
  dialog = page.getByRole('dialog');
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(10, 0, 0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await dialog.getByLabel('Date & time').fill(local);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
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
