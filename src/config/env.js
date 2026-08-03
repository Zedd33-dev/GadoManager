/**
 * Environment configuration.
 *
 * Every value the application reads from the environment is resolved here, so
 * `process.env` is never touched anywhere else in the codebase. That keeps the
 * deployment contract in one readable place - see `.env.example`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the project root, derived from this file's location. */
export const ROOT_DIR = path.resolve(currentDir, '..', '..');

function readString(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function readInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(value) ? value : fallback;
}

export const env = {
  nodeEnv: readString('NODE_ENV', 'development'),
  port: readInteger('PORT', 3000),

  /** Absolute path to the SQLite file. */
  dbPath: path.resolve(ROOT_DIR, readString('DB_PATH', 'data/gadomanager.db')),

  sessionSecret: readString('SESSION_SECRET', ''),
};

export const isProduction = env.nodeEnv === 'production';
export const isTest = env.nodeEnv === 'test';

/**
 * Fails fast on configuration that is unsafe in production.
 *
 * Called from the server bootstrap rather than at import time so that tests and
 * migration scripts can load this module without a production-grade secret.
 */
export function assertProductionConfig() {
  if (!isProduction) return;

  if (env.sessionSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters in production. ' +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
}
