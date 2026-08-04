/**
 * Server-side sorting, safe against SQL injection by construction.
 *
 * A column name can never be a bound parameter - `ORDER BY ?` is not valid
 * SQL - so the only safe way to let a request choose a sort column is an
 * allow-list mapping a short public key to a literal SQL expression written
 * by us. `resolveSort` never lets a caller-supplied string reach a query
 * string; a request for an unknown key or direction silently falls back to
 * the default instead of being rejected, since sorting is a display
 * preference, not a security boundary.
 */

/**
 * @param {Record<string, string>} columns public key -> SQL expression
 * @param {{defaultKey: string, defaultDirection?: 'asc'|'desc'}} defaults
 * @param {{sort?: unknown, dir?: unknown}} query
 * @returns {{key: string, direction: 'asc'|'desc', orderBy: string}}
 */
export function resolveSort(columns, defaults, query = {}) {
  const requestedKey = typeof query.sort === 'string' ? query.sort : '';
  const key = Object.prototype.hasOwnProperty.call(columns, requestedKey)
    ? requestedKey
    : defaults.defaultKey;

  const requestedDirection = typeof query.dir === 'string' ? query.dir.toLowerCase() : '';
  const direction =
    requestedDirection === 'asc' || requestedDirection === 'desc'
      ? requestedDirection
      : (defaults.defaultDirection ?? 'asc');

  const expression = columns[key];

  return {
    key,
    direction,
    orderBy: `${expression} ${direction.toUpperCase()}`,
  };
}

/**
 * The direction a column header link should switch to: clicking the column
 * already being sorted flips it, clicking any other column starts ascending.
 *
 * @param {{key: string, direction: 'asc'|'desc'}} current
 * @param {string} columnKey
 * @returns {'asc'|'desc'}
 */
export function nextDirectionFor(current, columnKey) {
  if (current.key !== columnKey) return 'asc';
  return current.direction === 'asc' ? 'desc' : 'asc';
}
