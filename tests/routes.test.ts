import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePageRoute,
  loginDestination,
  clinicPages,
  adminPages,
  publicPages,
  workspacePath,
  masterPages,
  patientTabs,
} from '../web/routes.js';

test('all navigation pages have named routes and titles', () => {
  for (const [area, pages] of [
    ['clinic', clinicPages],
    ['admin', adminPages],
  ] as const) {
    for (const screen of Object.keys(pages)) {
      const route = parsePageRoute(workspacePath(area, screen));
      assert.equal(route.area, area);
      assert.equal(route.screen, screen);
      assert.ok(route.title);
      assert.ok(!route.notFound);
    }
  }
  for (const [screen, page] of Object.entries(publicPages))
    assert.equal(parsePageRoute(page.path).screen, screen);
  for (const tab of Object.keys(masterPages))
    assert.equal(parsePageRoute(`/clinic/masters/${tab}`).title, masterPages[tab]);
  for (const tab of Object.keys(patientTabs))
    assert.equal(
      parsePageRoute(`/clinic/patients/00000000-0000-4000-8000-000000000001/${tab}`).tab,
      tab,
    );
});
test('unknown and malformed routes do not fall through to unrelated pages', () => {
  for (const path of [
    '/wrong-page',
    '/clinic/patients/not-an-id',
    '/clinic/masters/wrong',
    '/admin/clinics/extra',
    'https://external.example/clinic/patients',
  ])
    assert.equal(parsePageRoute(path).notFound, true);
  assert.equal(parsePageRoute('/#pricing').title, 'Pricing');
});
test('login returns to a valid authorized area and rejects external redirects', () => {
  const owner = { tenantId: 'clinic-id', platformAdmin: false };
  assert.equal(loginDestination('/clinic/masters/charges', owner), '/clinic/masters/charges');
  for (const next of [
    'https://external.example',
    '//external.example',
    '/admin/clinics',
    '/unknown',
  ])
    assert.equal(loginDestination(next, owner), '/clinic/dashboard');
  assert.equal(loginDestination('/admin/clinics', { platformAdmin: true }), '/admin/clinics');
});

test('appointment creation has a dedicated page', () => {
  assert.deepEqual(parsePageRoute('/clinic/appointments/new'), {
    area: 'clinic', screen: 'appointments', tab: 'new', title: 'Create appointment',
  });
  assert.equal(parsePageRoute('/clinic/appointments/new/extra').notFound, true);
});
