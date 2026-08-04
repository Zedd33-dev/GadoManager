/**
 * Query-string construction for "change one thing, keep the rest" links -
 * a sortable column header, a pagination link, a filter chip. Every such
 * link starts from the current request's query values and applies overrides,
 * so clicking "próxima página" does not silently drop the search term or
 * clicking a column header does not drop the active filters.
 */

/**
 * @param {Record<string, unknown>} currentValues the fields worth preserving,
 *   already narrowed to an allow-list by the caller
 * @param {Record<string, unknown>} [overrides] values to set or, with
 *   `undefined`, to remove
 * @returns {string} a query string with no leading `?`
 */
export function buildQuery(currentValues, overrides = {}) {
  const merged = { ...currentValues, ...overrides };

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }

  return params.toString();
}
