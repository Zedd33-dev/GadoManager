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

/**
 * Every lot in scope, including inactive ones, with derived counters.
 *
 * The counters (head count, average latest weight) are computed here rather
 * than stored on the row. The brief asks for "automatic recalculation of
 * derived counters whenever animals move"; deriving them at read time means
 * there is no counter that can fall out of step with reality in the first
 * place - the same reasoning that makes GMD a computed figure rather than a
 * stored one.
 */
export function listWithDetails(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `WITH latest AS (
         SELECT w.animal_id, w.weight_kg,
                ROW_NUMBER() OVER (
                  PARTITION BY w.animal_id ORDER BY w.weigh_date DESC, w.id DESC
                ) AS rn
         FROM weighings w
       )
       SELECT l.id, l.name, l.description, l.active,
              l.farm_id, f.name AS farm_name,
              COUNT(a.id)      AS animal_count,
              AVG(lw.weight_kg) AS average_weight_kg
         FROM lots l
         JOIN farms f ON f.id = l.farm_id
         LEFT JOIN animals a ON a.lot_id = l.id AND a.status = 'ativo'
         LEFT JOIN latest lw ON lw.animal_id = a.id AND lw.rn = 1
        WHERE l.farm_id IN (${placeholders})
        GROUP BY l.id
        ORDER BY f.name, l.name`,
    )
    .all(...params);
}

/** One lot with its full detail, scoped, regardless of active flag. */
export function findDetailInScope(db, farmIds, lotId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, description, active, farm_id
         FROM lots
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(lotId, ...params);
}

/** @returns {number} the new lot's id */
export function insertLot(db, farmId, data) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO lots (farm_id, name, description, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(farmId, data.name, data.description, data.active ? 1 : 0, now, now).lastInsertRowid,
  );
}

/** @returns {boolean} whether a row was updated */
export function updateLot(db, farmIds, lotId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE lots SET name = ?, description = ?, active = ?, updated_at = ?
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(data.name, data.description, data.active ? 1 : 0, new Date().toISOString(), lotId, ...params);

  return result.changes > 0;
}

/** @returns {number} how many active animals are currently in this lot */
export function countOccupants(db, lotId) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM animals WHERE lot_id = ? AND status = 'ativo'")
    .get(lotId).c;
}
