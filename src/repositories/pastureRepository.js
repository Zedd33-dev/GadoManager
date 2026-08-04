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

/**
 * Every pasture in scope, including inactive ones, with its full detail and
 * current occupancy - the Pastos management list.
 */
export function listWithDetails(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT p.id, p.name, p.area_ha, p.forage_type, p.rest_period_days,
              p.max_stocking_rate_ua_ha, p.active,
              p.farm_id, f.name AS farm_name,
              COUNT(a.id) AS animal_count
         FROM pastures p
         JOIN farms f ON f.id = p.farm_id
         LEFT JOIN animals a ON a.pasture_id = p.id AND a.status = 'ativo'
        WHERE p.farm_id IN (${placeholders})
        GROUP BY p.id
        ORDER BY f.name, p.name`,
    )
    .all(...params);
}

/** One pasture with its full detail, scoped, regardless of active flag. */
export function findDetailInScope(db, farmIds, pastureId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, area_ha, forage_type, rest_period_days,
              max_stocking_rate_ua_ha, active, farm_id
         FROM pastures
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(pastureId, ...params);
}

/** @returns {number} the new pasture's id */
export function insertPasture(db, farmId, data) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO pastures
           (farm_id, name, area_ha, forage_type, rest_period_days,
            max_stocking_rate_ua_ha, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        farmId,
        data.name,
        data.areaHa,
        data.forageType,
        data.restPeriodDays,
        data.maxStockingRateUaHa,
        data.active ? 1 : 0,
        now,
        now,
      ).lastInsertRowid,
  );
}

/** @returns {boolean} whether a row was updated */
export function updatePasture(db, farmIds, pastureId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE pastures SET
         name = ?, area_ha = ?, forage_type = ?, rest_period_days = ?,
         max_stocking_rate_ua_ha = ?, active = ?, updated_at = ?
       WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      data.name,
      data.areaHa,
      data.forageType,
      data.restPeriodDays,
      data.maxStockingRateUaHa,
      data.active ? 1 : 0,
      new Date().toISOString(),
      pastureId,
      ...params,
    );

  return result.changes > 0;
}

/** @returns {number} how many active animals currently occupy this pasture */
export function countOccupants(db, pastureId) {
  return db
    .prepare("SELECT COUNT(*) AS c FROM animals WHERE pasture_id = ? AND status = 'ativo'")
    .get(pastureId).c;
}
