/**
 * Server-side pagination.
 *
 * Pure functions with no HTTP or database dependency, so they can be reused by
 * every list screen (Animais today, Vacinas/Tratamentos/Vendas/Custos in later
 * phases) without duplicating the page-number arithmetic each time.
 */

/** Options a caller may not exceed, to bound how much a single request can read. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Parses `page` and `perPage` query parameters into safe integers.
 *
 * Never trusts the raw value: a non-numeric, negative, zero or excessive
 * `perPage` all fall back to a sane default rather than reaching the database.
 *
 * @param {{page?: unknown, perPage?: unknown}} query
 * @returns {{page: number, perPage: number, offset: number}}
 */
export function parsePagination(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);

  const requestedPerPage = Number.parseInt(query.perPage, 10);
  const perPage =
    Number.isInteger(requestedPerPage) && requestedPerPage > 0
      ? Math.min(requestedPerPage, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page, perPage, offset: (page - 1) * perPage };
}

/**
 * Builds the page-level metadata a list view needs: total pages, whether a
 * previous/next page exists, and the range of rows the current page
 * represents ("mostrando 26-50 de 130").
 *
 * @param {number} totalRows
 * @param {{page: number, perPage: number}} pagination
 */
export function buildPageInfo(totalRows, { page, perPage }) {
  const totalPages = Math.max(1, Math.ceil(totalRows / perPage));
  const currentPage = Math.min(page, totalPages);

  const rangeStart = totalRows === 0 ? 0 : (currentPage - 1) * perPage + 1;
  const rangeEnd = Math.min(currentPage * perPage, totalRows);

  return {
    page: currentPage,
    perPage,
    totalRows,
    totalPages,
    hasPrevious: currentPage > 1,
    hasNext: currentPage < totalPages,
    rangeStart,
    rangeEnd,
  };
}
