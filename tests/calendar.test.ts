import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDays, shiftMonth, nextDay, csvCell } from '../web/calendar-utils.js';
import { parsePageRoute } from '../web/routes.js';

test('calendar includes full Sunday-to-Saturday weeks and leap days', () => {
  const days = calendarDays('2026-10');
  assert.equal(days[0], '2026-09-27');
  assert.equal(days.at(-1), '2026-10-31');
  assert.equal(days.length % 7, 0);
  assert.ok(calendarDays('2024-02').includes('2024-02-29'));
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(nextDay('2024-02-29'), '2024-03-01');
});
test('calendar day and doctor routes survive refresh and reject invalid dates', () => {
  const doctor = '00000000-0000-4000-8000-000000000001';
  assert.equal(parsePageRoute('/clinic/appointments/2026-10-08').appointmentDate, '2026-10-08');
  assert.equal(parsePageRoute('/clinic/appointments/2026-10-08/' + doctor).doctorId, doctor);
  for (const path of ['2026-02-30', '2026-13-01', '2026-10-08/invalid', '2026-10-08/' + doctor + '/extra'])
    assert.equal(parsePageRoute('/clinic/appointments/' + path).notFound, true);
});
test('patient CSV exports escape quotes and spreadsheet formulas', () => {
  assert.equal(csvCell('A, "B"'), '"A, ""B"""');
  assert.equal(csvCell('=SUM(1)'), '"\'=SUM(1)"');
});
