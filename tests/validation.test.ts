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
