/**
 * Dashboard aggregate queries.
 *
 * One named function per KPI, each with a single inspectable statement. This is
 * what makes the requirement to "write a short proof for each KPI" satisfiable:
 * the SQL below is the proof, and `docs/business-rules.md` walks through it.
 *
 * Every function takes `farmIds` and binds it into the query. Nothing here reads
 * herd data without a tenant scope.
 *
 * Every function also accepts an optional `{lotId}` to narrow the same
 * calculation to one lote, for the dashboard's lote filter. When `lotId` is
 * `null` (the default) the clause is `(? IS NULL OR a.lot_id = ?)`, which is
 * always true and therefore a no-op - the same statement serves both the
 * filtered and unfiltered case, so there is no second code path to keep in
 * sync with the first.
 *
 * Dates arrive as ISO strings and are compared as strings, which is valid
 * because the schema enforces `YYYY-MM-DD` - lexicographic order and calendar
 * order coincide in that format.
 */

import { inClause, namedInClause } from '../middleware/tenant.js';
import { ANIMAL_STATUS } from '../domain/constants.js';

/**
 * Counts animals by status within scope.
 *
 * One row per animal, no joins, so no fan-out is possible.
 *
 * @returns {{total: number, ativo: number, vendido: number, morto: number, transferido: number}}
 */
export function countAnimalsByStatus(db, farmIds, { lotId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);

  const row = db
    .prepare(
      `SELECT
         COUNT(*)                                                   AS total,
         SUM(CASE WHEN status = 'ativo'       THEN 1 ELSE 0 END)    AS ativo,
         SUM(CASE WHEN status = 'vendido'     THEN 1 ELSE 0 END)    AS vendido,
         SUM(CASE WHEN status = 'morto'       THEN 1 ELSE 0 END)    AS morto,
         SUM(CASE WHEN status = 'transferido' THEN 1 ELSE 0 END)    AS transferido
       FROM animals
       WHERE farm_id IN (${placeholders})
         AND (? IS NULL OR lot_id = ?)`,
    )
    .get(...params, lotId, lotId);

  // SUM over zero rows returns NULL in SQL; the dashboard wants 0 there.
  return {
    total: row.total ?? 0,
    ativo: row.ativo ?? 0,
    vendido: row.vendido ?? 0,
    morto: row.morto ?? 0,
    transferido: row.transferido ?? 0,
  };
}

/**
 * Average of each active animal's most recent weighing.
 *
 * `ROW_NUMBER()` partitioned per animal and filtered to `rn = 1` yields exactly
 * one row per animal - the latest weighing. Averaging the weighings table
 * directly would instead average every weighing ever taken, which weights
 * long-tenured animals more heavily and understates the current herd.
 *
 * `ORDER BY weigh_date DESC, id DESC` breaks same-date ties deterministically,
 * so the figure does not change between runs.
 *
 * @returns {{averageKg: number|null, animalCount: number}}
 */
export function latestWeightAverage(db, farmIds, { lotId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);

  const row = db
    .prepare(
      `WITH latest AS (
         SELECT w.weight_kg,
                ROW_NUMBER() OVER (
                  PARTITION BY w.animal_id
                  ORDER BY w.weigh_date DESC, w.id DESC
                ) AS rn
         FROM weighings w
         JOIN animals a ON a.id = w.animal_id
         WHERE a.farm_id IN (${placeholders})
           AND a.status = ?
           AND (? IS NULL OR a.lot_id = ?)
       )
       SELECT AVG(weight_kg) AS average_kg,
              COUNT(*)       AS animal_count
       FROM latest
       WHERE rn = 1`,
    )
    .get(...params, ANIMAL_STATUS.ACTIVE, lotId, lotId);

  return {
    averageKg: row.average_kg,
    animalCount: row.animal_count ?? 0,
  };
}

/**
 * Average daily gain across the herd.
 *
 * Per animal: (latest weight - previous weight) / days between those weighings.
 * Averaged only over animals that have at least two weighings.
 *
 * The exclusion is enforced by the join, not by application logic: an animal
 * with a single weighing has no row at `rn = 2`, so the inner join produces no
 * row for it and it leaves both the numerator and the denominator. It is never
 * counted as a zero-gain animal.
 *
 * `delta_days > 0` guards the division. A zero denominator is already
 * impossible because of `UNIQUE(animal_id, weigh_date)`, but the guard makes the
 * query safe to read in isolation.
 *
 * @returns {{averageKgPerDay: number|null, animalCount: number}}
 */
export function averageDailyGain(db, farmIds, { lotId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);

  const row = db
    .prepare(
      `WITH ranked AS (
         SELECT w.animal_id, w.weigh_date, w.weight_kg,
                ROW_NUMBER() OVER (
                  PARTITION BY w.animal_id
                  ORDER BY w.weigh_date DESC, w.id DESC
                ) AS rn
         FROM weighings w
         JOIN animals a ON a.id = w.animal_id
         WHERE a.farm_id IN (${placeholders})
           AND a.status = ?
           AND (? IS NULL OR a.lot_id = ?)
       ),
       pairs AS (
         SELECT curr.weight_kg - prev.weight_kg                          AS delta_kg,
                julianday(curr.weigh_date) - julianday(prev.weigh_date)  AS delta_days
         FROM ranked curr
         JOIN ranked prev
           ON prev.animal_id = curr.animal_id
          AND prev.rn = 2
         WHERE curr.rn = 1
       )
       SELECT AVG(delta_kg / delta_days) AS average_gain,
              COUNT(*)                   AS animal_count
       FROM pairs
       WHERE delta_days > 0`,
    )
    .get(...params, ANIMAL_STATUS.ACTIVE, lotId, lotId);

  return {
    averageKgPerDay: row.average_gain,
    animalCount: row.animal_count ?? 0,
  };
}

/**
 * Overdue and upcoming sanitary events.
 *
 * A dose is overdue when all three conditions hold:
 *   1. `scheduled_date < today`
 *   2. `applied_date IS NULL`
 *   3. the animal is still active
 *
 * All three are mandatory here. Dropping the third is the leading explanation
 * for a herd of 34 animals reporting 72 overdue vaccines: sold and dead animals
 * keep raising alerts forever.
 *
 * The single join is many-to-one (`health_events` -> `animals`), so the result
 * has exactly one row per event and fan-out is structurally impossible.
 *
 * `overdueAnimals` is returned alongside the dose counts so the interface can
 * say "72 doses atrasadas em 41 animais" rather than a bare number whose
 * denominator the reader has to guess.
 *
 * @param {string} today ISO date
 * @param {string} horizon ISO date, end of the "a vencer" window
 */
export function healthAlertCounts(db, farmIds, today, horizon, { lotId = null } = {}) {
  // Named parameters throughout: `:today` appears five times, and SQLite will
  // not mix named and anonymous placeholders in one statement. Unlike an
  // anonymous `?`, a named parameter only needs to be bound once even if the
  // query refers to it more than once.
  const { placeholders, params } = namedInClause(farmIds);

  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN he.kind = 'vacina'
                   AND he.scheduled_date < :today THEN 1 ELSE 0 END)    AS overdue_vaccine_doses,
         SUM(CASE WHEN he.kind = 'tratamento'
                   AND he.scheduled_date < :today THEN 1 ELSE 0 END)    AS overdue_treatment_doses,
         COUNT(DISTINCT CASE WHEN he.scheduled_date < :today
                             THEN he.animal_id END)                     AS overdue_animals,
         SUM(CASE WHEN he.scheduled_date >= :today
                   AND he.scheduled_date <= :horizon THEN 1 ELSE 0 END) AS due_soon_doses,
         COUNT(DISTINCT CASE WHEN he.scheduled_date >= :today
                              AND he.scheduled_date <= :horizon
                             THEN he.animal_id END)                     AS due_soon_animals
       FROM health_events he
       JOIN animals a ON a.id = he.animal_id
       WHERE he.applied_date IS NULL
         AND a.status = :activeStatus
         AND a.farm_id IN (${placeholders})
         AND (:lotId IS NULL OR a.lot_id = :lotId)`,
    )
    .get({
      today,
      horizon,
      activeStatus: ANIMAL_STATUS.ACTIVE,
      lotId,
      ...params,
    });

  return {
    overdueVaccineDoses: row.overdue_vaccine_doses ?? 0,
    overdueTreatmentDoses: row.overdue_treatment_doses ?? 0,
    overdueAnimals: row.overdue_animals ?? 0,
    dueSoonDoses: row.due_soon_doses ?? 0,
    dueSoonAnimals: row.due_soon_animals ?? 0,
  };
}

/**
 * Active animals with no weighing since the cutoff.
 *
 * `NOT EXISTS` covers both "weighed, but too long ago" and "never weighed",
 * which is correct - both populations need weighing. They are reported
 * separately because they call for different action: one is an overdue routine,
 * the other is an animal that was never entered into the weighing programme.
 *
 * @param {string} cutoff ISO date; a weighing on or after this counts as recent
 */
export function animalsWithoutRecentWeighing(db, farmIds, cutoff, { lotId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);

  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN NOT EXISTS (
               SELECT 1 FROM weighings w WHERE w.animal_id = a.id
             ) THEN 1 ELSE 0 END) AS never_weighed
       FROM animals a
       WHERE a.farm_id IN (${placeholders})
         AND a.status = ?
         AND (? IS NULL OR a.lot_id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM weighings w
           WHERE w.animal_id = a.id
             AND w.weigh_date >= ?
         )`,
    )
    .get(...params, ANIMAL_STATUS.ACTIVE, lotId, lotId, cutoff);

  return {
    total: row.total ?? 0,
    neverWeighed: row.never_weighed ?? 0,
  };
}

/**
 * Cost total over a half-open date range.
 *
 * `[from, until)` includes every day of a month regardless of its length and
 * cannot double-count a boundary date, which a `BETWEEN` on month ends would.
 *
 * `entryCount` is returned so the caller can distinguish "no costs recorded"
 * from "costs recorded that sum to zero". Rendering both as R$ 0,00 is the
 * defect this KPI exists to avoid.
 *
 * When `lotId` is given, only costs allocated directly to that lote are
 * summed - a farm-wide cost (`costs.lot_id IS NULL`) is deliberately excluded,
 * since a lote's own cost figure should not silently absorb overhead that was
 * never attributed to it.
 *
 * @param {string} from ISO date, inclusive
 * @param {string} until ISO date, exclusive
 */
export function costTotalInRange(db, farmIds, from, until, { lotId = null } = {}) {
  const { placeholders, params } = inClause(farmIds);

  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total_cents,
              COUNT(*)                       AS entry_count
       FROM costs
       WHERE farm_id IN (${placeholders})
         AND cost_date >= ?
         AND cost_date <  ?
         AND (? IS NULL OR lot_id = ?)`,
    )
    .get(...params, from, until, lotId, lotId);

  return {
    totalCents: row.total_cents ?? 0,
    entryCount: row.entry_count ?? 0,
  };
}

/**
 * Farm and active-lot counts within scope.
 *
 * Not affected by a lote filter - "how many lotes exist" is a structural fact
 * about the farm, not a figure that narrows to a single lote.
 */
export function structureCounts(db, farmIds) {
  const { placeholders, params } = inClause(farmIds);

  const farms = db
    .prepare(`SELECT COUNT(*) AS c FROM farms WHERE id IN (${placeholders})`)
    .get(...params).c;

  const lots = db
    .prepare(
      `SELECT COUNT(*) AS c FROM lots WHERE farm_id IN (${placeholders}) AND active = 1`,
    )
    .get(...params).c;

  return { farms, lots };
}
