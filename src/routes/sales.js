/**
 * Vendas.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { HttpError } from '../middleware/errors.js';
import { toCsv } from '../lib/csv.js';
import { buildPageInfo, parsePagination } from '../lib/pagination.js';
import { buildQuery } from '../lib/queryString.js';
import { resolveSort, nextDirectionFor } from '../lib/sorting.js';
import { todayIso, isValidIsoDate, startOfMonth } from '../lib/dates.js';
import {
  SALE_SORT_COLUMNS,
  countSales,
  listSales,
  listAllSales,
  findSaleInScope,
  listSaleItems,
  insertSale,
  farmCostSummary,
} from '../repositories/saleRepository.js';
import { listMovableAnimals, findMovableByIds } from '../repositories/movementRepository.js';
import { listAnimalsUnderWithdrawal, listAppliedWithWithdrawal } from '../repositories/healthRepository.js';
import { evaluateWithdrawal } from '../services/healthService.js';
import {
  calculateSaleValue,
  estimateAccumulatedCost,
  validateSaleHeader,
  validateSaleItem,
} from '../services/saleService.js';

const router = Router();

const LIST_QUERY_FIELDS = ['q', 'de', 'ate', 'sort', 'dir', 'perPage'];

function parseListQuery(query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';

  return {
    filters: {
      search: search || null,
      from: isValidIsoDate(query.de) ? query.de : null,
      until: isValidIsoDate(query.ate) ? query.ate : null,
    },
    sort: resolveSort(SALE_SORT_COLUMNS, { defaultKey: 'saleDate', defaultDirection: 'desc' }, query),
    pagination: parsePagination(query),
  };
}

router.get('/vendas', requireCapability('sales:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const { filters, sort, pagination } = parseListQuery(req.query);

  const total = countSales(db, farmIds, filters);
  const rows = listSales(db, farmIds, { ...filters, sort, limit: pagination.perPage, offset: pagination.offset });

  const current = Object.fromEntries(LIST_QUERY_FIELDS.map((k) => [k, req.query[k]]));

  res.render('sales/index', {
    title: 'Vendas',
    rows,
    filters,
    sort,
    pageInfo: buildPageInfo(total, pagination),
    csvQuery: buildQuery(current, { page: undefined }),
    buildSortQuery: (key) => buildQuery(current, { sort: key, dir: nextDirectionFor(sort, key), page: undefined }),
    buildPageQuery: (page) => buildQuery(current, { page }),
  });
});

router.get('/vendas/exportar.csv', requireCapability('sales:read'), (req, res) => {
  const db = getDb();
  const { filters } = parseListQuery(req.query);
  const rows = listAllSales(db, req.scope.effectiveFarmIds, filters);

  const csv = toCsv(
    ['Comprador', 'Data', 'Brinco', 'Peso vivo (kg)', 'Rendimento (%)', 'Arrobas', 'Valor'],
    rows.map((r) => [
      r.buyer_name, r.sale_date, r.ear_tag,
      String(r.live_weight_kg).replace('.', ','),
      String(r.carcass_yield_pct).replace('.', ','),
      String(r.arrobas).replace('.', ','),
      (r.gross_value_cents / 100).toFixed(2).replace('.', ','),
    ]),
  );

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="vendas.csv"');
  res.send(csv);
});

// GET /vendas/nova must be registered before GET /vendas/:id - Express
// matches routes in registration order, and a param route with no further
// constraint on `:id` would otherwise swallow the literal path "nova" as if
// it were an id, sending it into findSaleInScope and producing a 404 for a
// page that exists. The same ordering rule applies to every other
// list/:id/new-form trio in this project; sales.js is the one place it was
// initially got backwards, caught by this phase's own end-to-end check.
router.get('/vendas/nova', requireCapability('sales:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const today = todayIso();

  const underWithdrawal = new Map(
    listAnimalsUnderWithdrawal(db, farmIds, today).map((a) => [a.animalId, a]),
  );

  res.render('sales/form', {
    title: 'Nova venda',
    animals: listMovableAnimals(db, farmIds).map((a) => ({
      ...a,
      underWithdrawal: underWithdrawal.get(a.id) ?? null,
    })),
    values: { saleDate: today },
    errors: {},
    itemErrors: {},
    today,
  });
});

router.get('/vendas/:id', requireCapability('sales:read'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const sale = findSaleInScope(db, farmIds, Number.parseInt(req.params.id, 10));
  if (!sale) return next(new HttpError(404, 'Venda não encontrada.'));

  const items = listSaleItems(db, sale.id);

  // The profit figure needs the farm's cost profile up to the sale date - see
  // src/services/saleService.js for what this estimate is and is not.
  const { totalCostsCents, averageActiveAnimals } = farmCostSummary(
    db, sale.farm_id, startOfMonth(sale.sale_date), sale.sale_date,
  );

  const itemsWithProfit = items.map((item) => {
    const originDate = item.origin === 'comprado' ? item.purchase_date : item.birth_date;
    const cost = estimateAccumulatedCost({
      originDate,
      saleDate: sale.sale_date,
      purchasePriceCents: item.purchase_price_cents,
      farmTotalCostsCents: totalCostsCents,
      farmAverageActiveAnimals: averageActiveAnimals,
    });

    return {
      ...item,
      estimatedCostCents: cost.estimatedAccumulatedCostCents,
      estimatedProfitCents: item.gross_value_cents - cost.estimatedAccumulatedCostCents,
    };
  });

  res.render('sales/show', { title: `Venda — ${sale.buyer_name}`, sale, items: itemsWithProfit });
});

router.post('/vendas', requireCapability('sales:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const today = todayIso();

  const rawIds = Array.isArray(req.body.animalIds) ? req.body.animalIds : [req.body.animalIds].filter(Boolean);
  const animalIds = rawIds.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);
  const animals = findMovableByIds(db, farmIds, animalIds);

  const rerender = (errors, itemErrors) => {
    const underWithdrawal = new Map(
      listAnimalsUnderWithdrawal(db, farmIds, today).map((a) => [a.animalId, a]),
    );
    return res.status(400).render('sales/form', {
      title: 'Nova venda',
      animals: listMovableAnimals(db, farmIds).map((a) => ({ ...a, underWithdrawal: underWithdrawal.get(a.id) ?? null })),
      values: req.body,
      errors,
      itemErrors,
      today,
    });
  };

  const headerResult = validateSaleHeader(req.body, { today, hasItems: animals.length > 0 });
  if (!headerResult.ok) return rerender(headerResult.errors, {});

  // The farm is implied by the animals selected; all of them must belong to
  // the same farm, since a sale has one buyer and one price per arroba.
  const farmId = animals[0]?.farm_id;
  if (animals.some((a) => a.farm_id !== farmId)) {
    return rerender({ animals: 'Todos os animais de uma venda devem ser da mesma fazenda.' }, {});
  }

  const itemErrors = {};
  const items = [];

  // Each weight/yield field is named liveWeightKg_<animalId>, not a parallel
  // array indexed by table-row position. The form renders one row per
  // animal in the caller's whole scope, but `animals` here is only the
  // checked subset, returned by findMovableByIds in database id order - not
  // necessarily the table's row order. Zipping arrays by position would
  // silently pair one animal's weight with a different animal's yield.
  // Keying by id sidesteps the ordering question entirely.
  animals.forEach((animal) => {
    const rawItem = {
      liveWeightKg: req.body[`liveWeightKg_${animal.id}`],
      carcassYieldPct: req.body[`carcassYieldPct_${animal.id}`],
    };
    const withdrawal = evaluateWithdrawal(listAppliedWithWithdrawal(db, animal.id), today);

    const itemResult = validateSaleItem(rawItem, { ...animal, status: 'ativo' }, withdrawal);
    if (!itemResult.ok) {
      itemErrors[animal.id] = Object.values(itemResult.errors).join(' ');
      return;
    }

    const { arrobas, grossValueCents } = calculateSaleValue(
      itemResult.data.liveWeightKg, itemResult.data.carcassYieldPct, headerResult.data.pricePerArrobaCents,
    );

    items.push({
      animalId: animal.id,
      liveWeightKg: itemResult.data.liveWeightKg,
      carcassYieldPct: itemResult.data.carcassYieldPct,
      arrobas,
      grossValueCents,
    });
  });

  if (Object.keys(itemErrors).length > 0) return rerender({}, itemErrors);

  const saleId = insertSale(
    db, farmId,
    { ...headerResult.data, createdBy: req.user.id },
    items,
  );

  setFlash(req, 'success', `Venda registrada: ${items.length} animal(is).`);
  return res.redirect(`/vendas/${saleId}`);
});

export default router;
