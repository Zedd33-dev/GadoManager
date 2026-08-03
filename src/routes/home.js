/**
 * Placeholder home page for the authenticated area.
 *
 * The real dashboard arrives in Phase 5. This exists so the foundation can be
 * verified end to end: session, role, tenant scope, formatting and views.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { migrationStatus } from '../db/migrate.js';
import { countInScope } from '../repositories/animalRepository.js';
import { requireCapability } from '../middleware/auth.js';

const router = Router();

router.get('/', requireCapability('dashboard:read'), (req, res) => {
  const db = getDb();

  res.render('home', {
    title: 'Início',
    migrations: migrationStatus(db),
    animalCount: countInScope(db, req.scope.effectiveFarmIds),
    activeCount: countInScope(db, req.scope.effectiveFarmIds, { status: 'ativo' }),
  });
});

export default router;
