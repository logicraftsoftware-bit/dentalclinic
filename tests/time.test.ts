import test from 'node:test';
import assert from 'node:assert/strict';
import { dateKey, zonedDayRange } from '../server/time.js';
test('India clinic days do not follow UTC server midnight', () => {
  const range = zonedDayRange(new Date('2026-10-13T20:00:00Z'), 'Asia/Kolkata');
  assert.equal(range.gte.toISOString(), '2026-10-13T18:30:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-10-14T18:30:00.000Z');
  assert.equal(dateKey(new Date('2026-09-30T20:00:00Z'), 'Asia/Kolkata'), '2026-10-01');
});
test('clinic-day ranges preserve 23 and 25 hour daylight-saving days', () => {
  const spring = zonedDayRange(new Date('2026-03-08T12:00:00Z'), 'America/New_York');
  assert.equal(spring.lt.getTime() - spring.gte.getTime(), 23 * 3600000);
  const fall = zonedDayRange(new Date('2026-11-01T12:00:00Z'), 'America/New_York');
  assert.equal(fall.lt.getTime() - fall.gte.getTime(), 25 * 3600000);
});
