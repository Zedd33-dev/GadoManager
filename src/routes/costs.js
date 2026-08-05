/**
 * Custos.
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
import { isValidIsoDate, todayIso } from '../lib/dates.js';
import {
  COST_SORT_COLUMNS,
  listCategories,
  countCosts,
  listCosts,
  listAllCosts,
  findCostInScope,
  insertCostBatch,
  updateCost,
  deleteCost,
} from '../repositories/costRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import { listInScope as listFarmsInScope } from '../repositories/farmRepository.js';
import { validateCostInput, expandRecurrence } from '../services/costService.js';

const router = Router();

const LIST_QUERY_FIELDS = ['q', 'categoria', 'lote', 'de', 'ate', 'sort', 'dir', 'perPage'];

function parseListQuery(query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
  const lotIdRaw = Number.parseInt(query.lote, 10);

  return {
    filters: {
      search: search || null,
      categorySlug: typeof query.categoria === 'string' && query.categoria !== '' ? query.categoria : null,
      lotId: Number.isInteger(lotIdRaw) ? lotIdRaw : null,
      from: isValidIsoDate(query.de) ? query.de : null,
      until: isValidIsoDate(query.ate) ? query.ate : null,
    },
    sort: resolveSort(COST_SORT_COLUMNS, { defaultKey: 'costDate', defaultDirection: 'desc' }, query),
    pagination: parsePagination(query),
  };
}

router.get('/custos', requireCapability('costs:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const { filters, sort, pagination } = parseListQuery(req.query);

  const total = countCosts(db, farmIds, filters);
  const rows = listCosts(db, farmIds, { ...filters, sort, limit: pagination.perPage, offset: pagination.offset });
  const current = Object.fromEntries(LIST_QUERY_FIELDS.map((k) => [k, req.query[k]]));

  res.render('costs/index', {
    title: 'Custos',
    rows,
    filters,
    sort,
    pageInfo: buildPageInfo(total, pagination),
    categories: listCategories(db),
    lots: listLotsInScope(db, farmIds),
    csvQuery: buildQuery(current, { page: undefined }),
    buildSortQuery: (key) => buildQuery(current, { sort: key, dir: nextDirectionFor(sort, key), page: undefined }),
    buildPageQuery: (page) => buildQuery(current, { page }),
  });
});

router.get('/custos/exportar.csv', requireCapability('costs:read'), (req, res) => {
  const db = getDb();
  const { filters } = parseListQuery(req.query);
  const rows = listAllCosts(db, req.scope.effectiveFarmIds, filters);

  const csv = toCsv(
    ['Data', 'Categoria', 'Valor', 'Descrição', 'Lote'],
    rows.map((r) => [
      r.cost_date, r.category_name,
      (r.amount_cents / 100).toFixed(2).replace('.', ','),
      r.description, r.lot_name,
    ]),
  );

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="custos.csv"');
  res.send(csv);
});

router.get('/custos/novo', requireCapability('costs:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  res.render('costs/form', {
    title: 'Novo custo',
    isCreate: true,
    cost: null,
    values: { costDate: todayIso() },
    errors: {},
    categories: listCategories(db),
    lots: listLotsInScope(db, farmIds),
    farms: listFarmsInScope(db, farmIds),
  });
});

router.post('/custos', requireCapability('costs:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const farmId =
    farmIds.length === 1 ? farmIds[0] : farmIds.find((id) => id === Number.parseInt(req.body.farmId, 10));
  if (!farmId) return next(new HttpError(400, 'Selecione uma fazenda válida.'));

  const lots = listLotsInScope(db, [farmId]);
  const result = validateCostInput(req.body, {
    validCategorySlugs: new Set(listCategories(db).map((c) => c.slug)),
    validLotIds: new Set(lots.map((l) => l.id)),
  });

  if (!result.ok) {
    return res.status(400).render('costs/form', {
      title: 'Novo custo',
      isCreate: true,
      cost: null,
      values: req.body,
      errors: result.errors,
      categories: listCategories(db),
      lots,
      farms: listFarmsInScope(db, farmIds),
    });
  }

  const occurrences = expandRecurrence(result.data, result.occurrences);
  const count = insertCostBatch(db, farmId, result.data, occurrences, req.user.id);

  setFlash(
    req, 'success',
    count > 1 ? `${count} lançamentos criados (custo recorrente).` : 'Custo lançado.',
  );
  return res.redirect('/custos');
});

router.get('/custos/:id/editar', requireCapability('costs:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const cost = findCostInScope(db, farmIds, Number.parseInt(req.params.id, 10));
  if (!cost) return next(new HttpError(404, 'Custo não encontrado.'));

  const category = db.prepare('SELECT slug FROM cost_categories WHERE id = ?').get(cost.category_id);

  res.render('costs/form', {
    title: 'Editar custo',
    isCreate: false,
    cost,
    values: {
      categorySlug: category.slug,
      costDate: cost.cost_date,
      amount: String(cost.amount_cents / 100).replace('.', ','),
      lotId: cost.lot_id,
      description: cost.description,
    },
    errors: {},
    categories: listCategories(db),
    lots: listLotsInScope(db, [cost.farm_id]),
    farms: [],
  });
});

router.post('/custos/:id/editar', requireCapability('costs:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const costId = Number.parseInt(req.params.id, 10);
  const cost = findCostInScope(db, farmIds, costId);
  if (!cost) return next(new HttpError(404, 'Custo não encontrado.'));

  const lots = listLotsInScope(db, [cost.farm_id]);
  // Editing never changes whether a cost is recurring - that only applies at
  // creation time, when the batch of future rows is generated.
  const result = validateCostInput(
    { ...req.body, isRecurring: false },
    { validCategorySlugs: new Set(listCategories(db).map((c) => c.slug)), validLotIds: new Set(lots.map((l) => l.id)) },
  );

  if (!result.ok) {
    return res.status(400).render('costs/form', {
      title: 'Editar custo',
      isCreate: false,
      cost,
      values: req.body,
      errors: result.errors,
      categories: listCategories(db),
      lots,
      farms: [],
    });
  }

  updateCost(db, farmIds, costId, result.data);
  setFlash(req, 'success', 'Custo atualizado.');
  return res.redirect('/custos');
});

router.post('/custos/:id/excluir', requireCapability('costs:write'), (req, res) => {
  const db = getDb();
  const removed = deleteCost(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));

  setFlash(req, removed ? 'success' : 'warning', removed ? 'Custo excluído.' : 'Nenhum custo foi excluído.');
  return res.redirect('/custos');
});

export default router;
