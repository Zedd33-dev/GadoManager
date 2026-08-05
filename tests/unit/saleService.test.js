import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSaleValue,
  estimateAccumulatedCost,
  validateSaleItem,
  validateSaleHeader,
} from '../../src/services/saleService.js';

const TODAY = '2026-08-03';

// ---------------------------------------------------------------------------
// Arroba conversion
// ---------------------------------------------------------------------------

test('arrobas are computed on carcass weight, not live weight', () => {
  // 510 kg live, 54% yield -> 275.4 kg carcass -> 18.36 @.
  const result = calculateSaleValue(510, 54, 32000);

  assert.equal(result.arrobas, 18.36);
});

test('gross value is arrobas times the price per arroba', () => {
  const result = calculateSaleValue(510, 54, 32000);

  // 18.36 @ * R$320,00 = R$5.875,20 = 587520 centavos.
  assert.equal(result.grossValueCents, 587520);
});

test('a higher yield produces more arrobas from the same live weight', () => {
  const low = calculateSaleValue(500, 50, 30000);
  const high = calculateSaleValue(500, 56, 30000);

  assert.ok(high.arrobas > low.arrobas);
});

// ---------------------------------------------------------------------------
// Accumulated cost estimate
// ---------------------------------------------------------------------------

test('a purchased animal starts from its purchase price', () => {
  const result = estimateAccumulatedCost({
    originDate: '2026-06-01',
    saleDate: '2026-06-01',
    purchasePriceCents: 300000,
    farmTotalCostsCents: 0,
    farmAverageActiveAnimals: 100,
  });

  assert.equal(result.estimatedAccumulatedCostCents, 300000, 'zero tenure, only the purchase price');
});

test('a born-on-farm animal starts from zero, not null', () => {
  const result = estimateAccumulatedCost({
    originDate: '2026-06-01',
    saleDate: '2026-06-01',
    purchasePriceCents: null,
    farmTotalCostsCents: 0,
    farmAverageActiveAnimals: 100,
  });

  assert.equal(result.estimatedAccumulatedCostCents, 0);
});

test('upkeep accrues by tenure in months at the farm\'s average cost per animal', () => {
  // One year of tenure, R$ 120.000,00 total farm cost over that window, 100
  // head average -> R$ 1.000,00/animal-month -> ~12 months = ~R$ 12.000,00.
  const result = estimateAccumulatedCost({
    originDate: '2025-08-03',
    saleDate: '2026-08-03',
    purchasePriceCents: null,
    farmTotalCostsCents: 12_000_000,
    farmAverageActiveAnimals: 100,
  });

  assert.ok(Math.abs(result.tenureMonths - 12) < 0.1);
  assert.equal(result.monthlyCostPerAnimalCents, 120_000);
  assert.ok(Math.abs(result.estimatedAccumulatedCostCents - 1_440_000) < 5000);
});

test('a longer tenure produces a larger estimated cost, same monthly rate', () => {
  const shortTenure = estimateAccumulatedCost({
    originDate: '2026-07-03',
    saleDate: '2026-08-03',
    purchasePriceCents: null,
    farmTotalCostsCents: 1_200_000,
    farmAverageActiveAnimals: 100,
  });
  const longTenure = estimateAccumulatedCost({
    originDate: '2025-08-03',
    saleDate: '2026-08-03',
    purchasePriceCents: null,
    farmTotalCostsCents: 1_200_000,
    farmAverageActiveAnimals: 100,
  });

  assert.ok(longTenure.estimatedAccumulatedCostCents > shortTenure.estimatedAccumulatedCostCents);
});

test('an undefined average headcount does not throw or produce Infinity', () => {
  const result = estimateAccumulatedCost({
    originDate: '2025-08-03',
    saleDate: '2026-08-03',
    purchasePriceCents: null,
    farmTotalCostsCents: 1_200_000,
    farmAverageActiveAnimals: 0,
  });

  assert.equal(result.monthlyCostPerAnimalCents, null);
  assert.equal(result.estimatedAccumulatedCostCents, 0, 'no purchase price and no computable upkeep');
});

// ---------------------------------------------------------------------------
// Sale item validation - including the carência integration point
// ---------------------------------------------------------------------------

const activeAnimal = { id: 1, ear_tag: 'BV-0001', status: 'ativo' };
const clear = { isUnderWithdrawal: false };

test('a valid sale item passes', () => {
  const result = validateSaleItem({ liveWeightKg: '510', carcassYieldPct: '54' }, activeAnimal, clear);
  assert.equal(result.ok, true);
  assert.equal(result.data.liveWeightKg, 510);
});

test('an already-sold or otherwise inactive animal cannot be sold', () => {
  const result = validateSaleItem(
    { liveWeightKg: '510', carcassYieldPct: '54' },
    { ...activeAnimal, status: 'vendido' },
    clear,
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.animal, /não está ativo/);
});

test('an animal under withdrawal cannot be sold, and the message names the release date', () => {
  const result = validateSaleItem(
    { liveWeightKg: '510', carcassYieldPct: '54' },
    activeAnimal,
    { isUnderWithdrawal: true, releaseDate: '2026-08-31', blockingEventName: 'Vermífugo' },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.animal, /carência/);
  assert.match(result.errors.animal, /2026-08-31/);
  assert.match(result.errors.animal, /Vermífugo/);
});

test('carcass yield outside 40-65% is rejected, matching the schema constraint', () => {
  assert.equal(
    validateSaleItem({ liveWeightKg: '510', carcassYieldPct: '39' }, activeAnimal, clear).ok,
    false,
  );
  assert.equal(
    validateSaleItem({ liveWeightKg: '510', carcassYieldPct: '66' }, activeAnimal, clear).ok,
    false,
  );
  assert.equal(
    validateSaleItem({ liveWeightKg: '510', carcassYieldPct: '54' }, activeAnimal, clear).ok,
    true,
  );
});

test('live weight must be present and positive', () => {
  assert.equal(
    validateSaleItem({ liveWeightKg: '0', carcassYieldPct: '54' }, activeAnimal, clear).ok,
    false,
  );
  assert.equal(
    validateSaleItem({ liveWeightKg: '', carcassYieldPct: '54' }, activeAnimal, clear).ok,
    false,
  );
});

// ---------------------------------------------------------------------------
// Sale header validation
// ---------------------------------------------------------------------------

test('a valid sale header passes and normalises the price to centavos', () => {
  const result = validateSaleHeader(
    { buyerName: 'Frigorífico Teste', saleDate: '2026-07-01', pricePerArroba: '320,00' },
    { today: TODAY },
  );

  assert.equal(result.ok, true);
  assert.equal(result.data.pricePerArrobaCents, 32000);
});

test('a sale requires a buyer and may not be dated in the future', () => {
  assert.match(
    validateSaleHeader({ saleDate: '2026-07-01', pricePerArroba: '320' }, { today: TODAY }).errors.buyerName,
    /Informe o comprador/,
  );
  assert.match(
    validateSaleHeader(
      { buyerName: 'X', saleDate: '2099-01-01', pricePerArroba: '320' },
      { today: TODAY },
    ).errors.saleDate,
    /futura/,
  );
});

test('a sale requires at least one item', () => {
  const result = validateSaleHeader(
    { buyerName: 'X', saleDate: '2026-07-01', pricePerArroba: '320' },
    { today: TODAY, hasItems: false },
  );

  assert.equal(result.ok, false);
  assert.ok(result.errors.items);
});
