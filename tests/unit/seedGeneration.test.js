/**
 * Tests for the demo-seed generators.
 *
 * Reproducibility is the property that matters most here: `npm run seed` must
 * produce the same herd every time, or screenshots in the written thesis will
 * disagree with the running system and a defect found during the defense will
 * not be reproducible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, createGenerator } from '../../seeds/lib/random.js';
import { buildWeightCurve } from '../../seeds/lib/growth.js';
import { addDays, addMonths, daysBetween, todayIso } from '../../src/lib/dates.js';

test('the same seed produces the same sequence', () => {
  const first = createRandom(12345);
  const second = createRandom(12345);

  for (let i = 0; i < 200; i += 1) {
    assert.equal(first(), second(), `sequences diverged at draw ${i}`);
  }
});

test('different seeds produce different sequences', () => {
  const a = createRandom(1);
  const b = createRandom(2);

  const drawsA = Array.from({ length: 50 }, a);
  const drawsB = Array.from({ length: 50 }, b);

  assert.notDeepEqual(drawsA, drawsB);
});

test('draws stay within the unit interval', () => {
  const random = createRandom(999);

  for (let i = 0; i < 5000; i += 1) {
    const value = random();
    assert.ok(value >= 0 && value < 1, `draw out of range: ${value}`);
  }
});

test('int is inclusive at both ends and never escapes the range', () => {
  const gen = createGenerator(42);
  const seen = new Set();

  for (let i = 0; i < 3000; i += 1) {
    const value = gen.int(1, 6);
    assert.ok(Number.isInteger(value));
    assert.ok(value >= 1 && value <= 6, `out of range: ${value}`);
    seen.add(value);
  }

  assert.equal(seen.size, 6, 'every value in the range should occur');
});

test('pickWeighted respects the weights', () => {
  const gen = createGenerator(7);
  const counts = { nelore: 0, angus: 0 };

  for (let i = 0; i < 4000; i += 1) {
    counts[gen.pickWeighted([['nelore', 9], ['angus', 1]])] += 1;
  }

  // Roughly 90/10. Loose bounds, since this is a statistical property.
  assert.ok(counts.nelore > counts.angus * 5, `expected a strong skew, got ${JSON.stringify(counts)}`);
});

test('shuffle preserves every element', () => {
  const gen = createGenerator(3);
  const original = Array.from({ length: 40 }, (_, i) => i);
  const shuffled = gen.shuffle(original);

  assert.equal(shuffled.length, original.length);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), original);
  assert.notDeepEqual(shuffled, original, 'a 40-element shuffle should reorder');
});

// ---------------------------------------------------------------------------
// Growth model
// ---------------------------------------------------------------------------

const baseAnimal = {
  birthDate: addMonths(todayIso(), -24),
  breed: 'nelore',
  sex: 'M',
  isFinishing: false,
  individualFactor: 1,
};

test('a weight curve starts at the breed birth weight', () => {
  const curve = buildWeightCurve(baseAnimal, todayIso());
  assert.equal(curve.weightOn(baseAnimal.birthDate), 30);

  const angus = buildWeightCurve({ ...baseAnimal, breed: 'angus' }, todayIso());
  assert.equal(angus.weightOn(baseAnimal.birthDate), 33);
});

test('a weight curve returns null outside the animal\'s life', () => {
  const curve = buildWeightCurve(baseAnimal, todayIso());

  assert.equal(curve.weightOn(addDays(baseAnimal.birthDate, -1)), null);
  assert.equal(curve.weightOn(addDays(todayIso(), 1)), null);
});

test('a two-year-old steer reaches a plausible weight', () => {
  const curve = buildWeightCurve(baseAnimal, todayIso());
  const weight = curve.weightOn(todayIso());

  // A Nelore steer on pasture at 24 months: roughly 300-450 kg.
  assert.ok(weight > 280 && weight < 470, `implausible weight at 24 months: ${weight}`);
});

test('weight never exceeds the mature ceiling', () => {
  const old = {
    ...baseAnimal,
    birthDate: addMonths(todayIso(), -84),
    individualFactor: 1.2,
  };
  const curve = buildWeightCurve(old, todayIso());

  // Ceiling for a Nelore male is 600 kg; the taper must keep growth below it.
  assert.ok(curve.finalWeight < 600, `exceeded ceiling: ${curve.finalWeight}`);
});

test('finishing animals outgrow pasture animals of the same age', () => {
  const pasture = buildWeightCurve(baseAnimal, todayIso());
  const finishing = buildWeightCurve({ ...baseAnimal, isFinishing: true }, todayIso());

  assert.ok(
    finishing.finalWeight > pasture.finalWeight,
    `finishing ${finishing.finalWeight} should exceed pasture ${pasture.finalWeight}`,
  );
});

test('the dry season depresses gain on pasture', () => {
  // Compare gain across a wet-season window against a dry-season window for the
  // same animal. This is the effect that gives the GMD curve its shape.
  const birthDate = '2024-01-10';
  const curve = buildWeightCurve({ ...baseAnimal, birthDate }, '2026-01-10');

  const gainOver = (from, to) =>
    (curve.weightOn(to) - curve.weightOn(from)) / daysBetween(from, to);

  const wetGain = gainOver('2025-11-15', '2026-01-10'); // rains
  const dryGain = gainOver('2025-06-15', '2025-08-15'); // seca

  assert.ok(dryGain < wetGain, `dry ${dryGain} should be below wet ${wetGain}`);
  assert.ok(dryGain < wetGain * 0.75, 'the dry-season drop should be pronounced');
});

test('individual factor separates animals of identical genetics and age', () => {
  const slow = buildWeightCurve({ ...baseAnimal, individualFactor: 0.85 }, todayIso());
  const fast = buildWeightCurve({ ...baseAnimal, individualFactor: 1.15 }, todayIso());

  assert.ok(fast.finalWeight > slow.finalWeight * 1.1, 'the herd should spread around the mean');
});
