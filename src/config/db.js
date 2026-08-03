/**
 * SQLite connection.
 *
 * The whole application shares one `better-sqlite3` connection. That is safe
 * because better-sqlite3 is synchronous: a statement runs to completion before
 * Node processes the next event, so two requests can never interleave inside a
 * single transaction.
 *
 * This is also the reason the project uses SQLite at all - see
 * `docs/architecture.md`. It removes a database server from the setup
 * instructions, and the entire dataset is one file that can be copied to an
 * examiner's machine.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from './env.js';

let connection = null;

/**
 * Applies the pragmas every connection needs.
 *
 * `foreign_keys` deserves particular attention: SQLite disables foreign key
 * enforcement by default, per connection. Without this line every FOREIGN KEY
 * declaration in the schema is documentation rather than a constraint, and
 * orphaned rows accumulate silently. This is issue DAT-07 in the baseline
 * design document.
 *
 * @param {Database.Database} db
 */
function applyPragmas(db) {
  // Write-Ahead Logging: readers do not block the writer, which matters once
  // the dashboard runs several aggregate queries per request.
  db.pragma('journal_mode = WAL');

  // Enforce declared foreign keys. Must be set on every connection.
  db.pragma('foreign_keys = ON');

  // Wait rather than failing immediately if the database is briefly locked.
  db.pragma('busy_timeout = 5000');

  // Durability/performance trade-off appropriate for WAL mode.
  db.pragma('synchronous = NORMAL');
}

/**
 * Returns the shared database connection, opening it on first use.
 *
 * @returns {Database.Database}
 */
export function getDb() {
  if (connection) return connection;

  fs.mkdirSync(path.dirname(env.dbPath), { recursive: true });

  connection = new Database(env.dbPath);
  applyPragmas(connection);

  return connection;
}

/**
 * Opens an isolated connection to a specific file.
 *
 * Used by the test suite so each test can run against its own database without
 * touching the development data.
 *
 * @param {string} filePath path to the SQLite file, or ':memory:'
 * @returns {Database.Database}
 */
export function openDb(filePath) {
  const db = new Database(filePath);
  applyPragmas(db);
  return db;
}

/** Closes the shared connection, if one is open. */
export function closeDb() {
  if (!connection) return;
  connection.close();
  connection = null;
}
