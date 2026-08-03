/**
 * Centralized pt-BR presentation formatting.
 *
 * Every value the user sees is formatted here and nowhere else. Views must not
 * build their own date strings, currency strings or decimal separators - that
 * duplication is how a project ends up showing "1234.5" on one screen and
 * "1.234,5" on the next.
 *
 * Conventions enforced (all pt-BR):
 *   dates       dd/MM/yyyy
 *   decimals    comma as the decimal separator
 *   thousands   dot as the group separator
 *   currency    R$ 1.234,56
 *   weights     1.234,5 kg
 *
 * Missing data renders as EM_DASH, never as 0, NaN or an empty string. See
 * `src/lib/safeMath.js` for the companion rule on the calculation side.
 */

/** Rendered whenever a value is absent. Distinct from a real zero. */
export const EM_DASH = '—';

const LOCALE = 'pt-BR';

/** Matches a date-only ISO string, the format used everywhere in the database. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isMissing(value) {
  return value === null || value === undefined || value === '';
}

function decimalFormatter(minimumFractionDigits, maximumFractionDigits) {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

/**
 * Formats a date-only ISO string (YYYY-MM-DD) as dd/MM/yyyy.
 *
 * The string is split rather than parsed through `new Date()` on purpose.
 * `new Date('2026-03-15')` is interpreted as UTC midnight, which in Brazil
 * (UTC-3) renders as 14/03/2026 - a silent off-by-one-day bug on every
 * date in the system. Splitting the string avoids timezone conversion
 * entirely, which is correct here because these values carry no time.
 *
 * @param {string|null|undefined} isoDate
 * @returns {string} dd/MM/yyyy, or EM_DASH when absent
 */
export function formatDate(isoDate) {
  if (isMissing(isoDate)) return EM_DASH;

  const match = ISO_DATE.exec(String(isoDate).slice(0, 10));
  if (!match) return EM_DASH;

  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/**
 * Formats an ISO datetime as dd/MM/yyyy HH:mm.
 *
 * @param {string|null|undefined} isoDateTime
 * @returns {string}
 */
export function formatDateTime(isoDateTime) {
  if (isMissing(isoDateTime)) return EM_DASH;

  const text = String(isoDateTime);
  const datePart = formatDate(text.slice(0, 10));
  if (datePart === EM_DASH) return EM_DASH;

  const timeMatch = /[T ](\d{2}):(\d{2})/.exec(text);
  if (!timeMatch) return datePart;

  return `${datePart} ${timeMatch[1]}:${timeMatch[2]}`;
}

/**
 * Formats a number with pt-BR separators.
 *
 * @param {number|null|undefined} value
 * @param {number} [decimals=0] fixed number of decimal places
 * @returns {string}
 */
export function formatNumber(value, decimals = 0) {
  if (isMissing(value) || !Number.isFinite(value)) return EM_DASH;
  return decimalFormatter(decimals, decimals).format(value);
}

/**
 * Formats a monetary amount stored in centavos as R$ 1.234,56.
 *
 * Money is stored as integer centavos throughout the system so that repeated
 * additions cannot accumulate floating-point error. The conversion to reais
 * happens here, at the last possible moment.
 *
 * @param {number|null|undefined} cents
 * @returns {string}
 */
export function formatCurrency(cents) {
  if (isMissing(cents) || !Number.isFinite(cents)) return EM_DASH;

  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);
}

/**
 * Formats a live weight in kilograms as 1.234,5 kg.
 *
 * @param {number|null|undefined} kilograms
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatWeight(kilograms, decimals = 1) {
  const formatted = formatNumber(kilograms, decimals);
  return formatted === EM_DASH ? EM_DASH : `${formatted} kg`;
}

/**
 * Formats an average daily gain as 0,850 kg/dia.
 *
 * Three decimal places because a herd-level GMD difference of 0,05 kg/dia is
 * operationally meaningful over a finishing period.
 *
 * @param {number|null|undefined} kilogramsPerDay
 * @returns {string}
 */
export function formatGmd(kilogramsPerDay) {
  const formatted = formatNumber(kilogramsPerDay, 3);
  return formatted === EM_DASH ? EM_DASH : `${formatted} kg/dia`;
}

/**
 * Formats a percentage value that is already on the 0-100 scale.
 *
 * @param {number|null|undefined} value
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatPercent(value, decimals = 1) {
  const formatted = formatNumber(value, decimals);
  return formatted === EM_DASH ? EM_DASH : `${formatted}%`;
}

/**
 * Formats a stocking rate as 1,25 UA/ha.
 *
 * @param {number|null|undefined} animalUnitsPerHectare
 * @returns {string}
 */
export function formatStockingRate(animalUnitsPerHectare) {
  const formatted = formatNumber(animalUnitsPerHectare, 2);
  return formatted === EM_DASH ? EM_DASH : `${formatted} UA/ha`;
}

/**
 * Formats an area as 123,45 ha.
 *
 * @param {number|null|undefined} hectares
 * @returns {string}
 */
export function formatArea(hectares) {
  const formatted = formatNumber(hectares, 2);
  return formatted === EM_DASH ? EM_DASH : `${formatted} ha`;
}

/**
 * Formats a quantity of arrobas as 18,50 @.
 *
 * @param {number|null|undefined} arrobas
 * @returns {string}
 */
export function formatArrobas(arrobas) {
  const formatted = formatNumber(arrobas, 2);
  return formatted === EM_DASH ? EM_DASH : `${formatted} @`;
}

/**
 * Formats an animal's age, derived from a birth date, in years and months.
 *
 * @param {string|null|undefined} isoBirthDate
 * @param {string} [isoReferenceDate] defaults to today
 * @returns {string} e.g. "2a 4m", "7m", or EM_DASH
 */
export function formatAge(isoBirthDate, isoReferenceDate) {
  if (isMissing(isoBirthDate)) return EM_DASH;

  const birth = ISO_DATE.exec(String(isoBirthDate).slice(0, 10));
  if (!birth) return EM_DASH;

  const reference = isoReferenceDate
    ? ISO_DATE.exec(String(isoReferenceDate).slice(0, 10))
    : ISO_DATE.exec(new Date().toISOString().slice(0, 10));
  if (!reference) return EM_DASH;

  const birthMonths = Number(birth[1]) * 12 + Number(birth[2]);
  const referenceMonths = Number(reference[1]) * 12 + Number(reference[2]);

  let totalMonths = referenceMonths - birthMonths;
  if (Number(reference[3]) < Number(birth[3])) totalMonths -= 1;
  if (totalMonths < 0) return EM_DASH;

  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;

  if (years === 0) return `${months}m`;
  if (months === 0) return `${years}a`;
  return `${years}a ${months}m`;
}
