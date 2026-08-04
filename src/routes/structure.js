/**
 * Fazendas, Lotes and Pastos.
 *
 * Grouped in one router because the three are the herd's structural
 * scaffolding, share the same shape of screen, and are small enough that
 * three separate files would be more indirection than organisation.
 *
 * None of the three offers a delete. Every one of them is referenced by
 * animals, movements or costs, so removing a row would either orphan history
 * or cascade it away. Deactivating instead keeps the record and its history
 * intact while removing it from every selector - and the service refuses to
 * deactivate one that still holds animals.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { HttpError } from '../middleware/errors.js';
import {
  listWithDetails as listFarmsWithDetails,
  findDetailInScope as findFarmDetail,
  insertFarmForUser,
  updateFarm,
} from '../repositories/farmRepository.js';
import {
  listWithDetails as listLotsWithDetails,
  findDetailInScope as findLotDetail,
  insertLot,
  updateLot,
  countOccupants as countLotOccupants,
} from '../repositories/lotRepository.js';
import {
  listWithDetails as listPasturesWithDetails,
  findDetailInScope as findPastureDetail,
  insertPasture,
  updatePasture,
  countOccupants as countPastureOccupants,
} from '../repositories/pastureRepository.js';
import { pastureOccupancy } from '../repositories/weighingRepository.js';
import {
  validateFarmInput,
  validateLotInput,
  validatePastureInput,
  BRAZILIAN_STATES,
} from '../services/structureService.js';
import {
  calculatePastureStockingRate,
  STOCKING_STATUS_LABELS,
  STOCKING_STATUS_VARIANTS,
} from '../services/stockingRateService.js';
import { PROVISIONAL_STOCKING_CAPACITY_UA_HA } from '../domain/constants.js';

const router = Router();

/**
 * Resolves which farm a new record belongs to.
 *
 * A single-farm account never sees a selector, so the answer is implicit;
 * a multi-farm account must choose, and the choice is verified against the
 * caller's own scope rather than trusted.
 */
function resolveTargetFarm(req) {
  const farmIds = req.scope.effectiveFarmIds;
  if (farmIds.length === 1) return farmIds[0];

  const requested = Number.parseInt(req.body.farmId, 10);
  return farmIds.includes(requested) ? requested : null;
}

// ---------------------------------------------------------------------------
// Fazendas
// ---------------------------------------------------------------------------

router.get('/fazendas', requireCapability('animals:read'), (req, res) => {
  res.render('structure/farms', {
    title: 'Fazendas',
    farms: listFarmsWithDetails(getDb(), req.scope.effectiveFarmIds),
  });
});

router.get('/fazendas/nova', requireCapability('farms:write'), (req, res) => {
  res.render('structure/farmForm', {
    title: 'Nova fazenda',
    isCreate: true,
    farm: null,
    values: {},
    errors: {},
    states: BRAZILIAN_STATES,
  });
});

router.post('/fazendas', requireCapability('farms:write'), (req, res) => {
  const result = validateFarmInput(req.body);

  if (!result.ok) {
    return res.status(400).render('structure/farmForm', {
      title: 'Nova fazenda',
      isCreate: true,
      farm: null,
      values: req.body,
      errors: result.errors,
      states: BRAZILIAN_STATES,
    });
  }

  // Creating a farm also grants the creator access to it, in one transaction:
  // a farm outside every user's scope would be unreachable by any screen.
  insertFarmForUser(getDb(), req.user.id, result.data);
  setFlash(req, 'success', `Fazenda ${result.data.name} cadastrada.`);
  return res.redirect('/fazendas');
});

router.get('/fazendas/:id/editar', requireCapability('farms:write'), (req, res, next) => {
  const db = getDb();
  const farm = findFarmDetail(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!farm) return next(new HttpError(404, 'Fazenda não encontrada.'));

  res.render('structure/farmForm', {
    title: `Editar ${farm.name}`,
    isCreate: false,
    farm,
    values: {
      name: farm.name,
      city: farm.city,
      state: farm.state,
      totalAreaHa: farm.total_area_ha !== null ? String(farm.total_area_ha).replace('.', ',') : '',
    },
    errors: {},
    states: BRAZILIAN_STATES,
  });
});

router.post('/fazendas/:id/editar', requireCapability('farms:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const farmId = Number.parseInt(req.params.id, 10);
  const farm = findFarmDetail(db, farmIds, farmId);
  if (!farm) return next(new HttpError(404, 'Fazenda não encontrada.'));

  const result = validateFarmInput(req.body);

  if (!result.ok) {
    return res.status(400).render('structure/farmForm', {
      title: `Editar ${farm.name}`,
      isCreate: false,
      farm,
      values: req.body,
      errors: result.errors,
      states: BRAZILIAN_STATES,
    });
  }

  updateFarm(db, farmIds, farmId, result.data);
  setFlash(req, 'success', `Fazenda ${result.data.name} atualizada.`);
  return res.redirect('/fazendas');
});

// ---------------------------------------------------------------------------
// Lotes
// ---------------------------------------------------------------------------

router.get('/lotes', requireCapability('animals:read'), (req, res) => {
  res.render('structure/lots', {
    title: 'Lotes',
    lots: listLotsWithDetails(getDb(), req.scope.effectiveFarmIds),
  });
});

router.get('/lotes/novo', requireCapability('lots:write'), (req, res) => {
  res.render('structure/lotForm', {
    title: 'Novo lote',
    isCreate: true,
    lot: null,
    values: { active: 'on' },
    errors: {},
    farms: listFarmsWithDetails(getDb(), req.scope.effectiveFarmIds),
  });
});

router.post('/lotes', requireCapability('lots:write'), (req, res, next) => {
  const db = getDb();
  const farmId = resolveTargetFarm(req);
  if (!farmId) return next(new HttpError(400, 'Selecione uma fazenda válida.'));

  const result = validateLotInput(req.body, { isDeactivating: false, occupantCount: 0 });

  if (!result.ok) {
    return res.status(400).render('structure/lotForm', {
      title: 'Novo lote',
      isCreate: true,
      lot: null,
      values: req.body,
      errors: result.errors,
      farms: listFarmsWithDetails(db, req.scope.effectiveFarmIds),
    });
  }

  insertLot(db, farmId, result.data);
  setFlash(req, 'success', `Lote ${result.data.name} cadastrado.`);
  return res.redirect('/lotes');
});

router.get('/lotes/:id/editar', requireCapability('lots:write'), (req, res, next) => {
  const db = getDb();
  const lot = findLotDetail(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!lot) return next(new HttpError(404, 'Lote não encontrado.'));

  res.render('structure/lotForm', {
    title: `Editar ${lot.name}`,
    isCreate: false,
    lot,
    values: {
      name: lot.name,
      description: lot.description,
      active: lot.active ? 'on' : '',
    },
    errors: {},
    occupantCount: countLotOccupants(db, lot.id),
    farms: [],
  });
});

router.post('/lotes/:id/editar', requireCapability('lots:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const lotId = Number.parseInt(req.params.id, 10);
  const lot = findLotDetail(db, farmIds, lotId);
  if (!lot) return next(new HttpError(404, 'Lote não encontrado.'));

  const occupantCount = countLotOccupants(db, lotId);
  const wantsActive = req.body.active === 'on';

  const result = validateLotInput(req.body, {
    isDeactivating: lot.active === 1 && !wantsActive,
    occupantCount,
  });

  if (!result.ok) {
    return res.status(400).render('structure/lotForm', {
      title: `Editar ${lot.name}`,
      isCreate: false,
      lot,
      values: req.body,
      errors: result.errors,
      occupantCount,
      farms: [],
    });
  }

  updateLot(db, farmIds, lotId, result.data);
  setFlash(req, 'success', `Lote ${result.data.name} atualizado.`);
  return res.redirect('/lotes');
});

// ---------------------------------------------------------------------------
// Pastos
// ---------------------------------------------------------------------------

router.get('/pastos', requireCapability('animals:read'), (req, res) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;

  const pastures = listPasturesWithDetails(db, farmIds);
  const occupancyByPasture = new Map(
    pastureOccupancy(db, farmIds).map((row) => [row.pastureId, row]),
  );

  const rows = pastures.map((pasture) => {
    const occupancy = occupancyByPasture.get(pasture.id) ?? {
      totalWeightKg: 0,
      animalsWithWeight: 0,
      animalsWithoutWeight: 0,
    };

    const stocking = calculatePastureStockingRate({
      areaHa: pasture.area_ha,
      maxStockingRateUaHa: pasture.max_stocking_rate_ua_ha,
      totalWeightKg: occupancy.totalWeightKg,
      animalsWithWeight: occupancy.animalsWithWeight,
      animalsWithoutWeight: occupancy.animalsWithoutWeight,
    });

    return { ...pasture, occupancy, stocking };
  });

  res.render('structure/pastures', {
    title: 'Pastos',
    rows,
    statusLabels: STOCKING_STATUS_LABELS,
    statusVariants: STOCKING_STATUS_VARIANTS,
  });
});

router.get('/pastos/novo', requireCapability('pastures:write'), (req, res) => {
  res.render('structure/pastureForm', {
    title: 'Novo pasto',
    isCreate: true,
    pasture: null,
    values: { active: 'on' },
    errors: {},
    farms: listFarmsWithDetails(getDb(), req.scope.effectiveFarmIds),
    capacityPlaceholder: PROVISIONAL_STOCKING_CAPACITY_UA_HA,
  });
});

router.post('/pastos', requireCapability('pastures:write'), (req, res, next) => {
  const db = getDb();
  const farmId = resolveTargetFarm(req);
  if (!farmId) return next(new HttpError(400, 'Selecione uma fazenda válida.'));

  const result = validatePastureInput(req.body, { isDeactivating: false, occupantCount: 0 });

  if (!result.ok) {
    return res.status(400).render('structure/pastureForm', {
      title: 'Novo pasto',
      isCreate: true,
      pasture: null,
      values: req.body,
      errors: result.errors,
      farms: listFarmsWithDetails(db, req.scope.effectiveFarmIds),
      capacityPlaceholder: PROVISIONAL_STOCKING_CAPACITY_UA_HA,
    });
  }

  insertPasture(db, farmId, result.data);
  setFlash(req, 'success', `Pasto ${result.data.name} cadastrado.`);
  return res.redirect('/pastos');
});

router.get('/pastos/:id/editar', requireCapability('pastures:write'), (req, res, next) => {
  const db = getDb();
  const pasture = findPastureDetail(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!pasture) return next(new HttpError(404, 'Pasto não encontrado.'));

  res.render('structure/pastureForm', {
    title: `Editar ${pasture.name}`,
    isCreate: false,
    pasture,
    values: {
      name: pasture.name,
      areaHa: String(pasture.area_ha).replace('.', ','),
      forageType: pasture.forage_type,
      restPeriodDays: pasture.rest_period_days,
      maxStockingRateUaHa:
        pasture.max_stocking_rate_ua_ha !== null
          ? String(pasture.max_stocking_rate_ua_ha).replace('.', ',')
          : '',
      active: pasture.active ? 'on' : '',
    },
    errors: {},
    occupantCount: countPastureOccupants(db, pasture.id),
    farms: [],
    capacityPlaceholder: PROVISIONAL_STOCKING_CAPACITY_UA_HA,
  });
});

router.post('/pastos/:id/editar', requireCapability('pastures:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const pastureId = Number.parseInt(req.params.id, 10);
  const pasture = findPastureDetail(db, farmIds, pastureId);
  if (!pasture) return next(new HttpError(404, 'Pasto não encontrado.'));

  const occupantCount = countPastureOccupants(db, pastureId);
  const wantsActive = req.body.active === 'on';

  const result = validatePastureInput(req.body, {
    isDeactivating: pasture.active === 1 && !wantsActive,
    occupantCount,
  });

  if (!result.ok) {
    return res.status(400).render('structure/pastureForm', {
      title: `Editar ${pasture.name}`,
      isCreate: false,
      pasture,
      values: req.body,
      errors: result.errors,
      occupantCount,
      farms: [],
      capacityPlaceholder: PROVISIONAL_STOCKING_CAPACITY_UA_HA,
    });
  }

  updatePasture(db, farmIds, pastureId, result.data);
  setFlash(req, 'success', `Pasto ${result.data.name} atualizado.`);
  return res.redirect('/pastos');
});

export default router;
