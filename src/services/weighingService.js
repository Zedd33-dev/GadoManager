/**
 * Weighing domain rules: validation and outlier detection.
 *
 * On "automatic GMD recalculation"
 * -------------------------------
 * The brief asks for GMD to be recalculated when a weighing is recorded.
 * There is nothing to recalculate: GMD is never stored. Every figure that
 * uses it - the dashboard KPI, the GMD curve, this module's own preview - is
 * derived from the `weighings` table at read time by the Phase 4 queries.
 * Recording a weighing therefore updates every GMD in the system by the act
 * of inserting the row, with no cache to invalidate and no denormalised
 * column that could silently fall out of step.
 *
 * That is a deliberate design property, not an omission, so rather than build
 * a no-op "recalcular" button this module returns the *newly implied* GMD for
 * each animal alongside the insert result, which is the genuinely useful part
 * of the request: after a weighing day the operator wants to see how each
 * animal performed since its previous weighing.
 */

import { isValidIsoDate, todayIso, daysBetween } from '../lib/dates.js';
import { safeDivide } from '../lib/safeMath.js';
import { WEIGHT_LOSS_OUTLIER_FRACTION } from '../domain/constants.js';

/** Upper sanity bound, in kg. No bovine reaches this; a typo can. */
const MAX_PLAUSIBLE_WEIGHT_KG = 1500;

/**
 * Parses a pt-BR weight string ("482,5") into a number.
 *
 * @param {unknown} input
 * @returns {number|null}
 */
export function parseWeight(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // A comma present means pt-BR notation: dots are thousands separators to
  // discard, the comma is the decimal point. With no comma the value is
  // already plain decimal, so a dot must be *kept* - stripping it
  // unconditionally turns "482.5" into 4825, a tenfold error on a scale
  // reading. Same rule as `parseCurrencyToCents` in lib/format.js.
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * Compares a proposed weighing against the animal's previous one.
 *
 * A flagged result is a warning, never a rejection: an animal genuinely can
 * lose weight, and refusing to record that would corrupt the herd's real
 * history to protect against a typo. The caller is expected to surface the
 * warning and let an operator confirm.
 *
 * @param {{weightKg: number, weighDate: string}} proposed
 * @param {{weightKg: number, weighDate: string}|null} previous
 * @returns {{isOutlier: boolean, lossFraction: number|null, gmd: number|null, reason: string|null}}
 */
export function detectOutlier(proposed, previous) {
  if (!previous) {
    return { isOutlier: false, lossFraction: null, gmd: null, reason: null };
  }

  const days = daysBetween(previous.weighDate, proposed.weighDate);
  const gmd = days > 0 ? safeDivide(proposed.weightKg - previous.weightKg, days) : null;

  if (proposed.weightKg >= previous.weightKg) {
    return { isOutlier: false, lossFraction: 0, gmd, reason: null };
  }

  const lossFraction = safeDivide(previous.weightKg - proposed.weightKg, previous.weightKg);

  if (lossFraction !== null && lossFraction > WEIGHT_LOSS_OUTLIER_FRACTION) {
    const lossPercent = (lossFraction * 100).toFixed(1).replace('.', ',');
    return {
      isOutlier: true,
      lossFraction,
      gmd,
      reason:
        `Perda de ${lossPercent}% em relação à pesagem anterior ` +
        `(${previous.weightKg.toFixed(1).replace('.', ',')} kg em ${previous.weighDate}). ` +
        'Confirme se o valor está correto.',
    };
  }

  return { isOutlier: false, lossFraction, gmd, reason: null };
}

/**
 * Validates one weighing against the domain rules that the schema cannot
 * express.
 *
 * The schema already enforces `weight_kg > 0`, the ISO date format and one
 * weighing per animal per day (Phase 1). The rules here are the ones SQLite
 * cannot check, because they depend on the current date or on another row:
 * no weighing in the future, and none before the animal was born.
 *
 * @param {object} input
 * @param {object} context
 * @param {{birth_date: string, ear_tag: string}} context.animal
 * @param {boolean} [context.dateAlreadyUsed]
 * @returns {{ok: true, data: object} | {ok: false, errors: Record<string, string>}}
 */
export function validateWeighing(input, context) {
  const errors = {};
  const today = todayIso();

  const weighDate = typeof input.weighDate === 'string' ? input.weighDate : '';
  if (!isValidIsoDate(weighDate)) {
    errors.weighDate = 'Informe uma data de pesagem válida.';
  } else if (weighDate > today) {
    errors.weighDate = 'A pesagem não pode ter data futura.';
  } else if (context.animal && weighDate < context.animal.birth_date) {
    errors.weighDate = 'A pesagem não pode ser anterior ao nascimento do animal.';
  } else if (context.dateAlreadyUsed) {
    errors.weighDate = 'Já existe uma pesagem deste animal nesta data.';
  }

  const weightKg = parseWeight(input.weightKg);
  if (weightKg === null) {
    errors.weightKg = 'Informe o peso.';
  } else if (weightKg <= 0) {
    errors.weightKg = 'O peso deve ser maior que zero.';
  } else if (weightKg > MAX_PLAUSIBLE_WEIGHT_KG) {
    errors.weightKg = `O peso informado (${weightKg} kg) está acima do plausível para um bovino.`;
  }

  const notes =
    typeof input.notes === 'string' && input.notes.trim() !== ''
      ? input.notes.trim().slice(0, 500)
      : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, data: { weighDate, weightKg, notes } };
}

/**
 * Normalises the parallel `brinco[]` / `peso[]` arrays a batch weighing form
 * posts into a list of `{earTag, weightKg}` entries, dropping rows the
 * operator left entirely blank.
 *
 * The batch screen renders a fixed number of empty rows so it works without
 * JavaScript, which means most submissions contain mostly blanks; treating a
 * blank row as an error would make the screen unusable.
 *
 * @param {unknown} earTags
 * @param {unknown} weights
 * @returns {Array<{index: number, earTag: string, rawWeight: string}>}
 */
export function collectBatchRows(earTags, weights) {
  const tagList = Array.isArray(earTags) ? earTags : [earTags].filter((v) => v !== undefined);
  const weightList = Array.isArray(weights) ? weights : [weights].filter((v) => v !== undefined);

  const rows = [];
  for (let index = 0; index < tagList.length; index += 1) {
    const earTag = typeof tagList[index] === 'string' ? tagList[index].trim() : '';
    const rawWeight = typeof weightList[index] === 'string' ? weightList[index].trim() : '';

    if (earTag === '' && rawWeight === '') continue;
    rows.push({ index, earTag, rawWeight });
  }

  return rows;
}
