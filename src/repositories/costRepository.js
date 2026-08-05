/**
 * Custos queries.
 */

import { inClause } from '../middleware/tenant.js';

export const COST_SORT_COLUMNS = Object.freeze({
  costDate: 'c.cost_date',
  amount: 'c.amount_cents',
  category: 'cc.name',
});

function buildFilter(farmIds, { search, categorySlug, lotId, from, until } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`c.farm_id IN (${placeholders})`];
  const values = [...params];

  if (search) {
    conditions.push("c.description LIKE ? ESCAPE '\\'");
    values.push(`%${search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
  }
  if (categorySlug) {
    conditions.push('cc.slug = ?');
    values.push(categorySlug);
  }
  if (lotId) {
    conditions.push('c.lot_id = ?');
    values.push(lotId);
  }
  if (from) {
    conditions.push('c.cost_date >= ?');
    values.push(from);
  }
  if (until) {
    conditions.push('c.cost_date <= ?');
    values.push(until);
  }

  return { where: conditions.join(' AND '), values };
}

export function listCategories(db) {
  return db.prepare('SELECT id, slug, name FROM cost_categories WHERE active = 1 ORDER BY sort_order').all();
}

export function countCosts(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT COUNT(*) AS c
         FROM costs c JOIN cost_categories cc ON cc.id = c.category_id
        WHERE ${where}`,
    )
    .get(...values).c;
}

export function listCosts(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT c.id, c.cost_date, c.amount_cents, c.description, c.is_recurring,
              c.recurrence_months, cc.name AS category_name, cc.slug AS category_slug,
              l.name AS lot_name
         FROM costs c
         JOIN cost_categories cc ON cc.id = c.category_id
         LEFT JOIN lots l ON l.id = c.lot_id
        WHERE ${where}
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

export function listAllCosts(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT c.cost_date, cc.name AS category_name, c.amount_cents,
              c.description, l.name AS lot_name
         FROM costs c
         JOIN cost_categories cc ON cc.id = c.category_id
         LEFT JOIN lots l ON l.id = c.lot_id
        WHERE ${where}
        ORDER BY c.cost_date DESC`,
    )
    .all(...values);
}

export function findCostInScope(db, farmIds, costId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, farm_id, lot_id, category_id, cost_date, amount_cents,
              description, is_recurring, recurrence_months
         FROM costs
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(costId, ...params);
}

/**
 * Inserts one or several cost rows (a recurring cost expands to several) in a
 * single transaction, so a batch of twelve monthly entries is all-or-nothing.
 *
 * @param {Array<{costDate: string}>} occurrences from `expandRecurrence`
 * @returns {number} how many rows were inserted
 */
export function insertCostBatch(db, farmId, data, occurrences, createdBy) {
  const statement = db.prepare(
    `INSERT INTO costs
       (farm_id, lot_id, category_id, cost_date, amount_cents, description,
        is_recurring, recurrence_months, created_by, created_at, updated_at)
     VALUES (?, ?, (SELECT id FROM cost_categories WHERE slug = ?), ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const run = db.transaction((rows) => {
    const now = new Date().toISOString();
    for (const row of rows) {
      statement.run(
        farmId, data.lotId, data.categorySlug, row.costDate, data.amountCents,
        data.description, data.isRecurring ? 1 : 0, data.recurrenceMonths,
        createdBy, now, now,
      );
    }
    return rows.length;
  });

  return run(occurrences);
}

export function updateCost(db, farmIds, costId, data) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(
      `UPDATE costs SET
         lot_id = ?, category_id = (SELECT id FROM cost_categories WHERE slug = ?),
         cost_date = ?, amount_cents = ?, description = ?, updated_at = ?
       WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .run(
      data.lotId, data.categorySlug, data.costDate, data.amountCents,
      data.description, new Date().toISOString(), costId, ...params,
    );

  return result.changes > 0;
}

export function deleteCost(db, farmIds, costId) {
  const { placeholders, params } = inClause(farmIds);

  const result = db
    .prepare(`DELETE FROM costs WHERE id = ? AND farm_id IN (${placeholders})`)
    .run(costId, ...params);

  return result.changes > 0;
}
