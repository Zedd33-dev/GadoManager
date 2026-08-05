/**
 * Animal queries.
 *
 * Every function takes `farmIds` and binds it. There is deliberately no
 * variant that reads or writes animals without a scope - if such a function
 * existed, sooner or later a route would call it (issue SEC-06).
 */

import { inClause } from '../middleware/tenant.js';

/**
 * Counts animals visible to the given scope.
 *
 * The simplest possible scoped read - kept as-is (rather than folded into
 * `countFiltered` below) because it is what the multi-tenant isolation tests
 * in `tests/integration/tenantIsolation.test.js` exercise directly, as the
 * plainest demonstration that a scope with no farms reads nothing.
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
 * Lists animals visible to the given scope, unfiltered and unpaginated.
 *
 * Same rationale as `countInScope`: the simple case the isolation tests rely
 * on directly. `listPaginated` below is what the actual Animais screen uses.
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
 * Every distinct breed currently in use within the given scope, for the
 * filter/form <datalist> suggestions. Breed is free text (migration 005), so
 * there is no fixed enum to offer instead - this is the closest equivalent:
 * whatever the farm has actually typed before.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @returns {string[]}
 */
export function listDistinctBreeds(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT DISTINCT breed
         FROM animals
        WHERE farm_id IN (${placeholders})
        ORDER BY breed`,
    )
    .all(...params)
    .map((row) => row.breed);
}

/**
 * Public sort keys accepted by the Animais list, mapped to the literal SQL
 * expression each one sorts by. Passed to `lib/sorting.js#resolveSort`, which
 * is what keeps an arbitrary request value from ever reaching `ORDER BY`.
 */
export const ANIMAL_SORT_COLUMNS = Object.freeze({
  earTag: 'a.ear_tag',
  birthDate: 'a.birth_date',
  breed: 'a.breed',
  sex: 'a.sex',
  status: 'a.status',
  lot: 'lot_name',
  weight: 'latest_weight_kg',
});

/**
 * Escapes `%` and `_` in a user-supplied search term so a LIKE pattern
 * matches them literally instead of as SQL wildcards.
 *
 * @param {string} term
 * @returns {string}
 */
function escapeLikeTerm(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Builds the shared WHERE clause for the list and its count, so the two
 * queries cannot drift apart from each other - a real risk when a filter is
 * added to one and forgotten in the other.
 */
function buildListFilter(farmIds, { search, status, breed, sex, lotId } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`a.farm_id IN (${placeholders})`];
  const values = [...params];

  if (search) {
    const term = `%${escapeLikeTerm(search)}%`;
    conditions.push("(a.ear_tag LIKE ? ESCAPE '\\' OR a.sisbov LIKE ? ESCAPE '\\')");
    values.push(term, term);
  }
  if (status) {
    conditions.push('a.status = ?');
    values.push(status);
  }
  if (breed) {
    conditions.push('a.breed = ?');
    values.push(breed);
  }
  if (sex) {
    conditions.push('a.sex = ?');
    values.push(sex);
  }
  if (lotId) {
    conditions.push('a.lot_id = ?');
    values.push(lotId);
  }

  return { where: conditions.join(' AND '), values };
}

/**
 * Counts animals matching the list filters - the denominator for pagination.
 *
 * @returns {number}
 */
export function countFiltered(db, farmIds, filters = {}) {
  const { where, values } = buildListFilter(farmIds, filters);
  return db.prepare(`SELECT COUNT(*) AS c FROM animals a WHERE ${where}`).get(...values).c;
}

/**
 * One page of the Animais list: search, column filters, sort, and each
 * animal's current lote/pasto name and most recent weighing.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} farmIds
 * @param {object} options
 * @param {{orderBy: string}} options.sort from `lib/sorting.js#resolveSort`
 * @param {number} options.limit
 * @param {number} options.offset
 * @returns {object[]}
 */
export function listPaginated(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildListFilter(farmIds, filters);

  return db
    .prepare(
      `WITH latest AS (
         SELECT w.animal_id, w.weight_kg,
                ROW_NUMBER() OVER (
                  PARTITION BY w.animal_id ORDER BY w.weigh_date DESC, w.id DESC
                ) AS rn
         FROM weighings w
       )
       SELECT a.id, a.ear_tag, a.sisbov, a.birth_date, a.sex, a.breed, a.origin,
              a.status, a.photo_path,
              l.name AS lot_name, p.name AS pasture_name,
              lw.weight_kg AS latest_weight_kg
         FROM animals a
         LEFT JOIN lots l ON l.id = a.lot_id
         LEFT JOIN pastures p ON p.id = a.pasture_id
         LEFT JOIN latest lw ON lw.animal_id = a.id AND lw.rn = 1
        WHERE ${where}
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

/**
 * Every row matching the current filters, unpaginated - for CSV export. Reuses
 * the exact same WHERE clause as the paginated list, so the export always
 * matches what the screen shows.
 *
 * @returns {object[]}
 */
export function listAllFiltered(db, farmIds, filters = {}) {
  const { where, values } = buildListFilter(farmIds, filters);

  return db
    .prepare(
      `WITH latest AS (
         SELECT w.animal_id, w.weight_kg,
                ROW_NUMBER() OVER (
                  PARTITION BY w.animal_id ORDER BY w.weigh_date DESC, w.id DESC
                ) AS rn
         FROM weighings w
       )
       SELECT a.id, a.ear_tag, a.sisbov, a.birth_date, a.sex, a.breed, a.origin,
              a.status, l.name AS lot_name, p.name AS pasture_name,
              lw.weight_kg AS latest_weight_kg
         FROM animals a
         LEFT JOIN lots l ON l.id = a.lot_id
         LEFT JOIN pastures p ON p.id = a.pasture_id
         LEFT JOIN latest lw ON lw.animal_id = a.id AND lw.rn = 1
        WHERE ${where}
        ORDER BY a.ear_tag`,
    )
    .all(...values);
}

/**
 * Finds one animal, but only if it belongs to a farm in scope.
 *
 * The scope is part of the WHERE clause rather than checked after the fact, so
 * an out-of-scope id is indistinguishable from a nonexistent one - the caller
 * cannot use this to probe whether another farm's animal exists.
 *
 * @returns {object|undefined}
 */
export function findInScope(db, farmIds, animalId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, farm_id, ear_tag, sisbov, birth_date, sex, breed, origin,
              mother_id, purchase_date, purchase_price_cents,
              lot_id, pasture_id, status, photo_path, notes
         FROM animals
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(animalId, ...params);
}

/**
 * The detail-page version of `findInScope`: the same animal, with its lote,
 * pasto and mother's ear tag resolved to display names instead of ids.
 *
 * @returns {object|undefined}
 */
export function findWithDetailsInScope(db, farmIds, animalId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT a.id, a.farm_id, a.ear_tag, a.sisbov, a.birth_date, a.sex, a.breed,
              a.origin, a.mother_id, m.ear_tag AS mother_ear_tag,
              a.purchase_date, a.purchase_price_cents,
              a.lot_id, l.name AS lot_name,
              a.pasture_id, p.name AS pasture_name,
              a.status, a.photo_path, a.notes,
              f.name AS farm_name
         FROM animals a
         LEFT JOIN animals m ON m.id = a.mother_id
         LEFT JOIN lots l ON l.id = a.lot_id
         LEFT JOIN pastures p ON p.id = a.pasture_id
         JOIN farms f ON f.id = a.farm_id
        WHERE a.id = ? AND a.farm_id IN (${placeholders})`,
    )
    .get(animalId, ...params);
}

/**
 * Active females on a farm, as candidates for a newborn calf's `mother_id`.
 *
 * @returns {Array<{id: number, ear_tag: string}>}
 */
export function listCandidateMothers(db, farmId) {
  return db
    .prepare(
      `SELECT id, ear_tag
         FROM animals
        WHERE farm_id = ? AND sex = 'F' AND status = 'ativo'
        ORDER BY ear_tag
        LIMIT 200`,
    )
    .all(farmId);
}

/**
 * Inserts a new animal on the given farm.
 *
 * @returns {number} the new animal's id
 */
export function insertAnimal(db, farmId, data) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO animals
           (farm_id, ear_tag, sisbov, birth_date, sex, breed, origin, mother_id,
            purchase_date, purchase_price_cents, lot_id, pasture_id, status,
            photo_path, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        farmId,
        data.earTag,
        data.sisbov,
        data.birthDate,
        data.sex,
        data.breed,
        data.origin,
        data.motherId,
        data.purchaseDate,
        data.purchasePriceCents,
        data.lotId,
        data.pastureId,
        data.status,
        data.photoPath,
        data.notes,
        now,
        now,
      ).lastInsertRowid,
  );
}

/**
 * Updates an animal, scoped to the caller's farms.
 *
 * @returns {boolean} whether a row was actually updated
 */
export function updateAnimal(db, farmIds, animalId, data) {
  const { placeholders, params } = inClause(farmIds);
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE animals SET
         ear_tag = ?, sisbov = ?, birth_date = ?, sex = ?, breed = ?, origin = ?,
         mother_id = ?, purchase_date = ?, purchase_price_cents = ?,
         lot_id = ?, pasture_id = ?, status = ?, notes = ?, updated_at = ?
       WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      data.earTag,
      data.sisbov,
      data.birthDate,
      data.sex,
      data.breed,
      data.origin,
      data.motherId,
      data.purchaseDate,
      data.purchasePriceCents,
      data.lotId,
      data.pastureId,
      data.status,
      data.notes,
      now,
      animalId,
      ...params,
    );

  return result.changes > 0;
}

/**
 * Replaces (or sets) an animal's stored photo path, scoped to the caller.
 *
 * @returns {boolean} whether a row was updated
 */
export function updatePhotoPath(db, farmIds, animalId, photoPath) {
  const { placeholders, params } = inClause(farmIds);
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `UPDATE animals SET photo_path = ?, updated_at = ? WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(photoPath, now, animalId, ...params);

  return result.changes > 0;
}

/**
 * Permanently deletes the given animals, scoped to the caller's farms.
 *
 * A hard delete, unlike every other exit from the herd (venda, morte,
 * transferência), which are recorded as a status change precisely so the
 * history survives. This exists only to correct a genuine data-entry mistake
 * - a duplicate registration, an animal that should never have been created -
 * which is why the capability that guards it (`animals:delete`) is
 * admin-only. Cascades to the animal's weighings, health events, movements
 * and sale items by the schema's own `ON DELETE CASCADE`.
 *
 * @param {number[]} animalIds
 * @returns {number} how many rows were actually deleted
 */
export function deleteAnimals(db, farmIds, animalIds) {
  if (!Array.isArray(animalIds) || animalIds.length === 0) return 0;

  const { placeholders: farmPlaceholders, params: farmParams } = inClause(farmIds);
  const { placeholders: idPlaceholders, params: idParams } = inClause(animalIds);

  const result = db
    .prepare(
      `DELETE FROM animals WHERE id IN (${idPlaceholders}) AND farm_id IN (${farmPlaceholders})`,
    )
    .run(...idParams, ...farmParams);

  return result.changes;
}

/**
 * Combined timeline for the animal detail page: weighings, sanitary events
 * and movements, in one reverse-chronological list.
 *
 * Each source has a different natural date column and a different set of
 * useful fields, so the three are read separately and merged in JavaScript
 * rather than forced into one UNION query that would need every column padded
 * to the same shape.
 *
 * The caller must already have verified the animal is in scope (via
 * `findInScope`); these queries read by `animal_id` alone; scoping happens
 * once, at the point the id was resolved, not on every table it touches.
 *
 * @returns {Array<{date: string, kind: string, description: string}>}
 */
export function getTimeline(db, animalId) {
  const weighings = db
    .prepare(
      `SELECT weigh_date AS date, weight_kg, source
         FROM weighings WHERE animal_id = ? ORDER BY weigh_date DESC`,
    )
    .all(animalId)
    .map((row) => ({
      date: row.date,
      kind: 'pesagem',
      weightKg: row.weight_kg,
      source: row.source,
    }));

  const healthEvents = db
    .prepare(
      `SELECT kind, name, scheduled_date, applied_date
         FROM health_events WHERE animal_id = ? ORDER BY scheduled_date DESC`,
    )
    .all(animalId)
    .map((row) => ({
      date: row.applied_date ?? row.scheduled_date,
      kind: row.kind,
      name: row.name,
      applied: row.applied_date !== null,
    }));

  const movements = db
    .prepare(
      `SELECT m.moved_at,
              fl.name AS from_lot, tl.name AS to_lot,
              fp.name AS from_pasture, tp.name AS to_pasture,
              m.reason
         FROM movements m
         LEFT JOIN lots fl ON fl.id = m.from_lot_id
         LEFT JOIN lots tl ON tl.id = m.to_lot_id
         LEFT JOIN pastures fp ON fp.id = m.from_pasture_id
         LEFT JOIN pastures tp ON tp.id = m.to_pasture_id
        WHERE m.animal_id = ?
        ORDER BY m.moved_at DESC`,
    )
    .all(animalId)
    .map((row) => ({
      date: row.moved_at.slice(0, 10),
      kind: 'movimentacao',
      fromLot: row.from_lot,
      toLot: row.to_lot,
      fromPasture: row.from_pasture,
      toPasture: row.to_pasture,
      reason: row.reason,
    }));

  return [...weighings, ...healthEvents, ...movements].sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * The animal's weighing history in chronological order, for its weight-curve
 * chart on the detail page.
 *
 * @returns {Array<{date: string, weightKg: number}>}
 */
export function getWeightHistory(db, animalId) {
  return db
    .prepare(
      `SELECT weigh_date AS date, weight_kg AS weight_kg
         FROM weighings WHERE animal_id = ? ORDER BY weigh_date ASC`,
    )
    .all(animalId)
    .map((row) => ({ date: row.date, weightKg: row.weight_kg }));
}
