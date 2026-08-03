/**
 * Animal queries.
 *
 * Minimal in this phase: enough to demonstrate and test the tenant scoping
 * mechanism. Phase 8 extends this with pagination, sorting, search and filters.
 *
 * Every function takes `farmIds` and binds it. There is deliberately no variant
 * that reads animals without a scope - if such a function existed, sooner or
 * later a route would call it (issue SEC-06).
 */

import { inClause } from '../middleware/tenant.js';

/**
 * Counts animals visible to the given scope.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {{status?: string}} [filters]
 * @returns {number}
 */
export function countInScope(db, farmIds, filters = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`farm_id IN (${placeholders})`];
  const values = [...params];

  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }

  return db
    .prepare(`SELECT COUNT(*) AS total FROM animals WHERE ${conditions.join(' AND ')}`)
    .get(...values).total;
}

/**
 * Lists animals visible to the given scope.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {{limit?: number}} [options]
 * @returns {object[]}
 */
export function listInScope(db, farmIds, options = {}) {
  const { placeholders, params } = inClause(farmIds);
  const limit = Number.isInteger(options.limit) ? options.limit : 100;

  return db
    .prepare(
      `SELECT id, farm_id, ear_tag, sisbov, birth_date, sex, breed, origin,
              lot_id, pasture_id, status
         FROM animals
        WHERE farm_id IN (${placeholders})
        ORDER BY ear_tag
        LIMIT ?`,
    )
    .all(...params, limit);
}

/**
 * Finds one animal, but only if it belongs to a farm in scope.
 *
 * The scope is part of the WHERE clause rather than checked after the fact, so
 * an out-of-scope id is indistinguishable from a nonexistent one - the caller
 * cannot use this to probe whether another farm's animal exists.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {number} animalId
 * @returns {object|undefined}
 */
export function findInScope(db, farmIds, animalId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, farm_id, ear_tag, sisbov, birth_date, sex, breed, origin,
              lot_id, pasture_id, status
         FROM animals
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(animalId, ...params);
}
