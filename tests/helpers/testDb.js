/**
 * Test database helper.
 *
 * Builds a fresh in-memory database by running the real migrations, so tests
 * exercise the schema that actually ships rather than a hand-written copy of it.
 */

import { openDb } from '../../src/config/db.js';
import { runMigrations } from '../../src/db/migrate.js';

/**
 * Creates an isolated, fully migrated in-memory database.
 *
 * @returns {import('better-sqlite3').Database}
 */
export function createTestDb() {
  const db = openDb(':memory:');
  runMigrations(db);
  return db;
}

const NOW = '2026-08-03T12:00:00.000Z';

/** Inserts a farm and returns its id. */
export function insertFarm(db, { name = 'Fazenda Teste', state = 'MS', areaHa = 1000 } = {}) {
  return db
    .prepare(
      `INSERT INTO farms (name, city, state, total_area_ha, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(name, 'Campo Grande', state, areaHa, NOW, NOW).lastInsertRowid;
}

/** Inserts an animal and returns its id. */
export function insertAnimal(db, farmId, overrides = {}) {
  const animal = {
    ear_tag: 'A001',
    sisbov: null,
    birth_date: '2024-03-15',
    sex: 'M',
    breed: 'nelore',
    origin: 'nascido',
    purchase_date: null,
    status: 'ativo',
    lot_id: null,
    pasture_id: null,
    ...overrides,
  };

  return db
    .prepare(
      `INSERT INTO animals
         (farm_id, ear_tag, sisbov, birth_date, sex, breed, origin, purchase_date,
          lot_id, pasture_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      farmId,
      animal.ear_tag,
      animal.sisbov,
      animal.birth_date,
      animal.sex,
      animal.breed,
      animal.origin,
      animal.purchase_date,
      animal.lot_id,
      animal.pasture_id,
      animal.status,
      NOW,
      NOW,
    ).lastInsertRowid;
}

/** Inserts a weighing and returns its id. */
export function insertWeighing(db, animalId, weighDate, weightKg) {
  return db
    .prepare(
      `INSERT INTO weighings (animal_id, weigh_date, weight_kg, source, created_at)
       VALUES (?, ?, ?, 'manual', ?)`,
    )
    .run(animalId, weighDate, weightKg, NOW).lastInsertRowid;
}
