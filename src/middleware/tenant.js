/**
 * Multi-tenant scoping.
 *
 * Resolves which farms the logged-in user may address, and exposes them on
 * `req.scope`. Every repository function that reads farm-owned data takes those
 * ids and binds them into its query; there is no code path that reads herd data
 * without them (issue SEC-06).
 *
 * The scope is derived from the database on each request, never from anything
 * the client sends. A user cannot widen their own access by editing a form
 * field, a cookie or a query string.
 */

import { getDb } from '../config/db.js';
import { findFarmIdsForUser } from '../repositories/userRepository.js';
import { HttpError } from './errors.js';

/**
 * Populates `req.scope` for an authenticated request.
 *
 * `req.scope.farmIds` is the authoritative list. `req.scope.activeFarmId` is the
 * optional narrowing chosen through the dashboard's Fazenda filter - it is
 * validated against `farmIds`, so requesting a farm the user cannot see is
 * rejected rather than silently honoured.
 */
export function resolveTenantScope(req, res, next) {
  if (!req.user) return next();

  const farmIds = findFarmIdsForUser(getDb(), req.user.id);

  let activeFarmId = null;
  const requested = req.query?.fazenda;

  if (requested !== undefined && requested !== '') {
    const parsed = Number.parseInt(String(requested), 10);

    if (!Number.isInteger(parsed) || !farmIds.includes(parsed)) {
      return next(new HttpError(403, 'Você não tem acesso a esta fazenda.'));
    }
    activeFarmId = parsed;
  }

  req.scope = {
    farmIds,
    activeFarmId,
    /** The ids a query should actually filter on, honouring the active filter. */
    effectiveFarmIds: activeFarmId === null ? farmIds : [activeFarmId],
  };

  res.locals.scope = req.scope;
  return next();
}

/**
 * Builds a SQL placeholder list and the matching parameter array for an IN clause.
 *
 * Bound parameters cannot express a variable-length list directly, so the
 * placeholders are generated from the array's length - never from its contents.
 * The values themselves are always bound, so this remains injection-safe.
 *
 * @param {number[]} ids
 * @returns {{placeholders: string, params: number[]}}
 */
export function inClause(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    // An empty scope must match nothing. "IN (NULL)" is false for every row,
    // which is the correct and safe degenerate case.
    return { placeholders: 'NULL', params: [] };
  }

  return {
    placeholders: ids.map(() => '?').join(', '),
    params: ids,
  };
}

/**
 * The same as `inClause`, but producing named parameters.
 *
 * SQLite will not mix named (`:name`) and anonymous (`?`) parameters in one
 * statement. Queries that need named parameters for readability - the alert
 * query repeats `:today` five times - must therefore bind their scope by name
 * too.
 *
 * As with `inClause`, the placeholder names are derived from the array's index,
 * never from its contents, and the values are always bound.
 *
 * @param {number[]} ids
 * @param {string} [prefix]
 * @returns {{placeholders: string, params: Record<string, number>}}
 */
export function namedInClause(ids, prefix = 'scope') {
  if (!Array.isArray(ids) || ids.length === 0) {
    return { placeholders: 'NULL', params: {} };
  }

  return {
    placeholders: ids.map((_, index) => `:${prefix}${index}`).join(', '),
    params: Object.fromEntries(ids.map((id, index) => [`${prefix}${index}`, id])),
  };
}
