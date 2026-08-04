/**
 * Movement (movimentação) queries.
 */

import { inClause } from '../middleware/tenant.js';

export const MOVEMENT_SORT_COLUMNS = Object.freeze({
  movedAt: 'm.moved_at',
  earTag: 'a.ear_tag',
});

function buildFilter(farmIds, { search, from, until } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`a.farm_id IN (${placeholders})`];
  const values = [...params];

  if (search) {
    conditions.push("a.ear_tag LIKE ? ESCAPE '\\'");
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (from) {
    conditions.push('m.moved_at >= ?');
    values.push(from);
  }
  if (until) {
    // moved_at carries a time component, so an inclusive upper bound needs the
    // whole of the chosen day, not just its midnight.
    conditions.push('m.moved_at <= ?');
    values.push(`${until}T23:59:59.999Z`);
  }

  return { where: conditions.join(' AND '), values };
}

export function countMovements(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM movements m
         JOIN animals a ON a.id = m.animal_id
        WHERE ${where}`,
    )
    .get(...values).c;
}

export function listMovements(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT m.id, m.animal_id, m.moved_at, m.reason,
              a.ear_tag,
              ff.name AS from_farm, tf.name AS to_farm,
              fl.name AS from_lot, tl.name AS to_lot,
              fp.name AS from_pasture, tp.name AS to_pasture,
              u.name AS created_by_name
         FROM movements m
         JOIN animals a ON a.id = m.animal_id
         LEFT JOIN farms ff ON ff.id = m.from_farm_id
         LEFT JOIN farms tf ON tf.id = m.to_farm_id
         LEFT JOIN lots fl ON fl.id = m.from_lot_id
         LEFT JOIN lots tl ON tl.id = m.to_lot_id
         LEFT JOIN pastures fp ON fp.id = m.from_pasture_id
         LEFT JOIN pastures tp ON tp.id = m.to_pasture_id
         LEFT JOIN users u ON u.id = m.created_by
        WHERE ${where}
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

export function listAllMovements(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT a.ear_tag, m.moved_at, m.reason,
              fl.name AS from_lot, tl.name AS to_lot,
              fp.name AS from_pasture, tp.name AS to_pasture
         FROM movements m
         JOIN animals a ON a.id = m.animal_id
         LEFT JOIN lots fl ON fl.id = m.from_lot_id
         LEFT JOIN lots tl ON tl.id = m.to_lot_id
         LEFT JOIN pastures fp ON fp.id = m.from_pasture_id
         LEFT JOIN pastures tp ON tp.id = m.to_pasture_id
        WHERE ${where}
        ORDER BY m.moved_at DESC, a.ear_tag`,
    )
    .all(...values);
}

/**
 * Records a movement for several animals and updates their current location.
 *
 * The whole point of this function is that both writes happen in one
 * transaction. `animals.lot_id` / `pasture_id` are a denormalisation of the
 * movement history; if the history could be written without the update (or the
 * reverse) the two would drift, and the dashboard's lote filter would start
 * disagreeing with the animal's own timeline. That is issue DAT-04.
 *
 * A destination of `null` for lot or pasture means "leave that one as it is",
 * so an animal can be moved between paddocks without disturbing its lote.
 *
 * @param {Array<object>} animals the animals being moved, with their current location
 * @param {{movedAt: string, toLotId: number|null, toPastureId: number|null,
 *          destinationFarmId: number|null, reason: string|null, createdBy: number}} target
 * @returns {number} how many animals were moved
 */
export function recordMovements(db, animals, target) {
  const insertMovement = db.prepare(
    `INSERT INTO movements
       (animal_id, moved_at, from_farm_id, to_farm_id, from_lot_id, to_lot_id,
        from_pasture_id, to_pasture_id, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const updateAnimal = db.prepare(
    `UPDATE animals SET farm_id = ?, lot_id = ?, pasture_id = ?, updated_at = ?
      WHERE id = ?`,
  );

  const run = db.transaction((rows) => {
    const now = new Date().toISOString();
    const movedAtTimestamp = `${target.movedAt}T12:00:00.000Z`;

    for (const animal of rows) {
      const toFarmId = target.destinationFarmId ?? animal.farm_id;
      const toLotId = target.toLotId ?? animal.lot_id;
      const toPastureId = target.toPastureId ?? animal.pasture_id;

      insertMovement.run(
        animal.id, movedAtTimestamp,
        animal.farm_id, toFarmId,
        animal.lot_id, toLotId,
        animal.pasture_id, toPastureId,
        target.reason, target.createdBy, now,
      );

      updateAnimal.run(toFarmId, toLotId, toPastureId, now, animal.id);
    }

    return rows.length;
  });

  return run(animals);
}

/**
 * Animals in scope that can be moved, with their current location.
 *
 * Only active animals: moving one that was sold or died is meaningless, and
 * would produce a location history for an animal no longer in the herd.
 */
export function listMovableAnimals(db, farmIds, { lotId = null, pastureId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`a.farm_id IN (${placeholders})`, "a.status = 'ativo'"];
  const values = [...params];

  if (lotId) {
    conditions.push('a.lot_id = ?');
    values.push(lotId);
  }
  if (pastureId) {
    conditions.push('a.pasture_id = ?');
    values.push(pastureId);
  }

  return db
    .prepare(
      `SELECT a.id, a.ear_tag, a.farm_id, a.lot_id, a.pasture_id,
              l.name AS lot_name, p.name AS pasture_name
         FROM animals a
         LEFT JOIN lots l ON l.id = a.lot_id
         LEFT JOIN pastures p ON p.id = a.pasture_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.ear_tag
        LIMIT 500`,
    )
    .all(...values);
}

/** Fetches specific animals by id, scoped, for a movement submission. */
export function findMovableByIds(db, farmIds, animalIds) {
  if (!Array.isArray(animalIds) || animalIds.length === 0) return [];

  const { placeholders: farmPlaceholders, params: farmParams } = inClause(farmIds);
  const { placeholders: idPlaceholders, params: idParams } = inClause(animalIds);

  return db
    .prepare(
      `SELECT id, ear_tag, farm_id, lot_id, pasture_id
         FROM animals
        WHERE id IN (${idPlaceholders})
          AND farm_id IN (${farmPlaceholders})
          AND status = 'ativo'`,
    )
    .all(...idParams, ...farmParams);
}
