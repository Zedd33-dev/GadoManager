/**
 * Tests for the safe arithmetic helpers.
 *
 * The contract under test: a calculation with no meaningful answer returns
 * null, never NaN, Infinity or a misleading zero.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeDivide, safeAverage, safePercent, safeSum } from '../../src/lib/safeMath.js';

test('safeDivide performs ordinary division', () => {
  assert.equal(safeDivide(10, 4), 2.5);
  assert.equal(safeDivide(-9, 3), -3);
  assert.equal(safeDivide(0, 5), 0);
});

test('safeDivide returns null instead of Infinity or NaN', () => {
  assert.equal(safeDivide(5, 0), null);
  assert.equal(safeDivide(0, 0), null);
  assert.equal(safeDivide(-5, 0), null);
});

test('safeDivide returns null for missing operands', () => {
  assert.equal(safeDivide(null, 5), null);
  assert.equal(safeDivide(5, null), null);
  assert.equal(safeDivide(undefined, undefined), null);
  assert.equal(safeDivide(Number.NaN, 5), null);
});

test('safeAverage ignores missing entries', () => {
  assert.equal(safeAverage([2, 4, 6]), 4);
  assert.equal(safeAverage([2, null, 6]), 4);
  assert.equal(safeAverage([10, undefined]), 10);
});

test('safeAverage returns null for an empty or fully-missing list', () => {
  // This is the rule that keeps single-weighing animals from dragging the
  // herd GMD toward zero: no usable values means "no answer", not "zero".
  assert.equal(safeAverage([]), null);
  assert.equal(safeAverage([null, undefined]), null);
  assert.equal(safeAverage(null), null);
});

test('safeAverage does distinguish a real zero average', () => {
  assert.equal(safeAverage([0, 0]), 0);
  assert.notEqual(safeAverage([0, 0]), null);
});

test('safePercent expresses a part on the 0-100 scale', () => {
  assert.equal(safePercent(25, 100), 25);
  assert.equal(safePercent(1, 4), 25);
  assert.equal(safePercent(0, 10), 0);
});

test('safePercent returns null when the total is zero or missing', () => {
  assert.equal(safePercent(5, 0), null);
  assert.equal(safePercent(5, null), null);
});

test('safeSum returns zero for an empty list', () => {
  // Deliberately different from safeAverage: a sum over no records genuinely
  // is zero. Callers needing to distinguish "no records" check the count.
  assert.equal(safeSum([]), 0);
  assert.equal(safeSum([1, 2, 3]), 6);
  assert.equal(safeSum([1, null, 3]), 4);
  assert.equal(safeSum(null), 0);
});
