/**
 * Server bootstrap.
 *
 * Verifies configuration, confirms the database is reachable and migrated,
 * then starts listening.
 */

import { createApp } from './app.js';
import { env, assertProductionConfig } from './config/env.js';
import { getDb, closeDb } from './config/db.js';
import { migrationStatus } from './db/migrate.js';

function warnAboutPendingMigrations() {
  const pending = migrationStatus(getDb()).filter((entry) => !entry.applied);
  if (pending.length === 0) return;

  console.warn(
    `\nWarning: ${pending.length} pending migration(s). Run "npm run migrate" before using the application.`,
  );
  for (const { filename } of pending) console.warn(`  - ${filename}`);
  console.warn('');
}

function main() {
  assertProductionConfig();
  warnAboutPendingMigrations();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`GadoManager running at http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = (signal) => () => {
    console.log(`\n${signal} received, shutting down.`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main();
