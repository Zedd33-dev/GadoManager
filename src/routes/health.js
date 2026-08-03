/**
 * Liveness probe.
 *
 * Public on purpose: a health check that requires a session cannot be used by a
 * process monitor. It reports only whether the database answers, never any data.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';

const router = Router();

router.get('/health', (req, res) => {
  const result = getDb().prepare('SELECT 1 AS ok').get();

  res.json({
    status: result?.ok === 1 ? 'ok' : 'degraded',
    time: new Date().toISOString(),
  });
});

export default router;
