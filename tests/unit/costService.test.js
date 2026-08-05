import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCostInput, expandRecurrence } from '../../src/services/costService.js';

const context = { validCategorySlugs: new Set(['alimentacao', 'sanidade']), validLotIds: new Set([1, 2]) };

function validInput(overrides = {}) {
  return { categorySlug: 'alimentacao', costDate: '2026-07-01', amount: '1.500,00', ...overrides };
}

test('a valid cost passes and normalises the amount to centavos', () => {
  const result = validateCostInput(validInput(), context);

  assert.equal(result.ok, true);
  assert.equal(result.data.amountCents, 150000);
});

test('an unknown category is rejected', () => {
  const result = validateCostInput(validInput({ categorySlug: 'nao-existe' }), context);
  assert.match(result.errors.categorySlug, /Selecione/);
});

test('the cost date must be valid and not in the future', () => {
  assert.match(validateCostInput(validInput({ costDate: '01/07/2026' }), context).errors.costDate, /válida/);
  assert.match(validateCostInput(validInput({ costDate: '2099-01-01' }), context).errors.costDate, /futura/);
});

test('the amount must be a positive value', () => {
  assert.match(validateCostInput(validInput({ amount: '0' }), context).errors.amount, /maior que zero/);
  assert.match(validateCostInput(validInput({ amount: '' }), context).errors.amount, /maior que zero/);
});

test('a lot must belong to the pre-approved set', () => {
  assert.match(validateCostInput(validInput({ lotId: '999' }), context).errors.lotId, /inválido/);
  assert.equal(validateCostInput(validInput({ lotId: '1' }), context).data.lotId, 1);
});

test('a farm-wide cost (no lot) is valid', () => {
  const result = validateCostInput(validInput(), context);
  assert.equal(result.ok, true);
  assert.equal(result.data.lotId, null);
});

test('a recurring cost requires an interval and a repetition count', () => {
  const noInterval = validateCostInput(validInput({ isRecurring: 'on', occurrences: '12' }), context);
  assert.ok(noInterval.errors.recurrenceMonths);

  const noCount = validateCostInput(
    validInput({ isRecurring: 'on', recurrenceMonths: '1' }),
    context,
  );
  assert.ok(noCount.errors.occurrences);

  const valid = validateCostInput(
    validInput({ isRecurring: 'on', recurrenceMonths: '1', occurrences: '12' }),
    context,
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.occurrences, 12);
});

test('recurring occurrences are capped to prevent an unbounded batch', () => {
  const result = validateCostInput(
    validInput({ isRecurring: 'on', recurrenceMonths: '1', occurrences: '999' }),
    context,
  );
  assert.ok(result.errors.occurrences);
});

test('a non-recurring cost expands to exactly its own date', () => {
  const result = validateCostInput(validInput(), context);
  const rows = expandRecurrence(result.data, 1);

  assert.deepEqual(rows, [{ costDate: '2026-07-01' }]);
});

test('a recurring cost expands into evenly spaced monthly rows', () => {
  const result = validateCostInput(
    validInput({ isRecurring: 'on', recurrenceMonths: '1', occurrences: '3' }),
    context,
  );
  const rows = expandRecurrence(result.data, 3);

  assert.deepEqual(rows.map((r) => r.costDate), ['2026-07-01', '2026-08-01', '2026-09-01']);
});

test('a quarterly recurrence skips two months between rows', () => {
  const result = validateCostInput(
    validInput({ isRecurring: 'on', recurrenceMonths: '3', occurrences: '3' }),
    context,
  );
  const rows = expandRecurrence(result.data, 3);

  assert.deepEqual(rows.map((r) => r.costDate), ['2026-07-01', '2026-10-01', '2027-01-01']);
});
