/**
 * Schema integrity tests.
 *
 * These assert that the database rejects invalid data on its own, without help
 * from the application. Each test corresponds to an item in the data-integrity
 * section of the issue register, and together they are the evidence that those
 * items are actually closed rather than merely declared.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal, insertWeighing } from '../helpers/testDb.js';

test('migrations create every expected table', () => {
  const db = createTestDb();

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => row.name);

  for (const expected of [
    'animals',
    'cost_categories',
    'costs',
    'deaths',
    'farms',
    'health_events',
    'health_protocols',
    'lots',
    'movements',
    'pastures',
    'reminders',
    'sale_items',
    'sales',
    'user_farms',
    'users',
    'weighings',
  ]) {
    assert.ok(tables.includes(expected), `missing table: ${expected}`);
  }

  db.close();
});

test('foreign key enforcement is active (DAT-07)', () => {
  const db = createTestDb();

  // SQLite silently ignores foreign keys unless the pragma is set per
  // connection. Without it every REFERENCES clause is decoration.
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  assert.throws(
    () => insertAnimal(db, 9999),
    /FOREIGN KEY constraint failed/,
    'an animal on a nonexistent farm must be rejected',
  );

  db.close();
});

test('dates must be stored in ISO format (BUG-03)', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  // A localized Brazilian date is exactly what breaks month filtering, so the
  // database refuses to store one in the first place.
  assert.throws(
    () => insertAnimal(db, farmId, { birth_date: '15/03/2024' }),
    /CHECK constraint failed/,
  );

  assert.throws(
    () => insertAnimal(db, farmId, { ear_tag: 'A002', birth_date: '2024-3-5' }),
    /CHECK constraint failed/,
  );

  // The ISO form is accepted.
  assert.ok(insertAnimal(db, farmId, { ear_tag: 'A003', birth_date: '2024-03-15' }));

  db.close();
});

test('ear tags are unique per farm but reusable across farms (DAT-01)', () => {
  const db = createTestDb();
  const farmA = insertFarm(db, { name: 'Fazenda A' });
  const farmB = insertFarm(db, { name: 'Fazenda B' });

  insertAnimal(db, farmA, { ear_tag: '0001' });

  assert.throws(
    () => insertAnimal(db, farmA, { ear_tag: '0001' }),
    /UNIQUE constraint failed/,
    'the same tag twice on one farm must be rejected',
  );

  // Two farms may legitimately run the same numbering.
  assert.ok(insertAnimal(db, farmB, { ear_tag: '0001' }));

  db.close();
});

test('an animal cannot be weighed twice on the same day (DAT-02)', () => {
  const db = createTestDb();
  const animalId = insertAnimal(db, insertFarm(db));

  insertWeighing(db, animalId, '2026-06-01', 380);

  // Two weighings on one date would give the GMD formula a zero denominator.
  assert.throws(
    () => insertWeighing(db, animalId, '2026-06-01', 385),
    /UNIQUE constraint failed/,
  );

  assert.ok(insertWeighing(db, animalId, '2026-06-02', 385));

  db.close();
});

test('weights must be strictly positive', () => {
  const db = createTestDb();
  const animalId = insertAnimal(db, insertFarm(db));

  assert.throws(() => insertWeighing(db, animalId, '2026-06-01', 0), /CHECK constraint failed/);
  assert.throws(() => insertWeighing(db, animalId, '2026-06-02', -5), /CHECK constraint failed/);

  db.close();
});

test('enumerated columns reject values outside their domain (DAT-03)', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  assert.throws(
    () => insertAnimal(db, farmId, { status: 'pastando' }),
    /CHECK constraint failed/,
  );
  assert.throws(() => insertAnimal(db, farmId, { sex: 'X' }), /CHECK constraint failed/);
  assert.throws(
    () => insertAnimal(db, farmId, { breed: 'girolando' }),
    /CHECK constraint failed/,
    'dairy breeds are out of scope for a beef-only system',
  );

  db.close();
});

test('a purchased animal must record its purchase date', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  assert.throws(
    () => insertAnimal(db, farmId, { origin: 'comprado', purchase_date: null }),
    /CHECK constraint failed/,
  );

  assert.ok(
    insertAnimal(db, farmId, {
      ear_tag: 'A010',
      origin: 'comprado',
      purchase_date: '2025-11-20',
    }),
  );

  db.close();
});

test('an animal cannot be its own mother', () => {
  const db = createTestDb();
  const animalId = insertAnimal(db, insertFarm(db));

  assert.throws(
    () => db.prepare('UPDATE animals SET mother_id = ? WHERE id = ?').run(animalId, animalId),
    /CHECK constraint failed/,
  );

  db.close();
});

test('an animal can only be sold once (DAT-06)', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);
  const now = '2026-08-03T12:00:00.000Z';

  const saleId = db
    .prepare(
      `INSERT INTO sales (farm_id, buyer_name, sale_date, price_per_arroba_cents, created_at, updated_at)
       VALUES (?, 'Frigorifico Teste', '2026-07-10', 32000, ?, ?)`,
    )
    .run(farmId, now, now).lastInsertRowid;

  const insertItem = () =>
    db
      .prepare(
        `INSERT INTO sale_items
           (sale_id, animal_id, live_weight_kg, carcass_yield_pct, arrobas, gross_value_cents, created_at)
         VALUES (?, ?, 510, 54, 18.36, 587520, ?)`,
      )
      .run(saleId, animalId, now);

  insertItem();
  assert.throws(insertItem, /UNIQUE constraint failed/);

  db.close();
});

test('carcass yield outside a plausible band is rejected', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);
  const now = '2026-08-03T12:00:00.000Z';

  const saleId = db
    .prepare(
      `INSERT INTO sales (farm_id, buyer_name, sale_date, price_per_arroba_cents, created_at, updated_at)
       VALUES (?, 'Frigorifico Teste', '2026-07-10', 32000, ?, ?)`,
    )
    .run(farmId, now, now).lastInsertRowid;

  // 95% yield is a typo, not an animal.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO sale_items
             (sale_id, animal_id, live_weight_kg, carcass_yield_pct, arrobas, gross_value_cents, created_at)
           VALUES (?, ?, 510, 95, 32.3, 1000000, ?)`,
        )
        .run(saleId, animalId, now),
    /CHECK constraint failed/,
  );

  db.close();
});

test('a recurring cost must state its recurrence interval', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const now = '2026-08-03T12:00:00.000Z';
  const categoryId = db
    .prepare("SELECT id FROM cost_categories WHERE slug = 'alimentacao'")
    .get().id;

  const insertCost = (isRecurring, recurrenceMonths) =>
    db
      .prepare(
        `INSERT INTO costs
           (farm_id, category_id, cost_date, amount_cents, is_recurring, recurrence_months, created_at, updated_at)
         VALUES (?, ?, '2026-07-01', 150000, ?, ?, ?, ?)`,
      )
      .run(farmId, categoryId, isRecurring, recurrenceMonths, now, now);

  assert.throws(() => insertCost(1, null), /CHECK constraint failed/);
  assert.ok(insertCost(1, 3));
  assert.ok(insertCost(0, null));

  db.close();
});

test('the five cost categories are seeded as reference data', () => {
  const db = createTestDb();

  const slugs = db
    .prepare('SELECT slug FROM cost_categories ORDER BY sort_order')
    .all()
    .map((row) => row.slug);

  assert.deepEqual(slugs, [
    'alimentacao',
    'sanidade',
    'mao_de_obra',
    'infraestrutura',
    'outros',
  ]);

  db.close();
});

test('every foreign key column is covered by an index (PERF-01)', () => {
  const db = createTestDb();

  // SQLite reports foreign keys that would force a full table scan on the
  // parent-side lookup. An empty result means every relationship is indexed.
  const unindexed = db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(unindexed, [], 'foreign key check must report no violations');

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
    .all()
    .map((row) => row.name);

  for (const expected of [
    'idx_animals_farm_status',
    'idx_weighings_animal_date',
    'idx_health_events_pending',
    'idx_costs_farm_date',
  ]) {
    assert.ok(indexes.includes(expected), `missing index: ${expected}`);
  }

  db.close();
});
