/**
 * Custos: validation and the recurring-cost batch.
 *
 * On "recurring costs"
 * ---------------------
 * The schema's `is_recurring` / `recurrence_months` describe a *tag* on each
 * row ("this entry is part of a recurring series"), not a live rule that
 * conjures a cost into every future month's total automatically - the
 * dashboard's monthly sums (Phase 4/6) work by summing whatever rows actually
 * exist for a given `cost_date`. So a recurring cost is materialised as
 * several real rows, generated together in one transaction, the same pattern
 * already used for a weighing day (`insertWeighingBatch`) and a protocol
 * schedule (`insertEventBatch`): the user states "R$ 800 de aluguel, todo mês,
 * por 12 meses" once, and twelve real, independently editable rows are
 * created.
 */

import { addMonths, isValidIsoDate, todayIso } from '../lib/dates.js';
import { parseCurrencyToCents } from '../lib/format.js';

/** Bounds how many rows one recurring submission can generate at once. */
const MAX_OCCURRENCES = 60;

/**
 * Validates a cost entry.
 *
 * @param {object} input
 * @param {Set<string>} validCategorySlugs
 * @param {Set<number>} validLotIds lots within the target farm, or empty if none selected
 */
export function validateCostInput(input, { validCategorySlugs, validLotIds }) {
  const errors = {};
  const today = todayIso();

  const categorySlug = validCategorySlugs.has(input.categorySlug) ? input.categorySlug : null;
  if (!categorySlug) errors.categorySlug = 'Selecione uma categoria.';

  const costDate = typeof input.costDate === 'string' ? input.costDate : '';
  if (!isValidIsoDate(costDate)) {
    errors.costDate = 'Informe uma data válida.';
  } else if (costDate > today) {
    errors.costDate = 'A data do custo não pode ser futura.';
  }

  const amountCents = parseCurrencyToCents(input.amount);
  if (amountCents === null || amountCents <= 0) {
    errors.amount = 'Informe um valor maior que zero.';
  }

  let lotId = null;
  if (typeof input.lotId === 'string' && input.lotId !== '') {
    const parsed = Number.parseInt(input.lotId, 10);
    if (!Number.isInteger(parsed) || !validLotIds.has(parsed)) {
      errors.lotId = 'Lote inválido.';
    } else {
      lotId = parsed;
    }
  }

  const isRecurring = input.isRecurring === 'on' || input.isRecurring === true;

  let recurrenceMonths = null;
  let occurrences = 1;

  if (isRecurring) {
    const parsedInterval = Number.parseInt(input.recurrenceMonths, 10);
    if (!Number.isInteger(parsedInterval) || parsedInterval <= 0) {
      errors.recurrenceMonths = 'Informe o intervalo de recorrência em meses.';
    } else {
      recurrenceMonths = parsedInterval;
    }

    const parsedOccurrences = Number.parseInt(input.occurrences, 10);
    if (!Number.isInteger(parsedOccurrences) || parsedOccurrences < 2) {
      errors.occurrences = 'Informe quantas repetições lançar (mínimo 2).';
    } else if (parsedOccurrences > MAX_OCCURRENCES) {
      errors.occurrences = `No máximo ${MAX_OCCURRENCES} repetições por lançamento.`;
    } else {
      occurrences = parsedOccurrences;
    }
  }

  const description =
    typeof input.description === 'string' && input.description.trim() !== ''
      ? input.description.trim().slice(0, 200)
      : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: { categorySlug, costDate, amountCents, lotId, description, isRecurring, recurrenceMonths },
    occurrences,
  };
}

/**
 * Expands a validated recurring cost into the individual dated entries to
 * insert - the batch `insertCostBatch` (repository) writes in one transaction.
 *
 * A single, non-recurring cost is the degenerate case: one occurrence.
 *
 * @param {object} data from `validateCostInput`
 * @param {number} occurrences
 * @returns {Array<{costDate: string}>}
 */
export function expandRecurrence(data, occurrences) {
  if (!data.isRecurring) return [{ costDate: data.costDate }];

  return Array.from({ length: occurrences }, (_, index) => ({
    costDate: addMonths(data.costDate, index * data.recurrenceMonths),
  }));
}
