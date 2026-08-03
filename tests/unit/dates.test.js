/**
 * Tests for ISO date arithmetic.
 *
 * `daysBetween` is the denominator of the GMD formula and `startOfNextMonth`
 * bounds the "Custos do mes" range, so errors here would surface as wrong KPIs
 * rather than as obvious crashes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidIsoDate,
  addDays,
  addMonths,
  daysBetween,
  startOfMonth,
  startOfNextMonth,
  startOfYear,
  ageInMonths,
  maxDate,
  minDate,
  todayIso,
} from '../../src/lib/dates.js';

test('isValidIsoDate accepts real dates and rejects impossible ones', () => {
  assert.ok(isValidIsoDate('2026-03-15'));
  assert.ok(isValidIsoDate('2024-02-29'), 'leap day is valid in a leap year');

  assert.equal(isValidIsoDate('2026-02-30'), false, 'February never has 30 days');
  assert.equal(isValidIsoDate('2025-02-29'), false, '2025 is not a leap year');
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('15/03/2026'), false);
  assert.equal(isValidIsoDate('2026-3-5'), false, 'components must be zero-padded');
  assert.equal(isValidIsoDate(null), false);
});

test('addDays moves forward and backward across month and year boundaries', () => {
  assert.equal(addDays('2026-03-15', 10), '2026-03-25');
  assert.equal(addDays('2026-03-15', -20), '2026-02-23');
  assert.equal(addDays('2026-12-28', 5), '2027-01-02');
  assert.equal(addDays('2026-01-03', -5), '2025-12-29');
  assert.equal(addDays('2026-03-15', 0), '2026-03-15');
});

test('addDays crosses a leap day correctly', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 2), '2024-03-01');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
});

test('addMonths clamps to the end of the target month instead of rolling over', () => {
  // Rolling 31/01 into 03/03 would make a monthly recurring cost drift forward
  // through the calendar.
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2026-03-31', 1), '2026-04-30');
  assert.equal(addMonths('2026-03-15', 1), '2026-04-15');
});

test('addMonths handles year boundaries in both directions', () => {
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(addMonths('2026-02-15', -3), '2025-11-15');
  assert.equal(addMonths('2026-06-10', -18), '2024-12-10');
});

test('daysBetween returns exact whole days', () => {
  assert.equal(daysBetween('2026-03-01', '2026-03-31'), 30);
  assert.equal(daysBetween('2026-03-31', '2026-03-01'), -30);
  assert.equal(daysBetween('2026-03-15', '2026-03-15'), 0);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
});

test('daysBetween is unaffected by daylight-saving transitions', () => {
  // Both operands are UTC midnights, so a local clock change cannot produce a
  // 23- or 25-hour day and round to the wrong integer. This matters because the
  // result is the GMD denominator.
  assert.equal(daysBetween('2026-02-01', '2026-03-01'), 28);
  assert.equal(daysBetween('2026-10-01', '2026-11-01'), 31);
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
});

test('startOfMonth and startOfNextMonth bound a half-open month range', () => {
  assert.equal(startOfMonth('2026-03-15'), '2026-03-01');
  assert.equal(startOfNextMonth('2026-03-15'), '2026-04-01');

  // February and December are the cases a naive +30 days would get wrong.
  assert.equal(startOfNextMonth('2026-02-10'), '2026-03-01');
  assert.equal(startOfNextMonth('2026-12-31'), '2027-01-01');
});

test('startOfYear returns the first of January', () => {
  assert.equal(startOfYear('2026-08-03'), '2026-01-01');
  assert.equal(startOfYear('2026-01-01'), '2026-01-01');
});

test('ageInMonths does not count a month that has not completed', () => {
  assert.equal(ageInMonths('2024-03-15', '2026-03-15'), 24);
  assert.equal(ageInMonths('2024-03-15', '2026-03-14'), 23);
  assert.equal(ageInMonths('2026-01-10', '2026-08-03'), 6);
  assert.equal(ageInMonths('2026-08-03', '2026-08-03'), 0);
});

test('maxDate and minDate compare calendar order, not string length', () => {
  assert.equal(maxDate('2026-03-15', '2026-03-20'), '2026-03-20');
  assert.equal(minDate('2026-03-15', '2026-03-20'), '2026-03-15');
  assert.equal(maxDate('2025-12-31', '2026-01-01'), '2026-01-01');
});

test('todayIso returns a valid ISO date', () => {
  assert.ok(isValidIsoDate(todayIso()));
});
