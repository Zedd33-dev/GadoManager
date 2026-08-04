/**
 * Pesagens: list, single entry, and keyboard-first batch entry.
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
import { todayIso, isValidIsoDate } from '../lib/dates.js';
import {
  WEIGHING_SORT_COLUMNS,
  countFiltered,
  listPaginated,
  listAllFiltered,
  findAnimalByEarTag,
  findPreviousWeighing,
  existsOnDate,
  insertWeighing,
  insertWeighingBatch,
  deleteWeighing,
} from '../repositories/weighingRepository.js';
import { findInScope as findAnimalInScope } from '../repositories/animalRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import {
  validateWeighing,
  detectOutlier,
  collectBatchRows,
} from '../services/weighingService.js';

const router = Router();

/** How many blank rows the batch screen renders for a no-JavaScript operator. */
const BATCH_ROW_COUNT = 20;

const LIST_QUERY_FIELDS = ['q', 'lote', 'de', 'ate', 'sort', 'dir', 'perPage'];

function currentListQuery(query) {
  return Object.fromEntries(LIST_QUERY_FIELDS.map((key) => [key, query[key]]));
}

function parseListQuery(query) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
  const lotIdRaw = Number.parseInt(query.lote, 10);

  return {
    filters: {
      search: search || null,
      lotId: Number.isInteger(lotIdRaw) ? lotIdRaw : null,
      from: isValidIsoDate(query.de) ? query.de : null,
      until: isValidIsoDate(query.ate) ? query.ate : null,
    },
    sort: resolveSort(
      WEIGHING_SORT_COLUMNS,
      { defaultKey: 'weighDate', defaultDirection: 'desc' },
      query,
    ),
    pagination: parsePagination(query),
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get('/pesagens', requireCapability('weighings:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const { filters, sort, pagination } = parseListQuery(req.query);

  const total = countFiltered(db, farmIds, filters);
  const rows = listPaginated(db, farmIds, {
    ...filters,
    sort,
    limit: pagination.perPage,
    offset: pagination.offset,
  });

  const current = currentListQuery(req.query);

  res.render('weighings/index', {
    title: 'Pesagens',
    rows,
    filters,
    sort,
    pageInfo: buildPageInfo(total, pagination),
    lots: listLotsInScope(db, farmIds),
    csvQuery: buildQuery(current, { page: undefined }),
    buildSortQuery: (key) =>
      buildQuery(current, { sort: key, dir: nextDirectionFor(sort, key), page: undefined }),
    buildPageQuery: (page) => buildQuery(current, { page }),
  });
});

router.get('/pesagens/exportar.csv', requireCapability('weighings:read'), (req, res) => {
  const db = getDb();
  const { filters } = parseListQuery(req.query);
  const rows = listAllFiltered(db, req.scope.effectiveFarmIds, filters);

  const csv = toCsv(
    ['Brinco', 'Data', 'Peso (kg)', 'Origem', 'Lote'],
    rows.map((r) => [
      r.ear_tag,
      r.weigh_date,
      String(r.weight_kg).replace('.', ','),
      r.source === 'lote' ? 'Pesagem em lote' : 'Manual',
      r.lot_name,
    ]),
  );

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="pesagens.csv"');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// Batch entry - the weighing-day screen
// ---------------------------------------------------------------------------

router.get('/pesagens/lote', requireCapability('weighings:write'), (req, res) => {
  res.render('weighings/batch', {
    title: 'Pesagem em lote',
    weighDate: todayIso(),
    rowCount: BATCH_ROW_COUNT,
    results: null,
    submittedRows: [],
    today: todayIso(),
  });
});

router.post('/pesagens/lote', requireCapability('weighings:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const weighDate = isValidIsoDate(req.body.weighDate) ? req.body.weighDate : null;
  const confirmOutliers = req.body.confirmOutliers === 'on';

  const rows = collectBatchRows(req.body.earTag, req.body.weightKg);

  const results = [];
  const accepted = [];

  if (!weighDate) {
    results.push({ ok: false, earTag: '—', message: 'Informe uma data de pesagem válida.' });
  } else if (weighDate > todayIso()) {
    results.push({ ok: false, earTag: '—', message: 'A pesagem não pode ter data futura.' });
  } else {
    // Tracks tags repeated within this same submission. The schema's
    // UNIQUE(animal_id, weigh_date) would reject the second one anyway, but
    // as a transaction-aborting constraint failure rather than a message
    // naming the duplicated tag.
    const seenTags = new Set();

    for (const row of rows) {
      const label = row.earTag || `linha ${row.index + 1}`;

      if (!row.earTag) {
        results.push({ ok: false, earTag: label, message: 'Peso informado sem brinco.' });
        continue;
      }
      if (seenTags.has(row.earTag)) {
        results.push({ ok: false, earTag: label, message: 'Brinco repetido nesta mesma pesagem.' });
        continue;
      }
      seenTags.add(row.earTag);

      const animal = findAnimalByEarTag(db, farmIds, row.earTag);
      if (!animal) {
        results.push({
          ok: false,
          earTag: label,
          message: 'Brinco não encontrado entre os animais ativos do seu escopo.',
        });
        continue;
      }

      const validation = validateWeighing(
        { weighDate, weightKg: row.rawWeight },
        { animal, dateAlreadyUsed: existsOnDate(db, animal.id, weighDate) },
      );

      if (!validation.ok) {
        results.push({
          ok: false,
          earTag: label,
          message: Object.values(validation.errors).join(' '),
        });
        continue;
      }

      const previous = findPreviousWeighing(db, animal.id, weighDate) ?? null;
      const outlier = detectOutlier(
        { weightKg: validation.data.weightKg, weighDate },
        previous,
      );

      if (outlier.isOutlier && !confirmOutliers) {
        results.push({
          ok: false,
          isOutlier: true,
          earTag: label,
          weightKg: validation.data.weightKg,
          message: outlier.reason,
        });
        continue;
      }

      accepted.push({
        animalId: animal.id,
        weighDate,
        weightKg: validation.data.weightKg,
        createdBy: req.user.id,
      });

      results.push({
        ok: true,
        earTag: animal.ear_tag,
        weightKg: validation.data.weightKg,
        gmd: outlier.gmd,
        wasOutlier: outlier.isOutlier,
      });
    }
  }

  const hasBlockingOutlier = results.some((r) => r.isOutlier);
  const hasError = results.some((r) => !r.ok);

  // All-or-nothing: if any row failed, nothing is written. A partially applied
  // weighing day would leave the operator unable to tell which animals were
  // recorded, with no safe way to retry the rest.
  if (!hasError && accepted.length > 0) {
    insertWeighingBatch(db, accepted);
    setFlash(req, 'success', `${accepted.length} pesagem(ns) registrada(s) em ${weighDate}.`);
    return res.redirect('/pesagens');
  }

  return res.status(400).render('weighings/batch', {
    title: 'Pesagem em lote',
    weighDate: weighDate ?? todayIso(),
    rowCount: Math.max(BATCH_ROW_COUNT, rows.length + 5),
    results,
    submittedRows: rows,
    hasBlockingOutlier,
    today: todayIso(),
  });
});

// ---------------------------------------------------------------------------
// Single entry, from an animal's detail page
// ---------------------------------------------------------------------------

router.get('/animais/:id/pesagens/nova', requireCapability('weighings:write'), (req, res, next) => {
  const db = getDb();
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findAnimalInScope(db, req.scope.effectiveFarmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  res.render('weighings/form', {
    title: `Nova pesagem — ${animal.ear_tag}`,
    animal,
    errors: {},
    values: { weighDate: todayIso() },
    outlier: null,
    today: todayIso(),
  });
});

router.post('/animais/:id/pesagens', requireCapability('weighings:write'), (req, res, next) => {
  const db = getDb();
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findAnimalInScope(db, req.scope.effectiveFarmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  const rerender = (extra) =>
    res.status(400).render('weighings/form', {
      title: `Nova pesagem — ${animal.ear_tag}`,
      animal,
      values: req.body,
      today: todayIso(),
      errors: {},
      outlier: null,
      ...extra,
    });

  const validation = validateWeighing(req.body, {
    animal,
    dateAlreadyUsed: isValidIsoDate(req.body.weighDate)
      ? existsOnDate(db, animalId, req.body.weighDate)
      : false,
  });

  if (!validation.ok) return rerender({ errors: validation.errors });

  const previous = findPreviousWeighing(db, animalId, validation.data.weighDate) ?? null;
  const outlier = detectOutlier(
    { weightKg: validation.data.weightKg, weighDate: validation.data.weighDate },
    previous,
  );

  // A flagged weighing is re-presented for confirmation rather than rejected:
  // a real animal can genuinely lose weight, and refusing to record that would
  // corrupt the herd's history to guard against a typo.
  if (outlier.isOutlier && req.body.confirmOutlier !== 'on') {
    return rerender({ outlier });
  }

  insertWeighing(db, {
    animalId,
    weighDate: validation.data.weighDate,
    weightKg: validation.data.weightKg,
    source: 'manual',
    notes: validation.data.notes,
    createdBy: req.user.id,
  });

  setFlash(
    req,
    'success',
    outlier.gmd !== null
      ? `Pesagem registrada. GMD desde a pesagem anterior: ${outlier.gmd.toFixed(3).replace('.', ',')} kg/dia.`
      : 'Pesagem registrada.',
  );

  return res.redirect(`/animais/${animalId}`);
});

router.post('/pesagens/:id/excluir', requireCapability('animals:delete'), (req, res) => {
  const db = getDb();
  const weighingId = Number.parseInt(req.params.id, 10);

  const removed = deleteWeighing(db, req.scope.effectiveFarmIds, weighingId);

  setFlash(
    req,
    removed ? 'success' : 'warning',
    removed ? 'Pesagem excluída.' : 'Nenhuma pesagem foi excluída.',
  );

  return res.redirect('/pesagens');
});

export default router;
