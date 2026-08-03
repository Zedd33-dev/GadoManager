/**
 * Placeholder routes for the Phase 0 skeleton.
 *
 * The real dashboard arrives in Phase 5; this exists so the foundation can be
 * verified end to end (config -> database -> view -> formatted output).
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { migrationStatus } from '../db/migrate.js';

const router = Router();

router.get('/', (req, res) => {
  const migrations = migrationStatus(getDb());

  res.render('home', {
    title: 'Início',
    migrations,
  });
});

/** Liveness probe. Also confirms the database connection is usable. */
router.get('/health', (req, res) => {
  const result = getDb().prepare('SELECT 1 AS ok').get();

  res.json({
    status: result?.ok === 1 ? 'ok' : 'degraded',
    time: new Date().toISOString(),
  });
});

export default router;
