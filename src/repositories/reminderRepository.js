/**
 * Lembretes queries.
 */

import { inClause } from '../middleware/tenant.js';

function buildFilter(farmIds, { status, assignedUserId } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`r.farm_id IN (${placeholders})`];
  const values = [...params];

  if (status === 'pendente') conditions.push('r.done_at IS NULL');
  else if (status === 'concluido') conditions.push('r.done_at IS NOT NULL');

  if (assignedUserId) {
    conditions.push('r.assigned_user_id = ?');
    values.push(assignedUserId);
  }

  return { where: conditions.join(' AND '), values };
}

export function listReminders(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT r.id, r.title, r.description, r.due_date, r.done_at, r.recurrence,
              r.assigned_user_id, u.name AS assigned_name, f.name AS farm_name
         FROM reminders r
         LEFT JOIN users u ON u.id = r.assigned_user_id
         JOIN farms f ON f.id = r.farm_id
        WHERE ${where}
        ORDER BY (r.done_at IS NOT NULL), r.due_date`,
    )
    .all(...values);
}

export function findReminderInScope(db, farmIds, reminderId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, farm_id, title, description, due_date, done_at, recurrence, assigned_user_id
         FROM reminders
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(reminderId, ...params);
}

/**
 * The upcoming-events widget: open reminders due within the window, soonest
 * first, plus anything already overdue.
 */
export function listUpcoming(db, farmIds, { until, limit = 5 } = {}) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT r.id, r.title, r.due_date, u.name AS assigned_name
         FROM reminders r
         LEFT JOIN users u ON u.id = r.assigned_user_id
        WHERE r.farm_id IN (${placeholders})
          AND r.done_at IS NULL
          AND r.due_date <= ?
        ORDER BY r.due_date
        LIMIT ?`,
    )
    .all(...params, until, limit);
}

export function insertReminder(db, farmId, data, createdBy) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO reminders
           (farm_id, title, description, due_date, assigned_user_id, recurrence,
            created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(farmId, data.title, data.description, data.dueDate, data.assignedUserId, data.recurrence, createdBy, now, now)
      .lastInsertRowid,
  );
}

export function updateReminder(db, farmIds, reminderId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE reminders SET
         title = ?, description = ?, due_date = ?, assigned_user_id = ?,
         recurrence = ?, updated_at = ?
       WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      data.title, data.description, data.dueDate, data.assignedUserId,
      data.recurrence, new Date().toISOString(), reminderId, ...params,
    );

  return result.changes > 0;
}

/**
 * Marks a reminder done (or reopens it), scoped to the caller.
 *
 * @param {boolean} done
 */
export function setReminderDone(db, farmIds, reminderId, done) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE reminders SET done_at = ?, updated_at = ?
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      done ? new Date().toISOString() : null,
      new Date().toISOString(),
      reminderId,
      ...params,
    );

  return result.changes > 0;
}
