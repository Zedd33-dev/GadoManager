/**
 * Safe arithmetic helpers.
 *
 * The single rule enforced here: a calculation that has no meaningful answer
 * returns `null`, never `NaN`, `Infinity` or a misleading `0`. The formatting
 * layer (`src/lib/format.js`) renders `null` as an em dash, so "no data" and
 * "the answer is zero" are visually distinct on screen.
 *
 * This is why the dashboard cannot render "R$ 0,00" when the truth is
 * "nothing was recorded".
 */

/**
 * Divides two numbers, returning null when the result is not meaningful.
 *
 * @param {number|null|undefined} numerator
 * @param {number|null|undefined} denominator
 * @returns {number|null} the quotient, or null when it cannot be computed
 */
export function safeDivide(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;

  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

/**
 * Averages a list of numbers, ignoring null and undefined entries.
 *
 * Returns null for an empty list rather than 0, because "no values" is not
 * the same statement as "the average is zero".
 *
 * @param {Array<number|null|undefined>} values
 * @returns {number|null}
 */
export function safeAverage(values) {
  if (!Array.isArray(values)) return null;

  const usable = values.filter(Number.isFinite);
  if (usable.length === 0) return null;

  const sum = usable.reduce((total, value) => total + value, 0);
  return safeDivide(sum, usable.length);
}

/**
 * Expresses `part` as a percentage of `total`.
 *
 * @param {number|null|undefined} part
 * @param {number|null|undefined} total
 * @returns {number|null} a value in the 0-100 range, or null
 */
export function safePercent(part, total) {
  const ratio = safeDivide(part, total);
  return ratio === null ? null : ratio * 100;
}

/**
 * Sums a list of numbers, ignoring null and undefined entries.
 *
 * Unlike the helpers above this returns 0 for an empty list, because a sum
 * over no records genuinely is zero. Callers that need to distinguish "no
 * records" from "records summing to zero" must check the record count
 * separately - the dashboard cost card does exactly that.
 *
 * @param {Array<number|null|undefined>} values
 * @returns {number}
 */
export function safeSum(values) {
  if (!Array.isArray(values)) return 0;
  return values.filter(Number.isFinite).reduce((total, value) => total + value, 0);
}
