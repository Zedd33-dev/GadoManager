/**
 * Vacinas, Tratamentos and Protocolos sanitários.
 *
 * Vacinas and Tratamentos are one router and one table, differing only by the
 * `kind` filter. Building them as two independent modules would mean two
 * copies of the overdue rule and two chances for them to diverge.
 *
 * Note the file name: `health.js` here is the sanitary module, distinct from
 * `healthcheck` - the liveness probe lives in `routes/healthcheck.js`.
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
import { todayIso } from '../lib/dates.js';
import {
  EVENT_SORT_COLUMNS,
  listProtocols,
  findProtocolInScope,
  insertProtocol,
  updateProtocol,
  countEvents,
  listEvents,
  listAllEvents,
  findEventInScope,
  markApplied,
  insertEventBatch,
  deleteEvent,
} from '../repositories/healthRepository.js';
import { listMovableAnimals } from '../repositories/movementRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import { listInScope as listFarmsInScope } from '../repositories/farmRepository.js';
import {
  validateProtocolInput,
  validateApplication,
  scheduleDatesFor,
  classifyEvent,
  EVENT_STATUS_LABELS,
  EVENT_STATUS_VARIANTS,
} from '../services/healthService.js';

const router = Router();

/** The two sanitary modules, differing only by the kind they filter on. */
const MODULES = {
  vacinas: { kind: 'vacina', title: 'Vacinas', singular: 'vacina' },
  tratamentos: { kind: 'tratamento', title: 'Tratamentos', singular: 'tratamento' },
};

const LIST_QUERY_FIELDS = ['q', 'status', 'lote', 'sort', 'dir', 'perPage'];

function currentListQuery(query) {
  return Object.fromEntries(LIST_QUERY_FIELDS.map((key) => [key, query[key]]));
}

function parseListQuery(query, kind) {
  const search = typeof query.q === 'string' ? query.q.trim().slice(0, 60) : '';
  const status = ['atrasada', 'a-vencer', 'aplicada'].includes(query.status) ? query.status : null;
  const lotIdRaw = Number.parseInt(query.lote, 10);

  return {
    filters: {
      kind,
      search: search || null,
      status,
      lotId: Number.isInteger(lotIdRaw) ? lotIdRaw : null,
      today: todayIso(),
    },
    sort: resolveSort(
      EVENT_SORT_COLUMNS,
      { defaultKey: 'scheduledDate', defaultDirection: 'asc' },
      query,
    ),
    pagination: parsePagination(query),
  };
}

/** Renders whichever of the two sanitary lists the URL selected. */
function renderEventList(moduleKey) {
  return (req, res) => {
    const db = getDb();
    const farmIds = req.scope.effectiveFarmIds;
    const module = MODULES[moduleKey];

    const { filters, sort, pagination } = parseListQuery(req.query, module.kind);

    const total = countEvents(db, farmIds, filters);
    const rows = listEvents(db, farmIds, {
      ...filters,
      sort,
      limit: pagination.perPage,
      offset: pagination.offset,
    }).map((row) => ({
      ...row,
      statusKey: classifyEvent(
        { scheduledDate: row.scheduled_date, appliedDate: row.applied_date },
        filters.today,
      ),
    }));

    const current = currentListQuery(req.query);

    res.render('health/index', {
      title: module.title,
      moduleKey,
      module,
      rows,
      filters,
      sort,
      pageInfo: buildPageInfo(total, pagination),
      lots: listLotsInScope(db, farmIds),
      statusLabels: EVENT_STATUS_LABELS,
      statusVariants: EVENT_STATUS_VARIANTS,
      csvQuery: buildQuery(current, { page: undefined }),
      buildSortQuery: (key) =>
        buildQuery(current, { sort: key, dir: nextDirectionFor(sort, key), page: undefined }),
      buildPageQuery: (page) => buildQuery(current, { page }),
      buildStatusQuery: (value) => buildQuery(current, { status: value, page: undefined }),
    });
  };
}

router.get('/vacinas', requireCapability('health:read'), renderEventList('vacinas'));
router.get('/tratamentos', requireCapability('health:read'), renderEventList('tratamentos'));

for (const [moduleKey, module] of Object.entries(MODULES)) {
  router.get(`/${moduleKey}/exportar.csv`, requireCapability('health:read'), (req, res) => {
    const db = getDb();
    const { filters } = parseListQuery(req.query, module.kind);
    const rows = listAllEvents(db, req.scope.effectiveFarmIds, filters);

    const csv = toCsv(
      ['Brinco', 'Tipo', 'Nome', 'Produto', 'Prevista', 'Aplicada', 'Carência (dias)', 'Lote'],
      rows.map((r) => [
        r.ear_tag,
        r.kind === 'vacina' ? 'Vacina' : 'Tratamento',
        r.name,
        r.product,
        r.scheduled_date,
        r.applied_date,
        r.withdrawal_days,
        r.lot_name,
      ]),
    );

    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${moduleKey}.csv"`);
    res.send(csv);
  });
}

// ---------------------------------------------------------------------------
// Applying a scheduled dose - the peão's job
// ---------------------------------------------------------------------------

router.get('/sanidade/:id/aplicar', requireCapability('health:apply'), (req, res, next) => {
  const db = getDb();
  const event = findEventInScope(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!event) return next(new HttpError(404, 'Registro sanitário não encontrado.'));

  if (event.applied_date) {
    setFlash(req, 'warning', 'Esta dose já foi aplicada.');
    return res.redirect(event.kind === 'vacina' ? '/vacinas' : '/tratamentos');
  }

  res.render('health/apply', {
    title: `Aplicar — ${event.ear_tag}`,
    event,
    values: { appliedDate: todayIso() },
    errors: {},
    today: todayIso(),
  });
});

router.post('/sanidade/:id/aplicar', requireCapability('health:apply'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const eventId = Number.parseInt(req.params.id, 10);
  const event = findEventInScope(db, farmIds, eventId);
  if (!event) return next(new HttpError(404, 'Registro sanitário não encontrado.'));

  const validation = validateApplication(req.body, { birth_date: event.birth_date });

  if (!validation.ok) {
    return res.status(400).render('health/apply', {
      title: `Aplicar — ${event.ear_tag}`,
      event,
      values: req.body,
      errors: validation.errors,
      today: todayIso(),
    });
  }

  const applied = markApplied(db, farmIds, eventId, {
    appliedDate: validation.data.appliedDate,
    applicatorUserId: req.user.id,
    batchNumber: validation.data.batchNumber,
    notes: validation.data.notes,
  });

  if (!applied) {
    setFlash(req, 'warning', 'Esta dose já havia sido aplicada.');
  } else if (event.withdrawal_days > 0) {
    setFlash(
      req,
      'success',
      `Aplicação registrada. O animal ${event.ear_tag} fica em carência por ` +
        `${event.withdrawal_days} dia(s) e não pode ser abatido nesse período.`,
    );
  } else {
    setFlash(req, 'success', 'Aplicação registrada.');
  }

  return res.redirect(event.kind === 'vacina' ? '/vacinas' : '/tratamentos');
});

router.post('/sanidade/:id/excluir', requireCapability('health:schedule'), (req, res) => {
  const db = getDb();
  const removed = deleteEvent(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));

  setFlash(
    req,
    removed ? 'success' : 'warning',
    removed ? 'Registro sanitário excluído.' : 'Nenhum registro foi excluído.',
  );

  return res.redirect(req.body.returnTo === 'tratamentos' ? '/tratamentos' : '/vacinas');
});

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

router.get('/protocolos', requireCapability('health:read'), (req, res) => {
  res.render('health/protocols', {
    title: 'Protocolos sanitários',
    protocols: listProtocols(getDb(), req.scope.effectiveFarmIds),
  });
});

router.get('/protocolos/novo', requireCapability('protocols:write'), (req, res) => {
  res.render('health/protocolForm', {
    title: 'Novo protocolo',
    isCreate: true,
    protocol: null,
    values: { active: 'on', kind: 'vacina', scheduleMode: 'por_idade' },
    errors: {},
    farms: listFarmsInScope(getDb(), req.scope.effectiveFarmIds),
  });
});

router.post('/protocolos', requireCapability('protocols:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const farmId =
    farmIds.length === 1 ? farmIds[0] : farmIds.find((id) => id === Number.parseInt(req.body.farmId, 10));

  if (!farmId) return next(new HttpError(400, 'Selecione uma fazenda válida.'));

  const result = validateProtocolInput(req.body);

  if (!result.ok) {
    return res.status(400).render('health/protocolForm', {
      title: 'Novo protocolo',
      isCreate: true,
      protocol: null,
      values: req.body,
      errors: result.errors,
      farms: listFarmsInScope(db, farmIds),
    });
  }

  insertProtocol(db, farmId, result.data);
  setFlash(req, 'success', `Protocolo ${result.data.name} cadastrado.`);
  return res.redirect('/protocolos');
});

router.get('/protocolos/:id/editar', requireCapability('protocols:write'), (req, res, next) => {
  const db = getDb();
  const protocol = findProtocolInScope(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!protocol) return next(new HttpError(404, 'Protocolo não encontrado.'));

  res.render('health/protocolForm', {
    title: `Editar ${protocol.name}`,
    isCreate: false,
    protocol,
    values: {
      name: protocol.name,
      kind: protocol.kind,
      product: protocol.product,
      dose: protocol.dose !== null ? String(protocol.dose).replace('.', ',') : '',
      doseUnit: protocol.dose_unit,
      withdrawalDays: protocol.withdrawal_days,
      scheduleMode: protocol.schedule_mode,
      ageDays: protocol.age_days,
      intervalDays: protocol.interval_days,
      active: protocol.active ? 'on' : '',
    },
    errors: {},
    farms: [],
  });
});

router.post('/protocolos/:id/editar', requireCapability('protocols:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const protocolId = Number.parseInt(req.params.id, 10);
  const protocol = findProtocolInScope(db, farmIds, protocolId);
  if (!protocol) return next(new HttpError(404, 'Protocolo não encontrado.'));

  const result = validateProtocolInput(req.body);

  if (!result.ok) {
    return res.status(400).render('health/protocolForm', {
      title: `Editar ${protocol.name}`,
      isCreate: false,
      protocol,
      values: req.body,
      errors: result.errors,
      farms: [],
    });
  }

  updateProtocol(db, farmIds, protocolId, result.data);
  setFlash(req, 'success', `Protocolo ${result.data.name} atualizado.`);
  return res.redirect('/protocolos');
});

// ---------------------------------------------------------------------------
// Applying a protocol to many animals - the auto-scheduling screen
// ---------------------------------------------------------------------------

router.get('/protocolos/:id/agendar', requireCapability('health:schedule'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const protocol = findProtocolInScope(db, farmIds, Number.parseInt(req.params.id, 10));
  if (!protocol) return next(new HttpError(404, 'Protocolo não encontrado.'));

  const lotIdRaw = Number.parseInt(req.query.lote, 10);
  const lotId = Number.isInteger(lotIdRaw) ? lotIdRaw : null;

  res.render('health/schedule', {
    title: `Agendar — ${protocol.name}`,
    protocol,
    animals: listMovableAnimals(db, [protocol.farm_id], { lotId }),
    lots: listLotsInScope(db, [protocol.farm_id]),
    selectedLotId: lotId,
    values: { baseDate: todayIso() },
    errors: {},
    today: todayIso(),
  });
});

router.post('/protocolos/:id/agendar', requireCapability('health:schedule'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const protocolId = Number.parseInt(req.params.id, 10);
  const protocol = findProtocolInScope(db, farmIds, protocolId);
  if (!protocol) return next(new HttpError(404, 'Protocolo não encontrado.'));

  const rawIds = Array.isArray(req.body.animalIds) ? req.body.animalIds : [req.body.animalIds].filter(Boolean);
  const animalIds = rawIds.map((id) => Number.parseInt(id, 10)).filter(Number.isInteger);

  const animals = listMovableAnimals(db, [protocol.farm_id]).filter((a) => animalIds.includes(a.id));

  const rerender = (errors) =>
    res.status(400).render('health/schedule', {
      title: `Agendar — ${protocol.name}`,
      protocol,
      animals: listMovableAnimals(db, [protocol.farm_id]),
      lots: listLotsInScope(db, [protocol.farm_id]),
      selectedLotId: null,
      values: req.body,
      errors,
      today: todayIso(),
    });

  if (animals.length === 0) return rerender({ animals: 'Selecione ao menos um animal.' });

  // Each animal needs its birth date for age-based scheduling, which
  // listMovableAnimals does not carry.
  const withBirthDates = db
    .prepare(
      `SELECT id, ear_tag, birth_date FROM animals WHERE id IN (${animals.map(() => '?').join(',')})`,
    )
    .all(...animals.map((a) => a.id));

  const entries = [];
  for (const animal of withBirthDates) {
    const schedule = scheduleDatesFor(protocol, animal, req.body.baseDate);
    if (!schedule.ok) return rerender({ baseDate: schedule.reason });

    for (const scheduledDate of schedule.dates) {
      entries.push({
        animalId: animal.id,
        protocolId: protocol.id,
        kind: protocol.kind,
        name: protocol.name,
        product: protocol.product,
        dose: protocol.dose,
        doseUnit: protocol.dose_unit,
        scheduledDate,
        // Copied from the protocol now, so a later edit to the protocol does
        // not retroactively change a carência already served.
        withdrawalDays: protocol.withdrawal_days,
      });
    }
  }

  insertEventBatch(db, entries);

  setFlash(
    req,
    'success',
    `${entries.length} dose(s) agendada(s) para ${withBirthDates.length} animal(is).`,
  );

  return res.redirect(protocol.kind === 'vacina' ? '/vacinas' : '/tratamentos');
});

export default router;
