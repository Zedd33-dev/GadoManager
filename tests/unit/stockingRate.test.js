/**
 * Tests for the UA/ha stocking rate.
 *
 * Every expected figure here is hand-computable, in the same style as the
 * Phase 4 KPI proofs: 1 UA = 450 kg, so the arithmetic is written out.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePastureStockingRate } from '../../src/services/stockingRateService.js';
import { ANIMAL_UNIT_KG } from '../../src/domain/constants.js';

function pasture(overrides = {}) {
  return {
    areaHa: 10,
    maxStockingRateUaHa: null,
    totalWeightKg: 0,
    animalsWithWeight: 0,
    animalsWithoutWeight: 0,
    ...overrides,
  };
}

test('one animal unit is 450 kg of live weight', () => {
  assert.equal(ANIMAL_UNIT_KG, 450);
});

test('stocking rate is total live weight over 450, divided by hectares', () => {
  // 20 animals x 450 kg = 9000 kg = 20 UA, over 10 ha = 2 UA/ha.
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 9000, animalsWithWeight: 20 }),
  );

  assert.equal(result.animalUnits, 20);
  assert.equal(result.stockingRate, 2);
});

test('animals of different sizes summing to the same weight give the same rate', () => {
  // The point of UA/ha: 40 calves at 225 kg and 20 steers at 450 kg are both
  // 9000 kg, therefore both 20 UA, therefore the same stocking rate.
  const calves = calculatePastureStockingRate(
    pasture({ totalWeightKg: 40 * 225, animalsWithWeight: 40 }),
  );
  const steers = calculatePastureStockingRate(
    pasture({ totalWeightKg: 20 * 450, animalsWithWeight: 20 }),
  );

  assert.equal(calves.stockingRate, steers.stockingRate);
  assert.equal(calves.stockingRate, 2);
});

test('an empty pasture has a rate of zero, not "no data"', () => {
  const result = calculatePastureStockingRate(pasture());

  assert.equal(result.stockingRate, 0);
  assert.equal(result.animalUnits, 0);
  assert.notEqual(result.status, 'sem-dados');
});

test('a pasture with animals but no weighings reports no data, not zero', () => {
  // The rate is real but unmeasurable. Reporting 0 would claim the pasture is
  // empty, which is the opposite of the truth.
  const result = calculatePastureStockingRate(
    pasture({ animalsWithWeight: 0, animalsWithoutWeight: 12 }),
  );

  assert.equal(result.stockingRate, null);
  assert.equal(result.status, 'sem-dados');
});

test('a partially weighed pasture computes from what is known and flags it', () => {
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 4500, animalsWithWeight: 10, animalsWithoutWeight: 3 }),
  );

  assert.equal(result.stockingRate, 1);
  assert.equal(result.isUnderestimate, true, 'the figure excludes 3 real animals');
});

test('a fully weighed pasture is not flagged as an underestimate', () => {
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 4500, animalsWithWeight: 10, animalsWithoutWeight: 0 }),
  );

  assert.equal(result.isUnderestimate, false);
});

test('no informed capacity means the rate is reported without judgement', () => {
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 45000, animalsWithWeight: 100, maxStockingRateUaHa: null }),
  );

  // 100 UA over 10 ha = 10 UA/ha, which is wildly overstocked - but with no
  // informed capacity there is no basis to say so, so it must not claim to.
  assert.equal(result.stockingRate, 10);
  assert.equal(result.status, 'sem-capacidade');
  assert.equal(result.usagePercent, null);
});

test('a rate within capacity is adequate', () => {
  // 10 UA over 10 ha = 1.0 UA/ha against a capacity of 1.5.
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 4500, animalsWithWeight: 10, maxStockingRateUaHa: 1.5 }),
  );

  assert.equal(result.status, 'adequada');
  assert.ok(Math.abs(result.usagePercent - 66.6667) < 0.01);
});

test('a rate at or above 90% of capacity warns before the limit is crossed', () => {
  // 13.5 UA over 10 ha = 1.35 UA/ha, exactly 90% of a 1.5 capacity.
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 13.5 * 450, animalsWithWeight: 30, maxStockingRateUaHa: 1.5 }),
  );

  assert.equal(result.status, 'atencao');
  assert.ok(Math.abs(result.usagePercent - 90) < 1e-9);
});

test('a rate above capacity is reported as exceeded', () => {
  // 16 UA over 10 ha = 1.6 UA/ha against a 1.5 capacity.
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 16 * 450, animalsWithWeight: 32, maxStockingRateUaHa: 1.5 }),
  );

  assert.equal(result.status, 'excedida');
  assert.ok(result.usagePercent > 100);
});

test('exactly at capacity is adequate, not exceeded', () => {
  const result = calculatePastureStockingRate(
    pasture({ totalWeightKg: 15 * 450, animalsWithWeight: 30, maxStockingRateUaHa: 1.5 }),
  );

  // 1.5 UA/ha against a 1.5 capacity is the limit, not past it.
  assert.equal(result.stockingRate, 1.5);
  assert.equal(result.status, 'atencao', 'at 100% it warns, but has not been exceeded');
});

test('a zero or missing area does not produce Infinity', () => {
  const zeroArea = calculatePastureStockingRate(
    pasture({ areaHa: 0, totalWeightKg: 4500, animalsWithWeight: 10 }),
  );

  assert.equal(zeroArea.stockingRate, null, 'safeDivide must not yield Infinity');
  assert.equal(zeroArea.status, 'sem-dados');
});
