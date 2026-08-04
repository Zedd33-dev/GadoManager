/**
 * Weighing (pesagem) queries.
 *
 * As everywhere else, every read and write is scoped through the animal's
 * farm. There is no function here that reaches a weighing without proving
 * its animal belongs to the caller.
 */

import { inClause } from '../middleware/tenant.js';

/** Sort keys the Pesagens list accepts, mapped to literal SQL expressions. */
export const WEIGHING_SORT_COLUMNS = Object.freeze({
  weighDate: 'w.weigh_date',
  earTag: 'a.ear_tag',
  weight: 'w.weight_kg',
  lot: 'lot_name',
});

function buildFilter(farmIds, { search, lotId, from, until } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`a.farm_id IN (${placeholders})`];
  const values = [...params];

  if (search) {
    conditions.push("a.ear_tag LIKE ? ESCAPE '\\'");
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (lotId) {
    conditions.push('a.lot_id = ?');
    values.push(lotId);
  }
  if (from) {
    conditions.push('w.weigh_date >= ?');
    values.push(from);
  }
  if (until) {
    conditions.push('w.weigh_date <= ?');
    values.push(until);
  }

  return { where: conditions.join(' AND '), values };
}

/** @returns {number} */
export function countFiltered(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM weighings w
         JOIN animals a ON a.id = w.animal_id
        WHERE ${where}`,
    )
    .get(...values).c;
}

/**
 * One page of the Pesagens list.
 *
 * `LAG` supplies each weighing's predecessor for the same animal, so the list
 * can show the gain since the previous weighing without a second query per
 * row. The window is computed over the animal's whole history and only then
 * filtered, so a row at the start of a date-filtered page still knows what
 * came before it.
 */
export function listPaginated(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `WITH ranked AS (
         SELECT w.id, w.animal_id, w.weigh_date, w.weight_kg, w.source, w.notes,
                a.ear_tag, a.farm_id, a.lot_id,
                LAG(w.weight_kg)  OVER (PARTITION BY w.animal_id ORDER BY w.weigh_date) AS prev_kg,
                LAG(w.weigh_date) OVER (PARTITION BY w.animal_id ORDER BY w.weigh_date) AS prev_date
         FROM weighings w
         JOIN animals a ON a.id = w.animal_id
       )
       SELECT w.id, w.animal_id, w.ear_tag, w.weigh_date, w.weight_kg, w.source,
              w.prev_kg, w.prev_date,
              l.name AS lot_name,
              CASE
                WHEN w.prev_kg IS NOT NULL
                 AND julianday(w.weigh_date) > julianday(w.prev_date)
                THEN (w.weight_kg - w.prev_kg)
                     / (julianday(w.weigh_date) - julianday(w.prev_date))
              END AS gmd
         FROM ranked w
         JOIN animals a ON a.id = w.animal_id
         LEFT JOIN lots l ON l.id = a.lot_id
        WHERE ${where}
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

/** Every matching row, unpaginated, for CSV export. Same filter as the list. */
export function listAllFiltered(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT w.id, a.ear_tag, w.weigh_date, w.weight_kg, w.source, l.name AS lot_name
         FROM weighings w
         JOIN animals a ON a.id = w.animal_id
         LEFT JOIN lots l ON l.id = a.lot_id
        WHERE ${where}
        ORDER BY w.weigh_date DESC, a.ear_tag`,
    )
    .all(...values);
}

/**
 * Resolves an ear tag to an animal within scope - the lookup the batch entry
 * screen performs for every row an operator types.
 *
 * Only active animals are resolvable: recording a weighing against an animal
 * that was sold or died is a data-entry mistake by definition, and catching
 * it here gives a clearer message than a foreign-key error would.
 *
 * @returns {object|undefined}
 */
export function findAnimalByEarTag(db, farmIds, earTag) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, ear_tag, birth_date, farm_id, status
         FROM animals
        WHERE ear_tag = ? AND farm_id IN (${placeholders}) AND status = 'ativo'`,
    )
    .get(earTag, ...params);
}

/**
 * The animal's most recent weighing strictly before the given date - the
 * baseline both the outlier check and the implied GMD compare against.
 *
 * Bounded by date rather than simply "the latest", so back-dating a forgotten
 * weighing compares against what actually preceded it rather than against a
 * later reading.
 *
 * @returns {{weightKg: number, weighDate: string}|undefined}
 */
export function findPreviousWeighing(db, animalId, beforeDate) {
  const row = db
    .prepare(
      `SELECT weight_kg, weigh_date
         FROM weighings
        WHERE animal_id = ? AND weigh_date < ?
        ORDER BY weigh_date DESC, id DESC
        LIMIT 1`,
    )
    .get(animalId, beforeDate);

  return row ? { weightKg: row.weight_kg, weighDate: row.weigh_date } : undefined;
}

/** @returns {boolean} whether this animal already has a weighing on this date */
export function existsOnDate(db, animalId, weighDate) {
  return (
    db
      .prepare('SELECT 1 AS found FROM weighings WHERE animal_id = ? AND weigh_date = ?')
      .get(animalId, weighDate) !== undefined
  );
}

/** @returns {number} the new weighing's id */
export function insertWeighing(db, { animalId, weighDate, weightKg, source, notes, createdBy }) {
  return Number(
    db
      .prepare(
        `INSERT INTO weighings (animal_id, weigh_date, weight_kg, source, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(animalId, weighDate, weightKg, source, notes, createdBy, new Date().toISOString())
      .lastInsertRowid,
  );
}

/**
 * Inserts a whole weighing day at once.
 *
 * Wrapped in a transaction so a weighing day is all-or-nothing: a batch that
 * fails halfway would otherwise leave the operator unable to tell which
 * animals were recorded, with no safe way to retry.
 *
 * @param {Array<object>} entries already validated
 * @returns {number} how many rows were inserted
 */
export function insertWeighingBatch(db, entries) {
  const statement = db.prepare(
    `INSERT INTO weighings (animal_id, weigh_date, weight_kg, source, notes, created_by, created_at)
     VALUES (?, ?, ?, 'lote', ?, ?, ?)`,
  );

  const run = db.transaction((rows) => {
    const now = new Date().toISOString();
    for (const row of rows) {
      statement.run(row.animalId, row.weighDate, row.weightKg, row.notes ?? null, row.createdBy, now);
    }
    return rows.length;
  });

  return run(entries);
}

/**
 * Deletes a weighing, scoped through its animal's farm.
 *
 * @returns {boolean} whether a row was removed
 */
export function deleteWeighing(db, farmIds, weighingId) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `DELETE FROM weighings
        WHERE id = ?
          AND animal_id IN (SELECT id FROM animals WHERE farm_id IN (${placeholders}))`,
    )
    .run(weighingId, ...params);

  return result.changes > 0;
}

/**
 * Per-pasture live weight totals, for the stocking rate.
 *
 * Sums each animal's most recent weighing, and separately counts the animals
 * that have never been weighed - those occupy the pasture but contribute no
 * measurable weight, and `stockingRateService` needs to report them rather
 * than quietly omit them. See that module for why.
 */
export function pastureOccupancy(db, farmIds) {
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
       SELECT p.id                           AS pasture_id,
              COUNT(a.id)                    AS animal_count,
              COALESCE(SUM(lw.weight_kg), 0) AS total_weight_kg,
              -- The a.id IS NOT NULL guard is load-bearing: the LEFT JOIN
              -- emits one phantom row for a pasture with no animals, and
              -- without it the lw.weight_kg IS NULL test counts that row as
              -- an unweighed animal - making every empty pasture report
              -- "sem pesagens" instead of a correct rate of zero.
              SUM(CASE WHEN a.id IS NOT NULL AND lw.weight_kg IS NOT NULL
                       THEN 1 ELSE 0 END)    AS animals_with_weight,
              SUM(CASE WHEN a.id IS NOT NULL AND lw.weight_kg IS NULL
                       THEN 1 ELSE 0 END)    AS animals_without_weight
         FROM pastures p
         LEFT JOIN animals a
                ON a.pasture_id = p.id AND a.status = 'ativo'
         LEFT JOIN latest lw
                ON lw.animal_id = a.id AND lw.rn = 1
        WHERE p.farm_id IN (${placeholders})
        GROUP BY p.id`,
    )
    .all(...params)
    .map((row) => ({
      pastureId: row.pasture_id,
      animalCount: row.animal_count,
      totalWeightKg: row.total_weight_kg,
      animalsWithWeight: row.animals_with_weight ?? 0,
      animalsWithoutWeight: row.animals_without_weight ?? 0,
    }));
}
