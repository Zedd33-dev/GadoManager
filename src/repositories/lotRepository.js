/**
 * Lot (lote) queries.
 */

import { inClause } from '../middleware/tenant.js';

/**
 * Lists active lots visible to the given scope, with their farm's name, for the
 * dashboard's Lote filter.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @returns {object[]}
 */
export function listInScope(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT l.id, l.name, l.farm_id, f.name AS farm_name
         FROM lots l
         JOIN farms f ON f.id = l.farm_id
        WHERE l.farm_id IN (${placeholders})
          AND l.active = 1
        ORDER BY f.name, l.name`,
    )
    .all(...params);
}

/**
 * Finds one lot, but only if it belongs to a farm in scope.
 *
 * As with `animalRepository.findInScope`, the scope is part of the WHERE
 * clause: a lote from outside the caller's farms is indistinguishable from one
 * that does not exist.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {number} lotId
 * @returns {object|undefined}
 */
export function findInScope(db, farmIds, lotId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, farm_id
         FROM lots
        WHERE id = ?
          AND farm_id IN (${placeholders})
          AND active = 1`,
    )
    .get(lotId, ...params);
}
