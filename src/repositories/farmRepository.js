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

/**
 * Every farm in scope with its derived counters - the Fazendas list.
 *
 * As with lots, the counters are computed here rather than stored, so no
 * counter can drift from the rows it is supposed to summarise.
 */
export function listWithDetails(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT f.id, f.name, f.city, f.state, f.total_area_ha,
              (SELECT COUNT(*) FROM animals a
                WHERE a.farm_id = f.id AND a.status = 'ativo')      AS active_animals,
              (SELECT COUNT(*) FROM lots l
                WHERE l.farm_id = f.id AND l.active = 1)            AS lot_count,
              (SELECT COUNT(*) FROM pastures p
                WHERE p.farm_id = f.id AND p.active = 1)            AS pasture_count,
              (SELECT COALESCE(SUM(p.area_ha), 0) FROM pastures p
                WHERE p.farm_id = f.id AND p.active = 1)            AS pasture_area_ha
         FROM farms f
        WHERE f.id IN (${placeholders})
        ORDER BY f.name`,
    )
    .all(...params);
}

/** One farm with its full detail, scoped. */
export function findDetailInScope(db, farmIds, farmId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, city, state, total_area_ha
         FROM farms
        WHERE id IN (${placeholders}) AND id = ?`,
    )
    .get(...params, farmId);
}

/**
 * Creates a farm and immediately grants the creating user access to it.
 *
 * The two writes are one transaction on purpose: a farm nobody can see is
 * unreachable through the tenant scope, so a failure between the two would
 * strand a row that no interface could ever open or delete.
 *
 * @returns {number} the new farm's id
 */
export function insertFarmForUser(db, userId, data) {
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    const farmId = Number(
      db
        .prepare(
          `INSERT INTO farms (name, city, state, total_area_ha, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(data.name, data.city, data.state, data.totalAreaHa, now, now).lastInsertRowid,
    );

    db.prepare('INSERT INTO user_farms (user_id, farm_id) VALUES (?, ?)').run(userId, farmId);

    return farmId;
  });

  return run();
}

/** @returns {boolean} whether a row was updated */
export function updateFarm(db, farmIds, farmId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE farms SET name = ?, city = ?, state = ?, total_area_ha = ?, updated_at = ?
        WHERE id = ? AND id IN (${placeholders})`,
    )
    .run(data.name, data.city, data.state, data.totalAreaHa, new Date().toISOString(), farmId, ...params);

  return result.changes > 0;
}
