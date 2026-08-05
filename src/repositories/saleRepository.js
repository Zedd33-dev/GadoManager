/**
 * Vendas queries.
 */

import { inClause } from '../middleware/tenant.js';

export const SALE_SORT_COLUMNS = Object.freeze({
  saleDate: 's.sale_date',
  buyer: 's.buyer_name',
});

function buildFilter(farmIds, { search, from, until } = {}) {
  const { placeholders, params } = inClause(farmIds);
  const conditions = [`s.farm_id IN (${placeholders})`];
  const values = [...params];

  if (search) {
    conditions.push("s.buyer_name LIKE ? ESCAPE '\\'");
    values.push(`%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  if (from) {
    conditions.push('s.sale_date >= ?');
    values.push(from);
  }
  if (until) {
    conditions.push('s.sale_date <= ?');
    values.push(until);
  }

  return { where: conditions.join(' AND '), values };
}

export function countSales(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);
  return db.prepare(`SELECT COUNT(*) AS c FROM sales s WHERE ${where}`).get(...values).c;
}

/** One row per sale, with the item count and total value already aggregated. */
export function listSales(db, farmIds, { sort, limit, offset, ...filters }) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT s.id, s.buyer_name, s.sale_date, s.price_per_arroba_cents, s.notes,
              COUNT(i.id) AS animal_count,
              COALESCE(SUM(i.gross_value_cents), 0) AS total_value_cents,
              COALESCE(SUM(i.arrobas), 0) AS total_arrobas
         FROM sales s
         LEFT JOIN sale_items i ON i.sale_id = s.id
        WHERE ${where}
        GROUP BY s.id
        ORDER BY ${sort.orderBy}
        LIMIT ? OFFSET ?`,
    )
    .all(...values, limit, offset);
}

export function listAllSales(db, farmIds, filters = {}) {
  const { where, values } = buildFilter(farmIds, filters);

  return db
    .prepare(
      `SELECT s.buyer_name, s.sale_date, s.price_per_arroba_cents,
              a.ear_tag, i.live_weight_kg, i.carcass_yield_pct, i.arrobas, i.gross_value_cents
         FROM sales s
         JOIN sale_items i ON i.sale_id = s.id
         JOIN animals a ON a.id = i.animal_id
        WHERE ${where}
        ORDER BY s.sale_date DESC, a.ear_tag`,
    )
    .all(...values);
}

export function findSaleInScope(db, farmIds, saleId) {
  const { placeholders, params } = inClause(farmIds);

  return db
    .prepare(
      `SELECT id, farm_id, buyer_name, sale_date, price_per_arroba_cents, notes
         FROM sales
        WHERE id = ? AND farm_id IN (${placeholders})`,
    )
    .get(saleId, ...params);
}

/** The animals within one sale, with their purchase price for the profit figure. */
export function listSaleItems(db, saleId) {
  return db
    .prepare(
      `SELECT i.id, i.animal_id, a.ear_tag, a.origin, a.birth_date, a.purchase_date,
              a.purchase_price_cents, i.live_weight_kg, i.carcass_yield_pct,
              i.arrobas, i.gross_value_cents
         FROM sale_items i
         JOIN animals a ON a.id = i.animal_id
        WHERE i.sale_id = ?
        ORDER BY a.ear_tag`,
    )
    .all(saleId);
}

/**
 * Creates a sale and its items in one transaction, marking each animal
 * `vendido` in the same transaction as well.
 *
 * All three writes (the sale header, the items, the status change) must
 * succeed together: a sale with no matching status change would leave a sold
 * animal showing as `ativo`, generating sanitary alerts and appearing on
 * future weighing days for an animal that no longer exists in the herd.
 *
 * @returns {number} the new sale's id
 */
export function insertSale(db, farmId, header, items) {
  const now = new Date().toISOString();

  const insertSaleStatement = db.prepare(
    `INSERT INTO sales (farm_id, buyer_name, sale_date, price_per_arroba_cents, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItemStatement = db.prepare(
    `INSERT INTO sale_items (sale_id, animal_id, live_weight_kg, carcass_yield_pct, arrobas, gross_value_cents, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const markSoldStatement = db.prepare(
    `UPDATE animals SET status = 'vendido', updated_at = ? WHERE id = ?`,
  );

  const run = db.transaction(() => {
    const saleId = Number(
      insertSaleStatement.run(
        farmId, header.buyerName, header.saleDate, header.pricePerArrobaCents,
        header.notes, header.createdBy, now, now,
      ).lastInsertRowid,
    );

    for (const item of items) {
      insertItemStatement.run(
        saleId, item.animalId, item.liveWeightKg, item.carcassYieldPct,
        item.arrobas, item.grossValueCents, now,
      );
      markSoldStatement.run(now, item.animalId);
    }

    return saleId;
  });

  return run();
}

/**
 * Total costs and average active headcount for a farm over a date range, the
 * two inputs `estimateAccumulatedCost` needs.
 */
export function farmCostSummary(db, farmId, from, until) {
  const totalCostsCents = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM costs WHERE farm_id = ? AND cost_date >= ? AND cost_date < ?`,
    )
    .get(farmId, from, until).total;

  // A coarse average: active headcount today, rather than reconstructing a
  // month-by-month herd size. Stated as an approximation in
  // src/services/saleService.js and docs/business-rules.md.
  const averageActiveAnimals = db
    .prepare(`SELECT COUNT(*) AS c FROM animals WHERE farm_id = ? AND status = 'ativo'`)
    .get(farmId).c;

  return { totalCostsCents, averageActiveAnimals };
}
