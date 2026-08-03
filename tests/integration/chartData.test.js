/**
 * Chart data correctness.
 *
 * Lighter than the KPI proof-suite in kpi.test.js (Phase 4 carries the highest
 * risk in this project and is tested exhaustively there), but every test here
 * still asserts a real, checkable number - not just "the function returns
 * something".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal, insertWeighing } from '../helpers/testDb.js';
import {
  weightByLot,
  activeAnimalDemographics,
  monthlyWeightByLot,
  monthlyGmdByLot,
  monthlyCostByCategory,
} from '../../src/repositories/dashboardRepository.js';
import {
  herdStatusChart,
  herdCompositionChart,
  weightByLotChart,
  weightEvolutionChart,
  gmdCurveChart,
  costsByCategoryChart,
} from '../../src/services/chartDataService.js';

const TODAY = '2026-08-03';
const NOW = '2026-08-03T12:00:00.000Z';

function insertLot(db, farmId, name) {
  return db
    .prepare(`INSERT INTO lots (farm_id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
    .run(farmId, name, NOW, NOW).lastInsertRowid;
}

function insertCost(db, farmId, lotId, costDate, amountCents) {
  const categoryId = db.prepare("SELECT id FROM cost_categories WHERE slug='alimentacao'").get().id;
  return db
    .prepare(
      `INSERT INTO costs (farm_id, lot_id, category_id, cost_date, amount_cents, is_recurring, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(farmId, lotId, categoryId, costDate, amountCents, NOW, NOW).lastInsertRowid;
}

// ---------------------------------------------------------------------------
// weightByLot / herdStatusChart / composition
// ---------------------------------------------------------------------------

test('weightByLot groups the latest weighing per animal by lote', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot1 = insertLot(db, farmId, 'Lote 1');
  const lot2 = insertLot(db, farmId, 'Lote 2');

  const a = insertAnimal(db, farmId, { ear_tag: 'A', lot_id: lot1 });
  const b = insertAnimal(db, farmId, { ear_tag: 'B', lot_id: lot1 });
  const c = insertAnimal(db, farmId, { ear_tag: 'C', lot_id: lot2 });
  insertAnimal(db, farmId, { ear_tag: 'D', lot_id: null }); // no lote, no weighing - excluded

  insertWeighing(db, a, TODAY, 400);
  insertWeighing(db, b, TODAY, 440);
  insertWeighing(db, c, TODAY, 300);

  const rows = weightByLot(db, [farmId]);
  const byLot = Object.fromEntries(rows.map((r) => [r.lotId, r]));

  assert.equal(byLot[lot1].averageKg, 420);
  assert.equal(byLot[lot1].animalCount, 2);
  assert.equal(byLot[lot2].averageKg, 300);

  db.close();
});

test('weightByLotChart computes a weighted herd average and sorts descending', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const heavy = insertLot(db, farmId, 'Pesado');
  const light = insertLot(db, farmId, 'Leve');

  for (const tag of ['H1', 'H2']) {
    const id = insertAnimal(db, farmId, { ear_tag: tag, lot_id: heavy });
    insertWeighing(db, id, TODAY, 500);
  }
  const lightAnimal = insertAnimal(db, farmId, { ear_tag: 'L1', lot_id: light });
  insertWeighing(db, lightAnimal, TODAY, 200);

  const chart = weightByLotChart(db, [farmId]);

  assert.deepEqual(chart.labels, ['Pesado', 'Leve'], 'heaviest lote first');
  // Weighted: (500*2 + 200*1) / 3 = 400
  assert.equal(chart.herdAverage, 400);

  db.close();
});

test('herdStatusChart reports counts and percentages that sum to the total', () => {
  const chart = herdStatusChart({ total: 10, active: 7, sold: 2, dead: 1, transferred: 0 });

  const percentSum = chart.rows.reduce((sum, r) => sum + (r.percent ?? 0), 0);
  assert.ok(Math.abs(percentSum - 1) < 1e-9);
  assert.equal(chart.rows.find((r) => r.status === 'Ativo').count, 7);
});

test('herdStatusChart handles an empty herd without dividing by zero', () => {
  const chart = herdStatusChart({ total: 0, active: 0, sold: 0, dead: 0, transferred: 0 });

  assert.equal(chart.total, 0);
  assert.ok(chart.rows.every((r) => r.percent === null));
});

// ---------------------------------------------------------------------------
// Herd composition (age/sex classification)
// ---------------------------------------------------------------------------

test('classification boundaries match CALF_MAX_AGE_MONTHS and YOUNG_MAX_AGE_MONTHS', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  // 11 months -> bezerro; exactly 12 months -> novilha/boi.
  insertAnimal(db, farmId, { ear_tag: '11M-F', sex: 'F', birth_date: '2025-09-03' }); // 11 months
  insertAnimal(db, farmId, { ear_tag: '12M-F', sex: 'F', birth_date: '2025-08-03' }); // 12 months
  // 35 months -> novilha/boi; exactly 36 months -> vaca/touro.
  insertAnimal(db, farmId, { ear_tag: '35M-M', sex: 'M', birth_date: '2023-09-03' }); // 35 months
  insertAnimal(db, farmId, { ear_tag: '36M-M', sex: 'M', birth_date: '2023-08-03' }); // 36 months

  const rows = activeAnimalDemographics(db, [farmId]);
  assert.equal(rows.length, 4);

  const chart = herdCompositionChart(db, [farmId], TODAY);
  const byRange = Object.fromEntries(chart.rows.map((r) => [r.range, r]));

  assert.equal(byRange['Bezerro(a)'].female, 1, '11-month female is a calf');
  assert.equal(byRange['Novilha'].female, 1, '12-month female is a novilha');
  assert.equal(byRange['Boi'].male, 1, '35-month male is a boi');
  assert.equal(byRange['Touro'].male, 1, '36-month male is a touro');

  db.close();
});

test('herd composition excludes inactive animals', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'ATIVO', sex: 'F', birth_date: '2024-08-03', status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: 'VENDIDO', sex: 'F', birth_date: '2024-08-03', status: 'vendido' });

  const chart = herdCompositionChart(db, [farmId], TODAY);
  const total = chart.rows.reduce((sum, r) => sum + r.total, 0);

  assert.equal(total, 1);

  db.close();
});

// ---------------------------------------------------------------------------
// Monthly time series
// ---------------------------------------------------------------------------

test('monthlyWeightByLot includes weighings from animals later sold (no survivorship bias)', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot = insertLot(db, farmId, 'Engorda');
  const sold = insertAnimal(db, farmId, { ear_tag: 'S1', lot_id: lot, status: 'vendido' });

  insertWeighing(db, sold, '2026-06-15', 480);

  const rows = monthlyWeightByLot(db, [farmId], '2026-01-01');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].yearMonth, '2026-06');
  assert.equal(rows[0].averageKg, 480);

  db.close();
});

test('weightEvolutionChart fills every month in the window, with gaps as null', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot = insertLot(db, farmId, 'Único');
  const animal = insertAnimal(db, farmId, { ear_tag: 'A', lot_id: lot });

  insertWeighing(db, animal, '2026-08-01', 400); // current month only

  const chart = weightEvolutionChart(db, [farmId], TODAY);

  assert.equal(chart.months.length, 12);
  assert.equal(chart.months[chart.months.length - 1], '2026-08');
  assert.equal(chart.series.length, 1);

  const series = chart.series[0];
  assert.equal(series.data[series.data.length - 1], 400);
  assert.equal(series.data[0], null, 'a month with no weighing is a gap, not zero');

  db.close();
});

test('monthlyGmdByLot buckets a pair by the month of the later weighing', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot = insertLot(db, farmId, 'Lote');
  const animal = insertAnimal(db, farmId, { ear_tag: 'A', lot_id: lot });

  insertWeighing(db, animal, '2026-05-20', 400);
  insertWeighing(db, animal, '2026-06-10', 421); // +21kg over 21 days = 1 kg/day

  const rows = monthlyGmdByLot(db, [farmId], '2026-01-01');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].yearMonth, '2026-06', 'bucketed by the later weighing\'s month');
  assert.ok(Math.abs(rows[0].averageGmd - 1) < 1e-9);

  db.close();
});

test('a single weighing produces no GMD point, consistent with the KPI rule', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animal = insertAnimal(db, farmId, { ear_tag: 'UNICO' });
  insertWeighing(db, animal, '2026-06-10', 400);

  const chart = gmdCurveChart(db, [farmId], TODAY);

  assert.equal(chart.series.length, 0);

  db.close();
});

test('monthlyCostByCategory excludes farm-wide costs when scoped to a lote', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot = insertLot(db, farmId, 'Engorda');

  insertCost(db, farmId, null, '2026-08-05', 100000); // farm-wide
  insertCost(db, farmId, lot, '2026-08-06', 50000); // lot-specific

  const scoped = monthlyCostByCategory(db, [farmId], '2026-01-01', { lotId: lot });
  const total = scoped.reduce((sum, r) => sum + r.totalCents, 0);

  assert.equal(total, 50000);

  db.close();
});

test('costsByCategoryChart reports rows only for months and categories with spending', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertCost(db, farmId, null, '2026-08-05', 150000);

  const chart = costsByCategoryChart(db, [farmId], TODAY);

  assert.equal(chart.rows.length, 1);
  assert.equal(chart.rows[0].amountCents, 150000);
  assert.equal(chart.rows[0].category, 'Alimentação');

  db.close();
});

// ---------------------------------------------------------------------------
// Tenant scoping
// ---------------------------------------------------------------------------

test('chart queries never cross a tenant boundary', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha Fazenda' });
  const otherFarm = insertFarm(db, { name: 'Fazenda Alheia' });

  const intruder = insertAnimal(db, otherFarm, { ear_tag: 'X', sex: 'F', birth_date: '2024-01-01' });
  insertWeighing(db, intruder, TODAY, 999);
  insertCost(db, otherFarm, null, '2026-08-01', 555555);

  assert.equal(weightByLot(db, [myFarm]).length, 0);
  assert.equal(activeAnimalDemographics(db, [myFarm]).length, 0);
  assert.equal(monthlyCostByCategory(db, [myFarm], '2026-01-01').length, 0);

  db.close();
});
