/**
 * Relatório do rebanho: a single printable page summarising herd composition,
 * KPIs and the full animal roster, meant to be handed to someone off-screen
 * (Ctrl+P to PDF, or printed) rather than browsed interactively.
 *
 * Deliberately reuses buildDashboardKpis rather than recomputing the same
 * figures a second way - a report and the dashboard disagreeing on "peso
 * médio" would be exactly the kind of mismatched-number bug this project
 * exists to eliminate.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { buildDashboardKpis } from '../services/kpiService.js';
import { listAllFiltered } from '../repositories/animalRepository.js';
import { listInScope as listFarmsInScope } from '../repositories/farmRepository.js';
import { todayIso } from '../lib/dates.js';
import { ANIMAL_STATUS_LABELS } from '../domain/constants.js';

const router = Router();

router.get('/relatorios/rebanho', requireCapability('dashboard:read'), (req, res) => {
  const db = getDb();
  const today = todayIso();
  const farmIds = req.scope.effectiveFarmIds;

  const kpis = buildDashboardKpis(db, farmIds, { today });
  const farms = listFarmsInScope(db, farmIds);
  // The roster lists the current herd, not every animal ever recorded - sold,
  // dead and transferred counts already appear in kpis.herd above.
  const animals = listAllFiltered(db, farmIds, { status: 'ativo' });

  res.render('reports/herd', {
    title: 'Relatório do rebanho',
    generatedAt: today,
    farms,
    kpis,
    animals,
    statusLabels: ANIMAL_STATUS_LABELS,
  });
});

export default router;
