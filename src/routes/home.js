/**
 * Dashboard.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { migrationStatus } from '../db/migrate.js';
import { requireCapability } from '../middleware/auth.js';
import { buildDashboardKpis } from '../services/kpiService.js';
import { resolveDashboardFilters, buildFilterQuery } from '../services/dashboardFilters.js';
import { todayIso } from '../lib/dates.js';
import { ANIMAL_STATUS, ANIMAL_STATUS_LABELS } from '../domain/constants.js';

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

  res.render('dashboard', {
    title: 'Painel',
    kpis,
    filters,
    herdCountByStatus,
    statusOptions: STATUS_OPTIONS,
    statusLabels: STATUS_LABELS,
    buildFilterQuery: (overrides) => buildFilterQuery(req, overrides),
    migrations: migrationStatus(db),
  });
});

export default router;
