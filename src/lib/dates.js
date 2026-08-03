/**
 * Date arithmetic on ISO date-only strings.
 *
 * Every date in this system is a `YYYY-MM-DD` string with no time and no
 * timezone, because a birth date, a weighing date and a due date are calendar
 * facts rather than instants. Arithmetic is done in UTC and the result is
 * re-serialised as a string, so a value can never drift by a day when the
 * machine's timezone is UTC-3.
 *
 * The companion rule lives in `src/lib/format.js`, which renders these strings
 * as dd/MM/yyyy without ever constructing a Date.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * @param {string} iso
 * @returns {boolean}
 */
export function isValidIsoDate(iso) {
  if (typeof iso !== 'string') return false;

  const match = ISO_DATE.exec(iso);
  if (!match) return false;

  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Rejects impossible dates such as 2026-02-30, which Date would roll over.
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Converts an ISO date string to a UTC timestamp.
 *
 * @param {string} iso
 * @returns {number} milliseconds since the epoch
 */
function toUtc(iso) {
  if (!isValidIsoDate(iso)) throw new TypeError(`Invalid ISO date: ${String(iso)}`);
  const [, year, month, day] = ISO_DATE.exec(iso).map(Number);
  return Date.UTC(year, month - 1, day);
}

/**
 * Serialises a UTC timestamp back to an ISO date string.
 *
 * @param {number} timestamp
 * @returns {string}
 */
function fromUtc(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Today's date in the local calendar, as an ISO string.
 *
 * Uses local components rather than `toISOString()` because at 21:00 in Brazil
 * the UTC date is already tomorrow, and "today" here means the operator's today.
 *
 * @returns {string}
 */
export function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * @param {string} iso
 * @param {number} days may be negative
 * @returns {string}
 */
export function addDays(iso, days) {
  return fromUtc(toUtc(iso) + Math.trunc(days) * MS_PER_DAY);
}

/**
 * Adds whole months, clamping to the end of the target month.
 *
 * 31/01 plus one month is 28/02 (or 29/02), not 03/03. Rolling over would make
 * a monthly recurring cost drift forward through the calendar.
 *
 * @param {string} iso
 * @param {number} months may be negative
 * @returns {string}
 */
export function addMonths(iso, months) {
  const [, year, month, day] = ISO_DATE.exec(iso).map(Number);

  const targetMonthIndex = month - 1 + Math.trunc(months);
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const normalizedMonth = ((targetMonthIndex % 12) + 12) % 12;

  const lastDayOfTarget = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();

  return fromUtc(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDayOfTarget)));
}

/**
 * Whole days from `startIso` to `endIso`. Negative when the end precedes the start.
 *
 * This is the denominator of the GMD formula, which is why it returns an exact
 * integer: both operands are UTC midnights, so daylight-saving transitions
 * cannot produce a fractional day.
 *
 * @param {string} startIso
 * @param {string} endIso
 * @returns {number}
 */
export function daysBetween(startIso, endIso) {
  return Math.round((toUtc(endIso) - toUtc(startIso)) / MS_PER_DAY);
}

/**
 * First day of the month containing `iso`.
 *
 * @param {string} iso
 * @returns {string}
 */
export function startOfMonth(iso) {
  const [, year, month] = ISO_DATE.exec(iso).map(Number);
  return fromUtc(Date.UTC(year, month - 1, 1));
}

/**
 * First day of the following month.
 *
 * Month ranges are expressed as the half-open interval
 * [startOfMonth, startOfNextMonth), which includes every day regardless of month
 * length and cannot double-count a boundary date.
 *
 * @param {string} iso
 * @returns {string}
 */
export function startOfNextMonth(iso) {
  return addMonths(startOfMonth(iso), 1);
}

/**
 * First day of the year containing `iso`.
 *
 * @param {string} iso
 * @returns {string}
 */
export function startOfYear(iso) {
  const [, year] = ISO_DATE.exec(iso).map(Number);
  return fromUtc(Date.UTC(year, 0, 1));
}

/**
 * Age in whole months on a reference date.
 *
 * Used to classify an animal into bezerro / novilha / boi / vaca / touro, and to
 * schedule age-based sanitary protocols.
 *
 * @param {string} birthIso
 * @param {string} [referenceIso] defaults to today
 * @returns {number}
 */
export function ageInMonths(birthIso, referenceIso = todayIso()) {
  const [, birthYear, birthMonth, birthDay] = ISO_DATE.exec(birthIso).map(Number);
  const [, refYear, refMonth, refDay] = ISO_DATE.exec(referenceIso).map(Number);

  let months = (refYear - birthYear) * 12 + (refMonth - birthMonth);
  if (refDay < birthDay) months -= 1;

  return months;
}

/**
 * The later of two dates.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function maxDate(a, b) {
  return toUtc(a) >= toUtc(b) ? a : b;
}

/**
 * The earlier of two dates.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function minDate(a, b) {
  return toUtc(a) <= toUtc(b) ? a : b;
}
