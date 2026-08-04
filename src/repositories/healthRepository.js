/**
 * Sanitary protocol and event queries.
 *
 * `health_events` holds vaccines and treatments in one table with a `kind`
 * discriminator (see migration 001): identical columns, identical overdue
 * rule, identical carência rule. The Vacinas and Tratamentos screens are two
 * filtered views over it, so the overdue logic exists once and cannot diverge
 * between them - which was a leading hypothesis for the original "72 vacinas
 * atrasadas" report.
 */

import { inClause } from '../middleware/tenant.js';

export const EVENT_SORT_COLUMNS = Object.freeze({
  scheduledDate: 'he.scheduled_date',
  earTag: 'a.ear_tag',
  name: 'he.name',
  appliedDate: 'he.applied_date',
});

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

export function listProtocols(db, farmIds, { kind = null, activeOnly = false } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`p.farm_id IN (${placeholders})`];
  const values = [...params];

  if (kind) {
    conditions.push('p.kind = ?');
    values.push(kind);
  }
  if (activeOnly) conditions.push('p.active = 1');

  return db
    .prepare(
      `SELECT p.id, p.name, p.kind, p.product, p.dose, p.dose_unit,
              p.withdrawal_days, p.schedule_mode, p.age_days, p.interval_days,
              p.active, p.farm_id, f.name AS farm_name
         FROM health_protocols p
         JOIN farms f ON f.id = p.farm_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY f.name, p.kind, p.name`,
    )
    .all(...values);
}

export function findProtocolInScope(db, farmIds, protocolId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, name, kind, product, dose, dose_unit, withdrawal_days,
              schedule_mode, age_days, interval_days, active, farm_id
         FROM health_protocols
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(protocolId, ...params);
}

export function insertProtocol(db, farmId, data) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO health_protocols
           (farm_id, name, kind, product, dose, dose_unit, withdrawal_days,
            schedule_mode, age_days, interval_days, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        farmId, data.name, data.kind, data.product, data.dose, data.doseUnit,
        data.withdrawalDays, data.scheduleMode, data.ageDays, data.intervalDays,
        data.active ? 1 : 0, now, now,
      ).lastInsertRowid,
  );
}

export function updateProtocol(db, farmIds, protocolId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE health_protocols SET
         name = ?, kind = ?, product = ?, dose = ?, dose_unit = ?,
         withdrawal_days = ?, schedule_mode = ?, age_days = ?, interval_days = ?,
         active = ?, updated_at = ?
       WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      data.name, data.kind, data.product, data.dose, data.doseUnit,
      data.withdrawalDays, data.scheduleMode, data.ageDays, data.intervalDays,
      data.active ? 1 : 0, new Date().toISOString(), protocolId, ...params,
    );

  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function buildEventFilter(farmIds, { kind, status, search, lotId, today } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`a.farm_id IN (${placeholders})`];
  const values = [...params];

  if (kind) {
    conditions.push('he.kind = ?');
    values.push(kind);
  }
  if (search) {
    conditions.push("a.ear_tag LIKE ? ESCAPE '\\'");
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (lotId) {
    conditions.push('a.lot_id = ?');
    values.push(lotId);
  }

  // The overdue definition, applied identically wherever it appears: due
  // before today, never applied, and the animal still active.
  if (status === 'atrasada') {
    conditions.push('he.applied_date IS NULL AND he.scheduled_date < ? AND a.status = ?');
    values.push(today, 'ativo');
  } else if (status === 'a-vencer') {
    conditions.push('he.applied_date IS NULL AND he.scheduled_date >= ? AND a.status = ?');
    values.push(today, 'ativo');
  } else if (status === 'aplicada') {
    conditions.push('he.applied_date IS NOT NULL');
  }

  return { where: conditions.join(' AND '), values };
}

export function countEvents(db, farmIds, filters = {}) {
  const { where, values } = buildEventFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM health_events he
         JOIN animals a ON a.id = he.animal_id
        WHERE ${where}`,
    )
    .get(...values).c;
}

export function listEvents(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildEventFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT he.id, he.animal_id, he.kind, he.name, he.product, he.dose, he.dose_unit,
              he.scheduled_date, he.applied_date, he.withdrawal_days, he.batch_number,
              a.ear_tag, a.status AS animal_status, a.birth_date,
              l.name AS lot_name,
              u.name AS applicator_name
         FROM health_events he
         JOIN animals a ON a.id = he.animal_id
         LEFT JOIN lots l ON l.id = a.lot_id
         LEFT JOIN users u ON u.id = he.applicator_user_id
        WHERE ${where}
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

export function listAllEvents(db, farmIds, filters = {}) {
  const { where, values } = buildEventFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT a.ear_tag, he.kind, he.name, he.product, he.scheduled_date,
              he.applied_date, he.withdrawal_days, l.name AS lot_name
         FROM health_events he
         JOIN animals a ON a.id = he.animal_id
         LEFT JOIN lots l ON l.id = a.lot_id
        WHERE ${where}
        ORDER BY he.scheduled_date DESC, a.ear_tag`,
    )
    .all(...values);
}

export function findEventInScope(db, farmIds, eventId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT he.id, he.animal_id, he.kind, he.name, he.product, he.dose, he.dose_unit,
              he.scheduled_date, he.applied_date, he.withdrawal_days,
              a.ear_tag, a.birth_date, a.farm_id
         FROM health_events he
         JOIN animals a ON a.id = he.animal_id
        WHERE he.id = ? AND a.farm_id IN (${placeholders})`,
    )
    .get(eventId, ...params);
}

/**
 * Records the application of a scheduled dose.
 *
 * Refuses a dose that was already applied, so a double submission cannot
 * silently restart the carência clock from a later date.
 *
 * @returns {boolean} whether a row was updated
 */
export function markApplied(db, farmIds, eventId, { appliedDate, applicatorUserId, batchNumber, notes }) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE health_events
          SET applied_date = ?, applicator_user_id = ?, batch_number = ?,
              notes = ?, updated_at = ?
        WHERE id = ?
          AND applied_date IS NULL
          AND animal_id IN (SELECT id FROM animals WHERE farm_id IN (${placeholders}))`,
    )
    .run(appliedDate, applicatorUserId, batchNumber, notes, new Date().toISOString(), eventId, ...params);

  return result.changes > 0;
}

/**
 * Schedules doses for many animals at once, in one transaction.
 *
 * @param {Array<object>} entries
 * @returns {number} how many rows were inserted
 */
export function insertEventBatch(db, entries) {
  const statement = db.prepare(
    `INSERT INTO health_events
       (animal_id, protocol_id, kind, name, product, dose, dose_unit,
        scheduled_date, withdrawal_days, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const run = db.transaction((rows) => {
    const now = new Date().toISOString();
    for (const row of rows) {
      statement.run(
        row.animalId, row.protocolId, row.kind, row.name, row.product,
        row.dose, row.doseUnit, row.scheduledDate, row.withdrawalDays, now, now,
      );
    }
    return rows.length;
  });

  return run(entries);
}

export function deleteEvent(db, farmIds, eventId) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `DELETE FROM health_events
        WHERE id = ?
          AND animal_id IN (SELECT id FROM animals WHERE farm_id IN (${placeholders}))`,
    )
    .run(eventId, ...params);

  return result.changes > 0;
}

/**
 * Every applied dose for one animal that carries a carência, for the
 * withdrawal evaluation on its detail page.
 */
export function listAppliedWithWithdrawal(db, animalId) {
  return db
    .prepare(
      `SELECT name, applied_date, withdrawal_days
         FROM health_events
        WHERE animal_id = ? AND applied_date IS NOT NULL AND withdrawal_days > 0
        ORDER BY applied_date DESC`,
    )
    .all(animalId)
    .map((row) => ({
      name: row.name,
      appliedDate: row.applied_date,
      withdrawalDays: row.withdrawal_days,
    }));
}

/**
 * Animals currently within a withdrawal period, across the given scope.
 *
 * Computed in SQL rather than by loading every animal's history, because the
 * Vendas module (Phase 11) needs to warn about this at the point of sale.
 */
export function listAnimalsUnderWithdrawal(db, farmIds, today) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT a.id AS animal_id, a.ear_tag,
              MAX(date(he.applied_date, '+' || he.withdrawal_days || ' days')) AS release_date
         FROM health_events he
         JOIN animals a ON a.id = he.animal_id
        WHERE a.farm_id IN (${placeholders})
          AND a.status = 'ativo'
          AND he.applied_date IS NOT NULL
          AND he.withdrawal_days > 0
        GROUP BY a.id
       HAVING release_date > ?
        ORDER BY release_date`,
    )
    .all(...params, today)
    .map((row) => ({
      animalId: row.animal_id,
      earTag: row.ear_tag,
      releaseDate: row.release_date,
    }));
}
