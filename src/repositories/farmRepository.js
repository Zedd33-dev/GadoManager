/**
 * Farm queries.
 */

import { inClause } from '../middleware/tenant.js';

/**
 * Lists the farms visible to the given scope, for the dashboard's Fazenda
 * filter and similar selects.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @returns {object[]}
 */
export function listInScope(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, city, state
         FROM farms
        WHERE id IN (${placeholders})
        ORDER BY name`,
    )
    .all(...params);
}
