import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFarmInput,
  validateLotInput,
  validatePastureInput,
  BRAZILIAN_STATES,
} from '../../src/services/structureService.js';

const empty = { isDeactivating: false, occupantCount: 0 };

// ---------------------------------------------------------------------------
// Fazenda
// ---------------------------------------------------------------------------

test('a farm requires a name', () => {
  assert.match(validateFarmInput({ name: '  ' }).errors.name, /Informe o nome/);
});

test('a farm accepts a valid UF and rejects an invalid one', () => {
  assert.equal(validateFarmInput({ name: 'F', state: 'ms' }).data.state, 'MS', 'UF is upper-cased');
  assert.match(validateFarmInput({ name: 'F', state: 'XX' }).errors.state, /UF inválida/);
  assert.equal(BRAZILIAN_STATES.length, 27, '26 states plus the Federal District');
});

test('a farm area, when given, must be positive', () => {
  assert.match(validateFarmInput({ name: 'F', totalAreaHa: '0' }).errors.totalAreaHa, /maior que zero/);
  assert.match(validateFarmInput({ name: 'F', totalAreaHa: '-5' }).errors.totalAreaHa, /maior que zero/);
  assert.equal(validateFarmInput({ name: 'F', totalAreaHa: '1.240,5' }).data.totalAreaHa, 1240.5);
});

test('a farm area is optional', () => {
  const result = validateFarmInput({ name: 'Fazenda Nova' });
  assert.equal(result.ok, true);
  assert.equal(result.data.totalAreaHa, null);
});

// ---------------------------------------------------------------------------
// Lote
// ---------------------------------------------------------------------------

test('a lot requires a name', () => {
  assert.match(validateLotInput({ name: '' }, empty).errors.name, /Informe o nome/);
});

test('a lot holding animals cannot be deactivated', () => {
  const result = validateLotInput(
    { name: 'Recria', active: undefined },
    { isDeactivating: true, occupantCount: 12 },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.active, /12 animal/);
  assert.match(result.errors.active, /Movimente/);
});

test('an empty lot can be deactivated', () => {
  const result = validateLotInput({ name: 'Recria' }, { isDeactivating: true, occupantCount: 0 });

  assert.equal(result.ok, true);
  assert.equal(result.data.active, false);
});

test('the active checkbox is read from its HTML form value', () => {
  // An unchecked checkbox posts nothing at all, so absence means false.
  assert.equal(validateLotInput({ name: 'L', active: 'on' }, empty).data.active, true);
  assert.equal(validateLotInput({ name: 'L' }, empty).data.active, false);
});

// ---------------------------------------------------------------------------
// Pasto
// ---------------------------------------------------------------------------

test('a pasture requires a strictly positive area', () => {
  // Area is the denominator of UA/ha, so zero would make the rate meaningless.
  assert.match(validatePastureInput({ name: 'P' }, empty).errors.areaHa, /Informe a área/);
  assert.match(validatePastureInput({ name: 'P', areaHa: '0' }, empty).errors.areaHa, /maior que zero/);
  assert.match(validatePastureInput({ name: 'P', areaHa: '-3' }, empty).errors.areaHa, /maior que zero/);
});

test('a pasture area accepts pt-BR decimal notation', () => {
  const result = validatePastureInput({ name: 'P', areaHa: '120,5' }, empty);
  assert.equal(result.data.areaHa, 120.5);
});

test('carrying capacity is optional but must be positive when given', () => {
  const withoutCapacity = validatePastureInput({ name: 'P', areaHa: '10' }, empty);
  assert.equal(withoutCapacity.ok, true);
  assert.equal(withoutCapacity.data.maxStockingRateUaHa, null);

  const invalid = validatePastureInput(
    { name: 'P', areaHa: '10', maxStockingRateUaHa: '0' },
    empty,
  );
  assert.match(invalid.errors.maxStockingRateUaHa, /maior que zero/);

  const valid = validatePastureInput(
    { name: 'P', areaHa: '10', maxStockingRateUaHa: '1,5' },
    empty,
  );
  assert.equal(valid.data.maxStockingRateUaHa, 1.5);
});

test('rest period must be a non-negative whole number of days', () => {
  assert.match(
    validatePastureInput({ name: 'P', areaHa: '10', restPeriodDays: '-1' }, empty).errors.restPeriodDays,
    /dias válido/,
  );
  assert.equal(
    validatePastureInput({ name: 'P', areaHa: '10', restPeriodDays: '30' }, empty).data.restPeriodDays,
    30,
  );
});

test('a pasture holding animals cannot be deactivated', () => {
  const result = validatePastureInput(
    { name: 'P', areaHa: '10' },
    { isDeactivating: true, occupantCount: 5 },
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.active, /5 animal/);
});
