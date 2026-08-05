/**
 * Animal domain rules: list-query parsing and create/update validation.
 *
 * Validation happens here, once, so both the create and the edit route call
 * the same function - a rule fixed in one path cannot silently stay broken in
 * the other. Every rule mirrors a constraint already enforced by the schema
 * (Phase 1) or stated in `docs/business-rules.md`; this is the friendly,
 * field-by-field version of the same rules, checked before they would
 * otherwise surface as a raw SQLite CHECK-constraint error.
 */

import { isValidIsoDate, todayIso } from '../lib/dates.js';
import { parseCurrencyToCents } from '../lib/format.js';
import { resolveSort } from '../lib/sorting.js';
import { parsePagination } from '../lib/pagination.js';
import { ANIMAL_SORT_COLUMNS } from '../repositories/animalRepository.js';
import { ANIMAL_STATUS } from '../domain/constants.js';

/** Matches the schema's CHECK on `animals.breed` (migration 005) exactly. */
const BREED_MAX_LENGTH = 60;

const SEXES = ['M', 'F'];
const ORIGINS = ['nascido', 'comprado'];

/** Statuses this form may set directly. Selling and death go through their own modules. */
export const EDITABLE_STATUSES = [ANIMAL_STATUS.ACTIVE, ANIMAL_STATUS.TRANSFERRED];

/**
 * Parses the Animais list's query parameters into repository-ready options.
 *
 * @param {Record<string, unknown>} query
 * @returns {{filters: object, sort: object, pagination: object}}
 */
export function parseAnimalListQuery(query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const status = typeof query.status === 'string' && query.status !== '' ? query.status : null;
  const breed = typeof query.breed === 'string' && query.breed !== '' ? query.breed : null;
  const sex = typeof query.sex === 'string' && query.sex !== '' ? query.sex : null;

  const lotIdRaw = Number.parseInt(query.lote, 10);
  const lotId = Number.isInteger(lotIdRaw) ? lotIdRaw : null;

  const sort = resolveSort(ANIMAL_SORT_COLUMNS, { defaultKey: 'earTag', defaultDirection: 'asc' }, query);
  const pagination = parsePagination(query);

  return {
    filters: { search: search || null, status, breed, sex, lotId },
    sort,
    pagination,
  };
}

/**
 * Validates and normalises a create/edit form submission.
 *
 * @param {Record<string, unknown>} input raw form fields (strings)
 * @param {object} context
 * @param {boolean} context.isCreate
 * @param {Set<number>} context.validLotIds lot ids the caller may assign, already scope-checked
 * @param {Set<number>} context.validPastureIds pasture ids the caller may assign, already scope-checked
 * @param {Set<number>} context.validMotherIds animal ids that may be this animal's mother
 * @returns {{ok: true, data: object} | {ok: false, errors: Record<string, string>}}
 */
export function validateAnimalInput(input, context) {
  const errors = {};
  const today = todayIso();

  const earTag = typeof input.earTag === 'string' ? input.earTag.trim() : '';
  if (!earTag) errors.earTag = 'Informe o número do brinco.';
  else if (earTag.length > 40) errors.earTag = 'O brinco deve ter no máximo 40 caracteres.';

  const sisbov = typeof input.sisbov === 'string' && input.sisbov.trim() !== '' ? input.sisbov.trim() : null;

  const birthDate = typeof input.birthDate === 'string' ? input.birthDate : '';
  if (!isValidIsoDate(birthDate)) {
    errors.birthDate = 'Informe uma data de nascimento válida.';
  } else if (birthDate > today) {
    errors.birthDate = 'A data de nascimento não pode ser no futuro.';
  }

  const sex = SEXES.includes(input.sex) ? input.sex : null;
  if (!sex) errors.sex = 'Selecione o sexo do animal.';

  // Free text, not an enum (migration 005) - any breed or cross is accepted.
  const breed = typeof input.breed === 'string' ? input.breed.trim() : '';
  if (!breed) errors.breed = 'Informe a raça.';
  else if (breed.length > BREED_MAX_LENGTH) {
    errors.breed = `A raça deve ter no máximo ${BREED_MAX_LENGTH} caracteres.`;
  }

  const origin = ORIGINS.includes(input.origin) ? input.origin : null;
  if (!origin) errors.origin = 'Selecione a origem.';

  let purchaseDate = null;
  let purchasePriceCents = null;
  let motherId = null;

  if (origin === 'comprado') {
    purchaseDate = typeof input.purchaseDate === 'string' ? input.purchaseDate : '';
    if (!isValidIsoDate(purchaseDate)) {
      errors.purchaseDate = 'Informe a data de compra.';
    } else if (purchaseDate > today) {
      errors.purchaseDate = 'A data de compra não pode ser no futuro.';
    } else if (isValidIsoDate(birthDate) && purchaseDate < birthDate) {
      errors.purchaseDate = 'A data de compra não pode ser anterior ao nascimento.';
    }

    if (typeof input.purchasePrice === 'string' && input.purchasePrice.trim() !== '') {
      purchasePriceCents = parseCurrencyToCents(input.purchasePrice);
      if (purchasePriceCents === null || purchasePriceCents <= 0) {
        errors.purchasePrice = 'Informe um valor de compra válido.';
      }
    }
  } else if (origin === 'nascido') {
    const motherIdRaw = Number.parseInt(input.motherId, 10);
    if (Number.isInteger(motherIdRaw)) {
      if (!context.validMotherIds.has(motherIdRaw)) {
        errors.motherId = 'Mãe selecionada é inválida.';
      } else {
        motherId = motherIdRaw;
      }
    }
  }

  let lotId = null;
  if (typeof input.lotId === 'string' && input.lotId !== '') {
    const parsed = Number.parseInt(input.lotId, 10);
    if (!Number.isInteger(parsed) || !context.validLotIds.has(parsed)) {
      errors.lotId = 'Lote selecionado é inválido.';
    } else {
      lotId = parsed;
    }
  }

  let pastureId = null;
  if (typeof input.pastureId === 'string' && input.pastureId !== '') {
    const parsed = Number.parseInt(input.pastureId, 10);
    if (!Number.isInteger(parsed) || !context.validPastureIds.has(parsed)) {
      errors.pastureId = 'Pasto selecionado é inválido.';
    } else {
      pastureId = parsed;
    }
  }

  let status = ANIMAL_STATUS.ACTIVE;
  if (!context.isCreate) {
    status = EDITABLE_STATUSES.includes(input.status) ? input.status : null;
    if (!status) {
      errors.status = 'Este formulário só altera o status entre ativo e transferido. ' +
        'Vendas e mortes são registradas em seus próprios módulos.';
    }
  }

  const notes = typeof input.notes === 'string' && input.notes.trim() !== '' ? input.notes.trim().slice(0, 2000) : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      earTag,
      sisbov,
      birthDate,
      sex,
      breed,
      origin,
      motherId,
      purchaseDate,
      purchasePriceCents,
      lotId,
      pastureId,
      status,
      notes,
    },
  };
}
