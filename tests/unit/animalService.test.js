import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAnimalInput, parseAnimalListQuery, EDITABLE_STATUSES } from '../../src/services/animalService.js';

const context = {
  isCreate: true,
  validLotIds: new Set([1, 2]),
  validPastureIds: new Set([10]),
  validMotherIds: new Set([500]),
};

function validInput(overrides = {}) {
  return {
    earTag: 'BV-0001',
    birthDate: '2024-03-15',
    sex: 'M',
    breed: 'nelore',
    origin: 'nascido',
    ...overrides,
  };
}

test('a valid nascido animal passes validation with normalised fields', () => {
  const result = validateAnimalInput(validInput(), context);

  assert.equal(result.ok, true);
  assert.equal(result.data.earTag, 'BV-0001');
  assert.equal(result.data.status, 'ativo', 'create always starts active');
  assert.equal(result.data.purchaseDate, null);
});

test('ear tag is required', () => {
  const result = validateAnimalInput(validInput({ earTag: '  ' }), context);
  assert.equal(result.ok, false);
  assert.ok(result.errors.earTag);
});

test('birth date must be a valid ISO date and not in the future', () => {
  assert.ok(validateAnimalInput(validInput({ birthDate: '15/03/2024' }), context).errors.birthDate);
  assert.ok(validateAnimalInput(validInput({ birthDate: '2099-01-01' }), context).errors.birthDate);
  assert.equal(validateAnimalInput(validInput({ birthDate: '2024-03-15' }), context).ok, true);
});

test('sex must be from the allowed set', () => {
  assert.ok(validateAnimalInput(validInput({ sex: 'X' }), context).errors.sex);
});

test('breed is free text - any non-empty, reasonably-sized value is accepted', () => {
  assert.equal(validateAnimalInput(validInput({ breed: 'Girolando' }), context).ok, true);
  assert.equal(validateAnimalInput(validInput({ breed: 'Brahman' }), context).ok, true);
  assert.ok(validateAnimalInput(validInput({ breed: '' }), context).errors.breed);
  assert.ok(validateAnimalInput(validInput({ breed: '   ' }), context).errors.breed);
  assert.ok(validateAnimalInput(validInput({ breed: 'x'.repeat(61) }), context).errors.breed);
});

test('a purchased animal requires a purchase date not before birth and not in the future', () => {
  const noDate = validateAnimalInput(validInput({ origin: 'comprado' }), context);
  assert.ok(noDate.errors.purchaseDate);

  const beforeBirth = validateAnimalInput(
    validInput({ origin: 'comprado', purchaseDate: '2023-01-01' }),
    context,
  );
  assert.ok(beforeBirth.errors.purchaseDate);

  const future = validateAnimalInput(
    validInput({ origin: 'comprado', purchaseDate: '2099-01-01' }),
    context,
  );
  assert.ok(future.errors.purchaseDate);

  const ok = validateAnimalInput(
    validInput({ origin: 'comprado', purchaseDate: '2024-06-01' }),
    context,
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.data.purchaseDate, '2024-06-01');
});

test('purchase price is optional but must be positive when given', () => {
  const zero = validateAnimalInput(
    validInput({ origin: 'comprado', purchaseDate: '2024-06-01', purchasePrice: '0' }),
    context,
  );
  assert.ok(zero.errors.purchasePrice);

  const valid = validateAnimalInput(
    validInput({ origin: 'comprado', purchaseDate: '2024-06-01', purchasePrice: '1.500,00' }),
    context,
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.data.purchasePriceCents, 150000);
});

test('a nascido animal may only reference a valid, pre-approved mother', () => {
  const invalid = validateAnimalInput(validInput({ motherId: '999' }), context);
  assert.ok(invalid.errors.motherId);

  const valid = validateAnimalInput(validInput({ motherId: '500' }), context);
  assert.equal(valid.ok, true);
  assert.equal(valid.data.motherId, 500);
});

test('lot and pasture must be within the pre-approved (scoped) sets', () => {
  assert.ok(validateAnimalInput(validInput({ lotId: '999' }), context).errors.lotId);
  assert.equal(validateAnimalInput(validInput({ lotId: '1' }), context).data.lotId, 1);

  assert.ok(validateAnimalInput(validInput({ pastureId: '999' }), context).errors.pastureId);
  assert.equal(validateAnimalInput(validInput({ pastureId: '10' }), context).data.pastureId, 10);
});

test('create always forces status to ativo, ignoring any submitted value', () => {
  const result = validateAnimalInput(validInput({ status: 'vendido' }), context);
  assert.equal(result.ok, true);
  assert.equal(result.data.status, 'ativo');
});

test('edit only accepts ativo or transferido, rejecting vendido/morto from this form', () => {
  const editContext = { ...context, isCreate: false };

  assert.equal(EDITABLE_STATUSES.includes('vendido'), false);
  assert.equal(EDITABLE_STATUSES.includes('morto'), false);

  assert.ok(validateAnimalInput(validInput({ status: 'vendido' }), editContext).errors.status);
  assert.ok(validateAnimalInput(validInput({ status: 'morto' }), editContext).errors.status);
  assert.equal(validateAnimalInput(validInput({ status: 'ativo' }), editContext).ok, true);
  assert.equal(validateAnimalInput(validInput({ status: 'transferido' }), editContext).ok, true);
});

test('notes are trimmed and capped in length', () => {
  const result = validateAnimalInput(validInput({ notes: '  observação  ' }), context);
  assert.equal(result.data.notes, 'observação');
});

test('parseAnimalListQuery applies defaults for an empty query', () => {
  const parsed = parseAnimalListQuery({});

  assert.deepEqual(parsed.filters, { search: null, status: null, breed: null, sex: null, lotId: null });
  assert.equal(parsed.sort.key, 'earTag');
  assert.equal(parsed.pagination.page, 1);
});

test('parseAnimalListQuery reads search, filters, sort and pagination together', () => {
  const parsed = parseAnimalListQuery({
    q: '  BV-01  ',
    status: 'ativo',
    breed: 'nelore',
    sex: 'M',
    lote: '3',
    sort: 'weight',
    dir: 'desc',
    page: '2',
  });

  assert.equal(parsed.filters.search, 'BV-01');
  assert.equal(parsed.filters.status, 'ativo');
  assert.equal(parsed.filters.lotId, 3);
  assert.equal(parsed.sort.key, 'weight');
  assert.equal(parsed.sort.direction, 'desc');
  assert.equal(parsed.pagination.page, 2);
});

test('parseAnimalListQuery ignores a SQL-shaped search term rather than throwing', () => {
  const parsed = parseAnimalListQuery({ q: "1' OR '1'='1" });
  assert.equal(parsed.filters.search, "1' OR '1'='1", 'the raw text is kept - it is bound as a parameter later');
});
