/**
 * Animais: list, detail, create, edit, photo, bulk delete.
 *
 * This is also where the reusable list infrastructure
 * (`lib/pagination.js`, `lib/sorting.js`, `lib/csv.js`) gets its first real
 * caller. Every list screen added from Phase 9 onward reuses the same three
 * modules rather than reimplementing paging per module.
 */

import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { HttpError } from '../middleware/errors.js';
import { toCsv } from '../lib/csv.js';
import { buildPageInfo } from '../lib/pagination.js';
import { toEmbeddableJson } from '../lib/safeJson.js';
import { buildQuery } from '../lib/queryString.js';
import { nextDirectionFor } from '../lib/sorting.js';
import { UPLOADS_DIR, verifyStoredImage, deleteStoredPhoto } from '../lib/upload.js';
import {
  countFiltered,
  listPaginated,
  listAllFiltered,
  listDistinctBreeds,
  findInScope,
  findWithDetailsInScope,
  listCandidateMothers,
  insertAnimal,
  updateAnimal,
  updatePhotoPath,
  deleteAnimals,
  getTimeline,
  getWeightHistory,
} from '../repositories/animalRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import { listInScope as listPasturesInScope } from '../repositories/pastureRepository.js';
import { listInScope as listFarmsInScope } from '../repositories/farmRepository.js';
import { parseAnimalListQuery, validateAnimalInput } from '../services/animalService.js';
import { evaluateWithdrawal } from '../services/healthService.js';
import { listAppliedWithWithdrawal } from '../repositories/healthRepository.js';
import { ANIMAL_STATUS, ANIMAL_STATUS_LABELS, SUGGESTED_BREEDS } from '../domain/constants.js';

const router = Router();

/**
 * Breed suggestions for the <datalist> - whatever the farm has already typed,
 * plus the curated starting list, deduplicated. Not a validation allow-list;
 * see SUGGESTED_BREEDS.
 */
function breedSuggestions(db, farmIds) {
  return [...new Set([...listDistinctBreeds(db, farmIds), ...SUGGESTED_BREEDS])].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
}

/** Builds the option lists every Animais form/filter needs, scoped to the caller. */
function loadFormOptions(db, farmIds) {
  return {
    farms: listFarmsInScope(db, farmIds),
    lots: listLotsInScope(db, farmIds),
    pastures: listPasturesInScope(db, farmIds),
    breeds: breedSuggestions(db, farmIds),
  };
}

/** The list's own query fields worth preserving across a sort or page link. */
const LIST_QUERY_FIELDS = ['q', 'status', 'breed', 'sex', 'lote', 'sort', 'dir', 'perPage'];

function currentListQuery(query) {
  return Object.fromEntries(LIST_QUERY_FIELDS.map((key) => [key, query[key]]));
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

router.get('/animais', requireCapability('animals:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const { filters, sort, pagination } = parseAnimalListQuery(req.query);

  const total = countFiltered(db, farmIds, filters);
  const rows = listPaginated(db, farmIds, {
    ...filters,
    sort,
    limit: pagination.perPage,
    offset: pagination.offset,
  });
  const pageInfo = buildPageInfo(total, pagination);
  const current = currentListQuery(req.query);

  res.render('animals/index', {
    title: 'Animais',
    headerSearchQuery: filters.search,
    rows,
    filters,
    sort,
    pageInfo,
    statusOptions: Object.values(ANIMAL_STATUS),
    statusLabels: ANIMAL_STATUS_LABELS,
    csvQuery: buildQuery(current, { page: undefined }),
    buildSortQuery: (columnKey) =>
      buildQuery(current, { sort: columnKey, dir: nextDirectionFor(sort, columnKey), page: undefined }),
    buildPageQuery: (targetPage) => buildQuery(current, { page: targetPage }),
    ...loadFormOptions(db, farmIds),
  });
});

router.get('/animais/exportar.csv', requireCapability('animals:read'), (req, res) => {
  const db = getDb();
  const { filters } = parseAnimalListQuery(req.query);

  const rows = listAllFiltered(db, req.scope.effectiveFarmIds, filters);

  const csv = toCsv(
    ['Brinco', 'SISBOV', 'Nascimento', 'Sexo', 'Raça', 'Origem', 'Status', 'Lote', 'Pasto', 'Peso mais recente (kg)'],
    rows.map((r) => [
      r.ear_tag,
      r.sisbov,
      r.birth_date,
      r.sex,
      r.breed,
      r.origin === 'nascido' ? 'Nascido na fazenda' : 'Comprado',
      ANIMAL_STATUS_LABELS[r.status] ?? r.status,
      r.lot_name,
      r.pasture_name,
      r.latest_weight_kg,
    ]),
  );

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="animais.csv"');
  res.send(csv);
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

router.get('/animais/novo', requireCapability('animals:write'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const options = loadFormOptions(db, farmIds);

  // A single-farm account never sees a farm selector; there is nothing to
  // choose. Candidate mothers span every farm in scope for the same reason
  // the lot/pasture lists do - validated against the chosen farm on submit.
  const mothers = farmIds.flatMap((farmId) => listCandidateMothers(db, farmId));

  res.render('animals/form', {
    title: 'Novo animal',
    isCreate: true,
    animal: null,
    errors: {},
    values: {},
    mothers,
    ...options,
  });
});

router.post('/animais', requireCapability('animals:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const farmId =
    farmIds.length === 1 ? farmIds[0] : farmIds.find((id) => id === Number.parseInt(req.body.farmId, 10));

  if (!farmId) {
    return next(new HttpError(400, 'Selecione uma fazenda válida.'));
  }

  const validLotIds = new Set(listLotsInScope(db, [farmId]).map((l) => l.id));
  const validPastureIds = new Set(listPasturesInScope(db, [farmId]).map((p) => p.id));
  const validMotherIds = new Set(listCandidateMothers(db, farmId).map((m) => m.id));

  const result = validateAnimalInput(req.body, {
    isCreate: true,
    validLotIds,
    validPastureIds,
    validMotherIds,
  });

  if (!result.ok) {
    const options = loadFormOptions(db, farmIds);
    const mothers = farmIds.flatMap((id) => listCandidateMothers(db, id));

    return res.status(400).render('animals/form', {
      title: 'Novo animal',
      isCreate: true,
      animal: null,
      errors: result.errors,
      values: req.body,
      mothers,
      ...options,
    });
  }

  const id = insertAnimal(db, farmId, { ...result.data, photoPath: null });
  setFlash(req, 'success', `Animal ${result.data.earTag} cadastrado.`);
  return res.redirect(`/animais/${id}`);
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

router.get('/animais/:id', requireCapability('animals:read'), (req, res, next) => {
  const db = getDb();
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findWithDetailsInScope(db, req.scope.effectiveFarmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  const timeline = getTimeline(db, animalId);
  const weightHistory = getWeightHistory(db, animalId);
  const withdrawal = evaluateWithdrawal(listAppliedWithWithdrawal(db, animalId));

  const weightChart = {
    labels: weightHistory.map((w) => w.date),
    values: weightHistory.map((w) => w.weightKg),
  };

  res.render('animals/show', {
    title: animal.ear_tag,
    animal,
    withdrawal,
    timeline,
    weightChart,
    weightChartJson: toEmbeddableJson(weightChart),
    statusLabels: ANIMAL_STATUS_LABELS,
  });
});

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

router.get('/animais/:id/editar', requireCapability('animals:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findInScope(db, farmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  const options = {
    farms: [],
    lots: listLotsInScope(db, [animal.farm_id]),
    pastures: listPasturesInScope(db, [animal.farm_id]),
    breeds: breedSuggestions(db, [animal.farm_id]),
  };
  const mothers = listCandidateMothers(db, animal.farm_id).filter((m) => m.id !== animalId);

  res.render('animals/form', {
    title: `Editar ${animal.ear_tag}`,
    isCreate: false,
    animal,
    errors: {},
    values: {
      earTag: animal.ear_tag,
      sisbov: animal.sisbov,
      birthDate: animal.birth_date,
      sex: animal.sex,
      breed: animal.breed,
      origin: animal.origin,
      motherId: animal.mother_id,
      purchaseDate: animal.purchase_date,
      purchasePrice: animal.purchase_price_cents !== null ? String(animal.purchase_price_cents / 100).replace('.', ',') : '',
      lotId: animal.lot_id,
      pastureId: animal.pasture_id,
      status: animal.status,
      notes: animal.notes,
    },
    mothers,
    ...options,
  });
});

router.post('/animais/:id/editar', requireCapability('animals:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findInScope(db, farmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  const validLotIds = new Set(listLotsInScope(db, [animal.farm_id]).map((l) => l.id));
  const validPastureIds = new Set(listPasturesInScope(db, [animal.farm_id]).map((p) => p.id));
  const validMotherIds = new Set(
    listCandidateMothers(db, animal.farm_id)
      .filter((m) => m.id !== animalId)
      .map((m) => m.id),
  );

  const result = validateAnimalInput(req.body, {
    isCreate: false,
    validLotIds,
    validPastureIds,
    validMotherIds,
  });

  if (!result.ok) {
    const mothers = listCandidateMothers(db, animal.farm_id).filter((m) => m.id !== animalId);

    return res.status(400).render('animals/form', {
      title: `Editar ${animal.ear_tag}`,
      isCreate: false,
      animal,
      errors: result.errors,
      values: req.body,
      mothers,
      farms: [],
      lots: listLotsInScope(db, [animal.farm_id]),
      pastures: listPasturesInScope(db, [animal.farm_id]),
      breeds: breedSuggestions(db, [animal.farm_id]),
    });
  }

  updateAnimal(db, farmIds, animalId, result.data);
  setFlash(req, 'success', `Animal ${result.data.earTag} atualizado.`);
  return res.redirect(`/animais/${animalId}`);
});

// ---------------------------------------------------------------------------
// Photo
// ---------------------------------------------------------------------------

router.get('/animais/:id/foto', requireCapability('animals:read'), (req, res, next) => {
  const db = getDb();
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findInScope(db, req.scope.effectiveFarmIds, animalId);
  if (!animal || !animal.photo_path) return next(new HttpError(404, 'Foto não encontrada.'));

  const filePath = path.join(UPLOADS_DIR, animal.photo_path);
  if (!fs.existsSync(filePath)) return next(new HttpError(404, 'Foto não encontrada.'));

  res.sendFile(filePath);
});

router.post('/animais/:id/foto', requireCapability('animals:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const animalId = Number.parseInt(req.params.id, 10);
  const animal = findInScope(db, farmIds, animalId);
  if (!animal) return next(new HttpError(404, 'Animal não encontrado.'));

  if (!req.file) {
    setFlash(req, 'danger', 'Selecione um arquivo de imagem.');
    return res.redirect(`/animais/${animalId}`);
  }

  // multer's fileFilter only sees the browser's claimed Content-Type, which is
  // trivially spoofable. This second check reads the bytes actually written to
  // disk and rejects (deleting the file) anything that is not a real image of
  // an accepted format (issue SEC-07).
  if (!verifyStoredImage(req.file.path)) {
    setFlash(req, 'danger', 'O arquivo enviado não é uma imagem válida.');
    return res.redirect(`/animais/${animalId}`);
  }

  const previousPhoto = animal.photo_path;
  updatePhotoPath(db, farmIds, animalId, req.file.filename);
  deleteStoredPhoto(previousPhoto);

  setFlash(req, 'success', 'Foto atualizada.');
  return res.redirect(`/animais/${animalId}`);
});

// ---------------------------------------------------------------------------
// Bulk delete
// ---------------------------------------------------------------------------

router.post('/animais/excluir', requireCapability('animals:delete'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [req.body.ids].filter(Boolean);
  const ids = rawIds.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);

  const deletedCount = deleteAnimals(db, farmIds, ids);

  setFlash(
    req,
    deletedCount > 0 ? 'success' : 'warning',
    deletedCount > 0
      ? `${deletedCount} animal(is) excluído(s) permanentemente.`
      : 'Nenhum animal foi excluído.',
  );

  return res.redirect('/animais');
});

export default router;
