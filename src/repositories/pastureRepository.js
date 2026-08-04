/**
 * Pasture (pasto) queries.
 */

import { inClause } from '../middleware/tenant.js';

/**
 * Lists active pastures visible to the given scope, with their farm's name.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @returns {object[]}
 */
export function listInScope(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT p.id, p.name, p.farm_id, f.name AS farm_name
         FROM pastures p
         JOIN farms f ON f.id = p.farm_id
        WHERE p.farm_id IN (${placeholders})
          AND p.active = 1
        ORDER BY f.name, p.name`,
    )
    .all(...params);
}

/**
 * Finds one pasture, but only if it belongs to a farm in scope.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {number} pastureId
 * @returns {object|undefined}
 */
export function findInScope(db, farmIds, pastureId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, farm_id
         FROM pastures
        WHERE id = ? AND farm_id IN (${placeholders}) AND active = 1`,
    )
    .get(pastureId, ...params);
}
