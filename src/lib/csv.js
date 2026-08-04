/**
 * CSV export.
 *
 * Semicolon-delimited, not comma-delimited: every number and currency value
 * elsewhere in this system is formatted pt-BR with a comma decimal separator
 * (`src/lib/format.js`), and a comma-delimited CSV would misparse "1.234,5"
 * into two fields the moment it hit a real cell. Semicolon is also what
 * Excel's Brazilian-Portuguese locale expects natively - opening the file
 * does not require an import wizard.
 *
 * A UTF-8 byte-order mark is prepended so Excel opens accented characters
 * (ç, ã, é) correctly instead of guessing the wrong encoding, which is the
 * single most common way a CSV full of Portuguese text gets mangled.
 */

const DELIMITER = ';';
const BOM = '﻿';

/**
 * Escapes one field for a semicolon-delimited CSV.
 *
 * A field is quoted only when it contains the delimiter, a quote, or a
 * newline - quoting everything would be valid but noisier to read for the
 * common case of a plain word or number.
 *
 * @param {unknown} value
 * @returns {string}
 */
function escapeField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[;"\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Builds a CSV document from a header row and an array of row arrays.
 *
 * Every row must have the same length as `headers` - this is enforced by
 * simply mapping over `headers`' length, so a short row pads with empty
 * fields rather than shifting columns.
 *
 * @param {string[]} headers
 * @param {Array<Array<unknown>>} rows
 * @returns {string}
 */
export function toCsv(headers, rows) {
  const lines = [headers.map(escapeField).join(DELIMITER)];

  for (const row of rows) {
    lines.push(headers.map((_, index) => escapeField(row[index])).join(DELIMITER));
  }

  return BOM + lines.join('\r\n') + '\r\n';
}
