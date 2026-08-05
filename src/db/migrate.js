/**
 * Migration runner.
 *
 * Applies every `.sql` file in `migrations/` in filename order, exactly once,
 * recording what has been applied in a `schema_migrations` table.
 *
 * The schema history is therefore plain readable SQL rather than a generated
 * artifact - which is the point. During a defense the entire evolution of the
 * database can be read directly from the migrations directory.
 *
 * Usage:
 *   npm run migrate           apply all pending migrations
 *   npm run migrate:status    list applied and pending migrations
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDb, closeDb } from '../config/db.js';
import { ROOT_DIR } from '../config/env.js';

const MIGRATIONS_DIR = path.join(ROOT_DIR, 'migrations');

/**
 * Creates the bookkeeping table if it does not exist yet.
 *
 * @param {import('better-sqlite3').Database} db
 */
function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/**
 * Reads the migration files from disk, sorted by filename.
 *
 * Filenames are zero-padded and numbered (001_, 002_, ...) so that
 * lexicographic order is also chronological order.
 *
 * @returns {Array<{filename: string, sql: string, checksum: string}>}
 */
function readMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];

  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      return { filename, sql, checksum };
    });
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {Map<string, string>} filename -> checksum
 */
function readAppliedMigrations(db) {
  const rows = db.prepare('SELECT filename, checksum FROM schema_migrations').all();
  return new Map(rows.map((row) => [row.filename, row.checksum]));
}

/**
 * Applies all pending migrations.
 *
 * Each migration runs inside its own transaction, so a failing migration leaves
 * the database in the state it had before that file - never half-applied.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {string[]} the filenames that were applied
 */
/**
 * A migration that starts with this marker is rebuilding a table that other
 * tables reference by foreign key (SQLite has no ALTER TABLE DROP CONSTRAINT,
 * so removing a CHECK means: create the new table, copy the rows across, drop
 * the old one, rename).
 *
 * That rebuild must NOT run inside an ordinary transaction. Two reasons,
 * both load-bearing:
 *
 *  1. `PRAGMA foreign_keys` is a documented no-op once a transaction is
 *     already open - it can only be changed between transactions. The normal
 *     path below opens a transaction before the migration's SQL ever runs, so
 *     a plain `PRAGMA foreign_keys = OFF;` line inside the file would silently
 *     do nothing.
 *  2. With enforcement ON, `DROP TABLE` on a table that others reference with
 *     `ON DELETE CASCADE` cascades - it deletes every referencing row in
 *     every child table, not just the dropped table's own rows. This is real,
 *     verified SQLite behaviour (confirmed against a throwaway in-memory
 *     database before this was written), not a hypothetical: an early attempt
 *     at migration 005 silently deleted all 720 seeded weighings this way,
 *     despite the migration's SQL never mentioning the weighings table.
 *
 * So this path disables enforcement first (outside any transaction), runs the
 * rebuild in its own manual transaction, re-enables enforcement, and then
 * runs `PRAGMA foreign_key_check` as a safety net - if the rebuild left any
 * row pointing at a foreign key that no longer resolves, the migration fails
 * loudly instead of shipping a quietly corrupted database.
 */
const REQUIRES_FK_REBUILD = /^-- requires: foreign_keys=off\r?\n/;

export function runMigrations(db) {
  ensureMigrationsTable(db);

  const applied = readAppliedMigrations(db);
  const files = readMigrationFiles();
  const executed = [];

  for (const { filename, sql, checksum } of files) {
    const previousChecksum = applied.get(filename);

    if (previousChecksum !== undefined) {
      // An already-applied migration that changed on disk means the schema in
      // the database no longer matches the schema in source control. Editing an
      // applied migration is never the right fix - add a new one instead.
      if (previousChecksum !== checksum) {
        throw new Error(
          `Migration "${filename}" was modified after being applied. ` +
            'Create a new migration instead of editing an applied one.',
        );
      }
      continue;
    }

    if (REQUIRES_FK_REBUILD.test(sql)) {
      applyTableRebuild(db, filename, sql, checksum);
    } else {
      const apply = db.transaction(() => {
        db.exec(sql);
        db.prepare(
          'INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)',
        ).run(filename, checksum, new Date().toISOString());
      });

      apply();
    }

    executed.push(filename);
  }

  return executed;
}

/**
 * Runs a `-- requires: foreign_keys=off` migration - see the comment above.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} filename
 * @param {string} sql
 * @param {string} checksum
 */
function applyTableRebuild(db, filename, sql, checksum) {
  db.pragma('foreign_keys = OFF');

  try {
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare(
        'INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)',
      ).run(filename, checksum, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const danglingRefs = db.pragma('foreign_key_check');
  if (danglingRefs.length > 0) {
    throw new Error(
      `Migration "${filename}" left ${danglingRefs.length} dangling foreign key reference(s). ` +
        'The transaction already committed - this needs manual repair, not a retry.',
    );
  }
}

/**
 * Returns the applied/pending breakdown without changing anything.
 *
 * @param {import('better-sqlite3').Database} db
 */
export function migrationStatus(db) {
  ensureMigrationsTable(db);

  const applied = readAppliedMigrations(db);
  const files = readMigrationFiles();

  return files.map(({ filename }) => ({
    filename,
    applied: applied.has(filename),
  }));
}

/** CLI entry point. */
function main() {
  const wantsStatus = process.argv.includes('--status');
  const db = getDb();

  try {
    if (wantsStatus) {
      const status = migrationStatus(db);

      if (status.length === 0) {
        console.log('No migration files found in migrations/.');
        return;
      }

      for (const { filename, applied } of status) {
        console.log(`${applied ? '[applied]' : '[pending]'} ${filename}`);
      }
      return;
    }

    const executed = runMigrations(db);

    if (executed.length === 0) {
      console.log('Database is up to date. No migrations to apply.');
      return;
    }

    for (const filename of executed) {
      console.log(`Applied ${filename}`);
    }
    console.log(`\n${executed.length} migration(s) applied.`);
  } finally {
    closeDb();
  }
}

// Only run the CLI when this file is executed directly, not when imported.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
