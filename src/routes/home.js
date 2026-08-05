/**
 * Dashboard.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { migrationStatus } from '../db/migrate.js';
import { requireCapability } from '../middleware/auth.js';
import { buildDashboardKpis } from '../services/kpiService.js';
import { resolveDashboardFilters, buildFilterQuery } from '../services/dashboardFilters.js';
import {
  herdStatusChart,
  weightByLotChart,
  herdCompositionChart,
  weightEvolutionChart,
  gmdCurveChart,
  costsByCategoryChart,
} from '../services/chartDataService.js';
import { todayIso, addDays } from '../lib/dates.js';
import { toEmbeddableJson } from '../lib/safeJson.js';
import { listUpcoming } from '../repositories/reminderRepository.js';
import { ANIMAL_STATUS, ANIMAL_STATUS_LABELS } from '../domain/constants.js';

/** How far ahead the dashboard's reminder widget looks. */
const UPCOMING_REMINDER_WINDOW_DAYS = 14;

const router = Router();

const STATUS_OPTIONS = [
  ANIMAL_STATUS.ACTIVE,
  ANIMAL_STATUS.SOLD,
  ANIMAL_STATUS.DEAD,
  ANIMAL_STATUS.TRANSFERRED,
  'todos',
];

const STATUS_LABELS = { ...ANIMAL_STATUS_LABELS, todos: 'Todos' };

router.get('/', requireCapability('dashboard:read'), (req, res) => {
  const db = getDb();
  const today = todayIso();

  const filters = resolveDashboardFilters(req, db);

  const kpis = buildDashboardKpis(db, req.scope.effectiveFarmIds, {
    today,
    lotId: filters.lotId,
    period: filters.period,
  });

  const herdCountByStatus = {
    ativo: kpis.herd.active,
    vendido: kpis.herd.sold,
    morto: kpis.herd.dead,
    transferido: kpis.herd.transferred,
    todos: kpis.herd.total,
  };

  const scopeArgs = req.scope.effectiveFarmIds;
  const lotOption = { lotId: filters.lotId };

  const charts = {
    herdStatus: herdStatusChart(kpis.herd),
    weightByLot: weightByLotChart(db, scopeArgs, lotOption),
    herdComposition: herdCompositionChart(db, scopeArgs, today, lotOption),
    weightEvolution: weightEvolutionChart(db, scopeArgs, today, lotOption),
    gmdCurve: gmdCurveChart(db, scopeArgs, today, lotOption),
    costsByCategory: costsByCategoryChart(db, scopeArgs, today, lotOption),
  };

  const upcomingReminders = listUpcoming(db, req.scope.effectiveFarmIds, {
    until: addDays(today, UPCOMING_REMINDER_WINDOW_DAYS),
    limit: 5,
  });

  res.render('dashboard', {
    title: 'Painel',
    kpis,
    charts,
    chartsJson: toEmbeddableJson(charts),
    filters,
    herdCountByStatus,
    statusOptions: STATUS_OPTIONS,
    statusLabels: STATUS_LABELS,
    buildFilterQuery: (overrides) => buildFilterQuery(req, overrides),
    upcomingReminders,
    today,
    migrations: migrationStatus(db),
  });
});

export default router;
