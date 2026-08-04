/**
 * Tests for the pt-BR formatting layer.
 *
 * These matter more than they look: the em dash behaviour is what keeps the
 * dashboard from showing "R$ 0,00" or "0,0 kg" when the honest answer is
 * "nothing recorded", and the date test guards against the timezone bug that
 * shifts every date back by one day.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EM_DASH,
  formatDate,
  formatDateTime,
  formatNumber,
  formatCurrency,
  formatWeight,
  formatGmd,
  formatPercent,
  parseCurrencyToCents,
  formatStockingRate,
  formatArrobas,
  formatAge,
} from '../../src/lib/format.js';

test('formatDate renders ISO dates as dd/MM/yyyy', () => {
  assert.equal(formatDate('2026-03-15'), '15/03/2026');
  assert.equal(formatDate('2026-01-01'), '01/01/2026');
  assert.equal(formatDate('2025-12-31'), '31/12/2025');
});

test('formatDate does not shift the day across timezones', () => {
  // new Date('2026-03-01') is UTC midnight, which is 28/02 in Brazil (UTC-3).
  // Splitting the string instead of parsing it is what prevents that.
  assert.equal(formatDate('2026-03-01'), '01/03/2026');
  assert.equal(formatDate('2026-01-01T00:00:00.000Z'), '01/01/2026');
});

test('formatDate returns an em dash for missing or malformed input', () => {
  assert.equal(formatDate(null), EM_DASH);
  assert.equal(formatDate(undefined), EM_DASH);
  assert.equal(formatDate(''), EM_DASH);
  assert.equal(formatDate('15/03/2026'), EM_DASH);
  assert.equal(formatDate('not a date'), EM_DASH);
});

test('formatDateTime appends HH:mm when a time is present', () => {
  assert.equal(formatDateTime('2026-03-15T14:30:00.000Z'), '15/03/2026 14:30');
  assert.equal(formatDateTime('2026-03-15 08:05:00'), '15/03/2026 08:05');
  assert.equal(formatDateTime('2026-03-15'), '15/03/2026');
  assert.equal(formatDateTime(null), EM_DASH);
});

test('formatNumber uses dot for thousands and comma for decimals', () => {
  assert.equal(formatNumber(1234, 0), '1.234');
  assert.equal(formatNumber(1234.5, 1), '1.234,5');
  assert.equal(formatNumber(1234567.89, 2), '1.234.567,89');
  assert.equal(formatNumber(0, 0), '0');
});

test('formatNumber returns an em dash rather than NaN', () => {
  assert.equal(formatNumber(null), EM_DASH);
  assert.equal(formatNumber(undefined), EM_DASH);
  assert.equal(formatNumber(Number.NaN), EM_DASH);
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), EM_DASH);
});

test('formatCurrency converts centavos to R$ with pt-BR separators', () => {
  // Intl uses a non-breaking space after the currency symbol.
  assert.equal(formatCurrency(123456).replace(/ /g, ' '), 'R$ 1.234,56');
  assert.equal(formatCurrency(0).replace(/ /g, ' '), 'R$ 0,00');
  assert.equal(formatCurrency(5).replace(/ /g, ' '), 'R$ 0,05');
});

test('formatCurrency distinguishes no data from a genuine zero', () => {
  // A real zero renders as R$ 0,00; absent data renders as an em dash. The
  // dashboard relies on this distinction for the "Custos do mes" card.
  assert.equal(formatCurrency(null), EM_DASH);
  assert.notEqual(formatCurrency(0), EM_DASH);
});

test('formatWeight and formatGmd append their units', () => {
  assert.equal(formatWeight(1234.5), '1.234,5 kg');
  assert.equal(formatWeight(480), '480,0 kg');
  assert.equal(formatWeight(null), EM_DASH);

  assert.equal(formatGmd(0.85), '0,850 kg/dia');
  assert.equal(formatGmd(1.234), '1,234 kg/dia');
  assert.equal(formatGmd(null), EM_DASH);
});

test('formatPercent, formatStockingRate and formatArrobas append their units', () => {
  assert.equal(formatPercent(53.25), '53,3%');
  assert.equal(formatPercent(null), EM_DASH);

  assert.equal(formatStockingRate(1.25), '1,25 UA/ha');
  assert.equal(formatStockingRate(null), EM_DASH);

  assert.equal(formatArrobas(18.5), '18,50 @');
  assert.equal(formatArrobas(null), EM_DASH);
});

test('formatAge reports years and months from a birth date', () => {
  assert.equal(formatAge('2024-03-15', '2026-07-15'), '2a 4m');
  assert.equal(formatAge('2026-01-10', '2026-08-03'), '6m');
  assert.equal(formatAge('2024-08-03', '2026-08-03'), '2a');
  assert.equal(formatAge(null), EM_DASH);
});

test('formatAge does not count a month that has not completed', () => {
  // On 14/07 the animal has not yet reached 4 full months since 15/03.
  assert.equal(formatAge('2026-03-15', '2026-07-14'), '3m');
  assert.equal(formatAge('2026-03-15', '2026-07-15'), '4m');
});

test('parseCurrencyToCents reads pt-BR notation with thousands and decimal separators', () => {
  assert.equal(parseCurrencyToCents('1.500,00'), 150000);
  assert.equal(parseCurrencyToCents('1.234.567,89'), 123456789);
  assert.equal(parseCurrencyToCents('R$ 1.500,00'), 150000, 'the currency symbol is stripped');
});

test('parseCurrencyToCents accepts a bare integer or plain decimal', () => {
  assert.equal(parseCurrencyToCents('1500'), 150000);
  assert.equal(parseCurrencyToCents('1500.5'), 150050);
});

test('parseCurrencyToCents round-trips with formatCurrency', () => {
  assert.equal(parseCurrencyToCents(formatCurrency(150000).replace(/ /g, ' ')), 150000);
});

test('parseCurrencyToCents returns null for empty or unparsable input', () => {
  assert.equal(parseCurrencyToCents(''), null);
  assert.equal(parseCurrencyToCents('   '), null);
  assert.equal(parseCurrencyToCents(null), null);
  assert.equal(parseCurrencyToCents(undefined), null);
  assert.equal(parseCurrencyToCents('abc'), null);
});

test('parseCurrencyToCents rounds to the nearest centavo', () => {
  assert.equal(parseCurrencyToCents('10,005'), 1001);
});
