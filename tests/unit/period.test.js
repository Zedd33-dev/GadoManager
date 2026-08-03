/**
 * Tests for the dashboard period presets.
 *
 * The most important property: when no period is supplied, the default must
 * reproduce exactly the "current month" range every Phase 4 KPI test was
 * written against, so adding this filter cannot silently change existing
 * behaviour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePeriod, PERIOD_PRESETS } from '../../src/lib/period.js';

const TODAY = '2026-08-03';

test('the default preset reproduces the current-month range', () => {
  const period = resolvePeriod({}, TODAY);

  assert.equal(period.preset, 'mes');
  assert.equal(period.from, '2026-08-01');
  assert.equal(period.until, '2026-09-01');
});

test('30/90/180 day presets end the day after today', () => {
  assert.deepEqual(resolvePeriod({ preset: '30' }, TODAY), {
    preset: '30',
    from: '2026-07-04',
    until: '2026-08-04',
    label: 'Custos (últimos 30 dias)',
  });

  assert.equal(resolvePeriod({ preset: '90' }, TODAY).from, '2026-05-05');
  assert.equal(resolvePeriod({ preset: '180' }, TODAY).from, '2026-02-04');
});

test('the "ano" preset spans from January 1st through today', () => {
  const period = resolvePeriod({ preset: 'ano' }, TODAY);

  assert.equal(period.from, '2026-01-01');
  assert.equal(period.until, '2026-08-04');
});

test('a valid custom range is inclusive of both endpoints', () => {
  const period = resolvePeriod(
    { preset: 'custom', customFrom: '2026-03-01', customUntil: '2026-03-15' },
    TODAY,
  );

  assert.equal(period.preset, 'custom');
  assert.equal(period.from, '2026-03-01');
  // until is exclusive, so it is the day AFTER the selected end date - this is
  // what makes 15/03 itself included in the range.
  assert.equal(period.until, '2026-03-16');
});

test('an incomplete custom range falls back to the current month', () => {
  assert.deepEqual(
    resolvePeriod({ preset: 'custom', customFrom: '2026-03-01' }, TODAY),
    resolvePeriod({ preset: 'mes' }, TODAY),
  );
  assert.deepEqual(
    resolvePeriod({ preset: 'custom' }, TODAY),
    resolvePeriod({ preset: 'mes' }, TODAY),
  );
});

test('a custom range with an invalid date format falls back to the current month', () => {
  const result = resolvePeriod(
    { preset: 'custom', customFrom: '01/03/2026', customUntil: '2026-03-15' },
    TODAY,
  );

  assert.equal(result.preset, 'mes');
});

test('a custom range where the end precedes the start falls back to the current month', () => {
  const result = resolvePeriod(
    { preset: 'custom', customFrom: '2026-03-15', customUntil: '2026-03-01' },
    TODAY,
  );

  assert.equal(result.preset, 'mes');
});

test('an unrecognised preset falls back to the current month', () => {
  assert.equal(resolvePeriod({ preset: 'bimestre' }, TODAY).preset, 'mes');
});

test('every documented preset is resolvable without throwing', () => {
  for (const preset of PERIOD_PRESETS) {
    const result = resolvePeriod(
      { preset, customFrom: '2026-01-01', customUntil: '2026-01-10' },
      TODAY,
    );
    assert.ok(result.from <= result.until, `${preset}: from must not be after until`);
    assert.ok(result.label.length > 0);
  }
});
