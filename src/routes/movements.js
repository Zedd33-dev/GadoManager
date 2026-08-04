/**
 * Movimentações.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { toCsv } from '../lib/csv.js';
import { buildPageInfo, parsePagination } from '../lib/pagination.js';
import { buildQuery } from '../lib/queryString.js';
import { resolveSort, nextDirectionFor } from '../lib/sorting.js';
import { todayIso, isValidIsoDate } from '../lib/dates.js';
import {
  MOVEMENT_SORT_COLUMNS,
  countMovements,
  listMovements,
  listAllMovements,
  listMovableAnimals,
  findMovableByIds,
  recordMovements,
} from '../repositories/movementRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import { listInScope as listPasturesInScope } from '../repositories/pastureRepository.js';
import { validateMovement } from '../services/movementService.js';

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
    sort: resolveSort(
      MOVEMENT_SORT_COLUMNS,
      { defaultKey: 'movedAt', defaultDirection: 'desc' },
      query,
    ),
    pagination: parsePagination(query),
  };
}

router.get('/movimentacoes', requireCapability('animals:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const { filters, sort, pagination } = parseListQuery(req.query);

  const total = countMovements(db, farmIds, filters);
  const rows = listMovements(db, farmIds, {
    ...filters,
    sort,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const current = Object.fromEntries(LIST_QUERY_FIELDS.map((key) => [key, req.query[key]]));

  res.render('movements/index', {
    title: 'Movimentações',
    rows,
    filters,
    sort,
    pageInfo: buildPageInfo(total, pagination),
    csvQuery: buildQuery(current, { page: undefined }),
    buildSortQuery: (key) =>
      buildQuery(current, { sort: key, dir: nextDirectionFor(sort, key), page: undefined }),
    buildPageQuery: (page) => buildQuery(current, { page }),
  });
});

router.get('/movimentacoes/exportar.csv', requireCapability('animals:read'), (req, res) => {
  const db = getDb();
  const { filters } = parseListQuery(req.query);
  const rows = listAllMovements(db, req.scope.effectiveFarmIds, filters);

  const csv = toCsv(
    ['Brinco', 'Data', 'Lote origem', 'Lote destino', 'Pasto origem', 'Pasto destino', 'Motivo'],
    rows.map((r) => [
      r.ear_tag,
      r.moved_at.slice(0, 10),
      r.from_lot,
      r.to_lot,
      r.from_pasture,
      r.to_pasture,
      r.reason,
    ]),
  );

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="movimentacoes.csv"');
  res.send(csv);
});

router.get('/movimentacoes/nova', requireCapability('movements:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const lotIdRaw = Number.parseInt(req.query.lote, 10);
  const lotId = Number.isInteger(lotIdRaw) ? lotIdRaw : null;

  res.render('movements/form', {
    title: 'Nova movimentação',
    animals: listMovableAnimals(db, farmIds, { lotId }),
    lots: listLotsInScope(db, farmIds),
    pastures: listPasturesInScope(db, farmIds),
    selectedLotId: lotId,
    values: { movedAt: todayIso() },
    errors: {},
    today: todayIso(),
  });
});

router.post('/movimentacoes', requireCapability('movements:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const rawIds = Array.isArray(req.body.animalIds)
    ? req.body.animalIds
    : [req.body.animalIds].filter(Boolean);
  const animalIds = rawIds.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);

  const animals = findMovableByIds(db, farmIds, animalIds);
  const lots = listLotsInScope(db, farmIds);
  const pastures = listPasturesInScope(db, farmIds);

  const validation = validateMovement(req.body, {
    scopeFarmIds: farmIds,
    lotsById: new Map(lots.map((l) => [l.id, l])),
    pasturesById: new Map(pastures.map((p) => [p.id, p])),
    animals,
  });

  const rerender = (errors) =>
    res.status(400).render('movements/form', {
      title: 'Nova movimentação',
      animals: listMovableAnimals(db, farmIds),
      lots,
      pastures,
      selectedLotId: null,
      values: req.body,
      errors,
      today: todayIso(),
    });

  if (!validation.ok) return rerender(validation.errors);

  try {
    const moved = recordMovements(db, animals, {
      ...validation.data,
      createdBy: req.user.id,
    });

    setFlash(req, 'success', `${moved} animal(is) movimentado(s).`);
    return res.redirect('/movimentacoes');
  } catch (error) {
    // The most likely failure is the schema's UNIQUE(farm_id, ear_tag) when a
    // cross-farm move would collide with a tag already used on the
    // destination. The whole batch rolled back, so the herd is untouched.
    if (String(error.message).includes('UNIQUE constraint failed')) {
      return rerender({
        destination:
          'Um dos brincos selecionados já existe na fazenda de destino. ' +
          'Nenhum animal foi movimentado.',
      });
    }
    throw error;
  }
});

export default router;
