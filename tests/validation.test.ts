import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { parsePartial } from '../server/validation.js';

const schema = z.object({ name: z.string().min(1), consent: z.boolean().default(false), commission: z.number().min(0).max(100).default(40) });
test('partial updates preserve omitted fields while validating explicit changes', () => {
  assert.deepEqual(parsePartial(schema, { name: 'Updated' }), { name: 'Updated' });
  assert.deepEqual(parsePartial(schema, {}), {});
  assert.deepEqual(parsePartial(schema, { consent: false, commission: 0 }), { consent: false, commission: 0 });
  assert.throws(() => parsePartial(schema, { commission: 101 }), z.ZodError);
  assert.throws(() => parsePartial(schema, { unknown: true }), z.ZodError);
  assert.equal(schema.parse({ name: 'New' }).commission, 40);
});

import { patientAge } from '../shared/patient-age.js';
test('patient ages support reported years, newborns, elapsed years and existing dates of birth', () => {
  assert.equal(patientAge({ age: 0, ageRecordedAt: '2026-10-26' }, '2026-10-26'), 0);
  assert.equal(patientAge({ age: 30, ageRecordedAt: '2025-10-26' }, '2026-10-25'), 30);
  assert.equal(patientAge({ age: 30, ageRecordedAt: '2025-10-26' }, '2026-10-26'), 31);
  assert.equal(patientAge({ dob: '1990-11-01', age: 10 }, '2026-10-26'), 35);
  assert.equal(patientAge({ dob: '1990-11-01' }, '2026-11-01'), 36);
  assert.equal(patientAge({}, '2026-10-26'), null);
  assert.equal(patientAge({ dob: 'invalid' }, '2026-10-26'), null);
  assert.equal(patientAge({ dob: '2027-01-01' }, '2026-10-26'), null);
});
