import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  withdrawalReleaseDate,
  evaluateWithdrawal,
  classifyEvent,
  scheduleDatesFor,
  validateApplication,
  validateProtocolInput,
} from '../../src/services/healthService.js';

const TODAY = '2026-08-03';

// ---------------------------------------------------------------------------
// Carência
// ---------------------------------------------------------------------------

test('the release date is the application date plus the withdrawal days', () => {
  assert.equal(withdrawalReleaseDate('2026-08-01', 30), '2026-08-31');
  assert.equal(withdrawalReleaseDate('2026-08-01', 0), '2026-08-01');
});

test('an animal with no applied doses is not under withdrawal', () => {
  const result = evaluateWithdrawal([], TODAY);

  assert.equal(result.isUnderWithdrawal, false);
  assert.equal(result.releaseDate, null);
});

test('a scheduled but unapplied dose cannot start a withdrawal period', () => {
  // Withdrawal counts from application, not from when the dose was due.
  const result = evaluateWithdrawal(
    [{ appliedDate: null, withdrawalDays: 30, name: 'Vermífugo' }],
    TODAY,
  );

  assert.equal(result.isUnderWithdrawal, false);
});

test('a product with zero carência never blocks slaughter', () => {
  const result = evaluateWithdrawal(
    [{ appliedDate: '2026-08-02', withdrawalDays: 0, name: 'Brucelose' }],
    TODAY,
  );

  assert.equal(result.isUnderWithdrawal, false);
});

test('an animal within the withdrawal period is blocked, with days remaining', () => {
  // Applied 01/08 with 30 days carência releases on 31/08, 28 days after 03/08.
  const result = evaluateWithdrawal(
    [{ appliedDate: '2026-08-01', withdrawalDays: 30, name: 'Vermífugo' }],
    TODAY,
  );

  assert.equal(result.isUnderWithdrawal, true);
  assert.equal(result.releaseDate, '2026-08-31');
  assert.equal(result.daysRemaining, 28);
  assert.equal(result.blockingEventName, 'Vermífugo');
});

test('an elapsed withdrawal no longer blocks', () => {
  const result = evaluateWithdrawal(
    [{ appliedDate: '2026-01-01', withdrawalDays: 30, name: 'Vermífugo' }],
    TODAY,
  );

  assert.equal(result.isUnderWithdrawal, false);
});

test('the animal is clear on the release day itself, not the day after', () => {
  // Applied 04/07 + 30 days = 03/08, which is today.
  const onReleaseDay = evaluateWithdrawal(
    [{ appliedDate: '2026-07-04', withdrawalDays: 30, name: 'X' }],
    TODAY,
  );
  assert.equal(onReleaseDay.isUnderWithdrawal, false);

  const dayBefore = evaluateWithdrawal(
    [{ appliedDate: '2026-07-05', withdrawalDays: 30, name: 'X' }],
    TODAY,
  );
  assert.equal(dayBefore.isUnderWithdrawal, true);
});

test('the latest release date binds when several products overlap', () => {
  // Clearing one product does not clear the animal while another is active.
  const result = evaluateWithdrawal(
    [
      { appliedDate: '2026-08-01', withdrawalDays: 10, name: 'Curto' },
      { appliedDate: '2026-08-01', withdrawalDays: 45, name: 'Longo' },
      { appliedDate: '2026-01-01', withdrawalDays: 30, name: 'Antigo' },
    ],
    TODAY,
  );

  assert.equal(result.releaseDate, '2026-09-15');
  assert.equal(result.blockingEventName, 'Longo', 'the binding product is named');
});

// ---------------------------------------------------------------------------
// Overdue classification
// ---------------------------------------------------------------------------

test('an applied dose is never overdue, however late it was', () => {
  assert.equal(
    classifyEvent({ scheduledDate: '2020-01-01', appliedDate: '2026-01-01' }, TODAY),
    'aplicada',
  );
});

test('an unapplied dose due before today is overdue', () => {
  assert.equal(classifyEvent({ scheduledDate: '2026-08-02', appliedDate: null }, TODAY), 'atrasada');
});

test('a dose due today is still due, not yet late', () => {
  assert.equal(classifyEvent({ scheduledDate: TODAY, appliedDate: null }, TODAY), 'a-vencer');
});

// ---------------------------------------------------------------------------
// Protocol scheduling
// ---------------------------------------------------------------------------

const animal = { birth_date: '2026-01-10' };

test('an age-based protocol schedules from the animal\'s own birth date', () => {
  const result = scheduleDatesFor(
    { schedule_mode: 'por_idade', age_days: 90, interval_days: null },
    animal,
    null,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.dates, ['2026-04-10']);
});

test('an age-based protocol gives different dates to differently aged animals', () => {
  // This is the point of age-based scheduling: one protocol applied to a whole
  // lote produces a per-animal date.
  const older = scheduleDatesFor(
    { schedule_mode: 'por_idade', age_days: 90, interval_days: null },
    { birth_date: '2025-01-10' },
    null,
  );
  const younger = scheduleDatesFor(
    { schedule_mode: 'por_idade', age_days: 90, interval_days: null },
    { birth_date: '2026-01-10' },
    null,
  );

  assert.notDeepEqual(older.dates, younger.dates);
});

test('an age-based date in the past is kept, not shifted to today', () => {
  // The dose genuinely is overdue; moving it forward would hide a real gap in
  // the herd's sanitary history.
  const result = scheduleDatesFor(
    { schedule_mode: 'por_idade', age_days: 30, interval_days: null },
    { birth_date: '2020-01-01' },
    null,
  );

  assert.equal(result.dates[0], '2020-01-31');
});

test('a date-based protocol uses the date given at scheduling time', () => {
  const result = scheduleDatesFor(
    { schedule_mode: 'por_data', age_days: null, interval_days: null },
    animal,
    '2026-09-01',
  );

  assert.deepEqual(result.dates, ['2026-09-01']);
});

test('a date-based protocol requires a date', () => {
  const result = scheduleDatesFor(
    { schedule_mode: 'por_data', age_days: null, interval_days: null },
    animal,
    null,
  );

  assert.equal(result.ok, false);
  assert.match(result.reason, /data/);
});

test('an interval schedules a booster after the first dose', () => {
  const result = scheduleDatesFor(
    { schedule_mode: 'por_data', age_days: null, interval_days: 21 },
    animal,
    '2026-09-01',
  );

  assert.deepEqual(result.dates, ['2026-09-01', '2026-09-22']);
});

test('an age-based protocol with no age is rejected', () => {
  const result = scheduleDatesFor(
    { schedule_mode: 'por_idade', age_days: null, interval_days: null },
    animal,
    null,
  );

  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Application and protocol validation
// ---------------------------------------------------------------------------

test('an application may not be in the future or before birth', () => {
  assert.match(
    validateApplication({ appliedDate: '2099-01-01' }, animal, TODAY).errors.appliedDate,
    /futura/,
  );
  assert.match(
    validateApplication({ appliedDate: '2020-01-01' }, animal, TODAY).errors.appliedDate,
    /nascimento/,
  );
  assert.equal(validateApplication({ appliedDate: '2026-07-01' }, animal, TODAY).ok, true);
});

test('a protocol requires a name, kind and schedule mode', () => {
  const result = validateProtocolInput({});

  assert.equal(result.ok, false);
  assert.ok(result.errors.name);
  assert.ok(result.errors.kind);
  assert.ok(result.errors.scheduleMode);
});

test('an age-based protocol requires an age in days', () => {
  const missing = validateProtocolInput({ name: 'V', kind: 'vacina', scheduleMode: 'por_idade' });
  assert.ok(missing.errors.ageDays);

  const valid = validateProtocolInput({
    name: 'V', kind: 'vacina', scheduleMode: 'por_idade', ageDays: '90',
  });
  assert.equal(valid.data.ageDays, 90);
});

test('carência defaults to zero and must not be negative', () => {
  const noValue = validateProtocolInput({ name: 'V', kind: 'vacina', scheduleMode: 'por_data' });
  assert.equal(noValue.data.withdrawalDays, 0);

  const negative = validateProtocolInput({
    name: 'V', kind: 'vacina', scheduleMode: 'por_data', withdrawalDays: '-5',
  });
  assert.ok(negative.errors.withdrawalDays);
});
