/**
 * KPI correctness.
 *
 * Every figure asserted here is hand-computable from the fixture, and the
 * arithmetic is written out in the comments. These tests are the "short proof
 * for each KPI" the brief asks for.
 *
 * The fixture is deliberately small and hostile: it contains an animal with one
 * weighing, an animal with none, a sold animal that would distort every average
 * if it were counted, and an overdue dose belonging to that sold animal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal, insertWeighing } from '../helpers/testDb.js';
import { buildDashboardKpis } from '../../src/services/kpiService.js';
import {
  latestWeightAverage,
  averageDailyGain,
  healthAlertCounts,
  animalsWithoutRecentWeighing,
  costTotalInRange,
} from '../../src/repositories/dashboardRepository.js';

const TODAY = '2026-08-03';
const NOW = '2026-08-03T12:00:00.000Z';

function insertHealthEvent(db, animalId, { kind, scheduledDate, appliedDate = null }) {
  return db
    .prepare(
      `INSERT INTO health_events
         (animal_id, kind, name, scheduled_date, applied_date, withdrawal_days, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(animalId, kind, `${kind} de teste`, scheduledDate, appliedDate, NOW, NOW).lastInsertRowid;
}

function insertCost(db, farmId, costDate, amountCents) {
  const categoryId = db.prepare("SELECT id FROM cost_categories WHERE slug='alimentacao'").get().id;

  return db
    .prepare(
      `INSERT INTO costs (farm_id, category_id, cost_date, amount_cents, is_recurring, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(farmId, categoryId, costDate, amountCents, NOW, NOW).lastInsertRowid;
}

/**
 * The fixture.
 *
 *   A  active, two weighings:  400 kg on 03/06  ->  460 kg on 03/08   (61 days)
 *   B  active, two weighings:  300 kg on 04/07  ->  330 kg on 03/08   (30 days)
 *   C  active, ONE weighing:   500 kg on 03/08
 *   D  active, NO weighings
 *   E  SOLD,   two weighings:  700 kg on 03/06  ->  800 kg on 03/08
 */
function buildFixture() {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });
  const c = insertAnimal(db, farmId, { ear_tag: 'C' });
  const d = insertAnimal(db, farmId, { ear_tag: 'D' });
  const e = insertAnimal(db, farmId, { ear_tag: 'E', status: 'vendido' });

  insertWeighing(db, a, '2026-06-03', 400);
  insertWeighing(db, a, '2026-08-03', 460);

  insertWeighing(db, b, '2026-07-04', 300);
  insertWeighing(db, b, '2026-08-03', 330);

  insertWeighing(db, c, '2026-08-03', 500);

  insertWeighing(db, e, '2026-06-03', 700);
  insertWeighing(db, e, '2026-08-03', 800);

  return { db, farmId, a, b, c, d, e };
}

// ---------------------------------------------------------------------------
// Peso médio (última pesagem)
// ---------------------------------------------------------------------------

test('average weight uses each active animal\'s latest weighing only', () => {
  const { db, farmId } = buildFixture();

  // Active animals with a weighing: A = 460, B = 330, C = 500.
  // (460 + 330 + 500) / 3 = 430
  const result = latestWeightAverage(db, [farmId]);

  assert.equal(result.animalCount, 3);
  assert.equal(result.averageKg, 430);

  db.close();
});

test('average weight excludes the sold animal', () => {
  const { db, farmId, e } = buildFixture();

  // E weighs 800 kg. Including it would give (460+330+500+800)/4 = 522.5.
  const withSold = latestWeightAverage(db, [farmId]);
  assert.equal(withSold.averageKg, 430);

  // Reactivating E must change the answer - proving the status filter is load
  // bearing rather than incidentally satisfied by the fixture.
  db.prepare("UPDATE animals SET status = 'ativo' WHERE id = ?").run(e);
  assert.equal(latestWeightAverage(db, [farmId]).averageKg, 522.5);

  db.close();
});

test('average weight does not average every weighing ever taken', () => {
  const { db, farmId } = buildFixture();

  // Averaging the whole weighings table for active animals would give
  // (400+460+300+330+500)/5 = 398, which is not the current herd weight.
  assert.notEqual(latestWeightAverage(db, [farmId]).averageKg, 398);
  assert.equal(latestWeightAverage(db, [farmId]).averageKg, 430);

  db.close();
});

test('average weight is null, not zero, when nothing has been weighed', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'SOZINHO' });

  const result = latestWeightAverage(db, [farmId]);

  assert.equal(result.animalCount, 0);
  assert.equal(result.averageKg, null);

  db.close();
});

// ---------------------------------------------------------------------------
// GMD
// ---------------------------------------------------------------------------

test('GMD is the gain between the last two weighings, per animal', () => {
  const { db, farmId } = buildFixture();

  // A: (460 - 400) / 61 days = 0.983606... kg/day
  // B: (330 - 300) / 30 days = 1.0 kg/day
  // Average over the two = 0.991803...
  const result = averageDailyGain(db, [farmId]);

  assert.equal(result.animalCount, 2);
  assert.ok(Math.abs(result.averageKgPerDay - (60 / 61 + 1) / 2) < 1e-9);
  assert.ok(Math.abs(result.averageKgPerDay - 0.9918032786885246) < 1e-9);

  db.close();
});

test('an animal with a single weighing is excluded, not counted as zero', () => {
  const { db, farmId } = buildFixture();

  const result = averageDailyGain(db, [farmId]);

  // C has exactly one weighing and D has none. If either were counted as a
  // zero-gain animal the average would fall to 0.6612 (n=3) or 0.4959 (n=4).
  assert.equal(result.animalCount, 2, 'only animals with two weighings may contribute');
  assert.ok(result.averageKgPerDay > 0.99);

  const asIfCountedAsZero = (60 / 61 + 1 + 0) / 3;
  assert.notEqual(result.averageKgPerDay, asIfCountedAsZero);

  db.close();
});

test('GMD excludes sold animals', () => {
  const { db, farmId, e } = buildFixture();

  // E gained 100 kg in 61 days = 1.639 kg/day, well above the herd.
  const before = averageDailyGain(db, [farmId]);
  assert.equal(before.animalCount, 2);

  db.prepare("UPDATE animals SET status = 'ativo' WHERE id = ?").run(e);
  const after = averageDailyGain(db, [farmId]);

  assert.equal(after.animalCount, 3);
  assert.ok(after.averageKgPerDay > before.averageKgPerDay, 'the sold animal was being filtered');

  db.close();
});

test('GMD is null when no animal has two weighings', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const only = insertAnimal(db, farmId, { ear_tag: 'UNICO' });
  insertWeighing(db, only, '2026-08-03', 400);

  const result = averageDailyGain(db, [farmId]);

  assert.equal(result.animalCount, 0);
  assert.equal(result.averageKgPerDay, null);

  db.close();
});

test('GMD can be negative when an animal loses weight', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animal = insertAnimal(db, farmId, { ear_tag: 'SECA' });

  // A real outcome in the dry season, and the dashboard must show it rather
  // than clamping it to zero.
  insertWeighing(db, animal, '2026-06-03', 400);
  insertWeighing(db, animal, '2026-08-03', 380);

  const result = averageDailyGain(db, [farmId]);

  assert.equal(result.animalCount, 1);
  assert.ok(Math.abs(result.averageKgPerDay - -20 / 61) < 1e-9);

  db.close();
});

// ---------------------------------------------------------------------------
// Atrasados / a vencer
// ---------------------------------------------------------------------------

test('a dose is overdue only when past due, unapplied, and the animal is active', () => {
  const { db, farmId, a, b, e } = buildFixture();

  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: '2026-07-01' }); // overdue
  insertHealthEvent(db, b, { kind: 'vacina', scheduledDate: '2026-07-15' }); // overdue
  insertHealthEvent(db, b, { kind: 'tratamento', scheduledDate: '2026-06-20' }); // overdue

  // Past due but already applied - not overdue.
  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: '2026-05-01', appliedDate: '2026-05-02' });

  // Past due but the animal was sold - must never raise an alert.
  insertHealthEvent(db, e, { kind: 'vacina', scheduledDate: '2026-04-01' });

  // Due inside the 30-day window.
  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: '2026-08-20' });

  // Due beyond the window.
  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: '2026-12-01' });

  const result = healthAlertCounts(db, [farmId], TODAY, '2026-09-02');

  assert.equal(result.overdueVaccineDoses, 2, 'A and B, not the applied one nor the sold animal');
  assert.equal(result.overdueTreatmentDoses, 1);
  assert.equal(result.overdueAnimals, 2, 'three overdue doses spread across two animals');
  assert.equal(result.dueSoonDoses, 1, 'only the 20/08 dose is inside the window');

  db.close();
});

test('doses scheduled for today are upcoming, not overdue', () => {
  const { db, farmId, a } = buildFixture();

  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: TODAY });

  const result = healthAlertCounts(db, [farmId], TODAY, '2026-09-02');

  // The rule is `scheduled_date < today`, so today's dose is still due, not late.
  assert.equal(result.overdueVaccineDoses, 0);
  assert.equal(result.dueSoonDoses, 1);

  db.close();
});

test('overdue counts report doses and animals separately', () => {
  const { db, farmId, a } = buildFixture();

  // One animal carrying four overdue doses. Reporting only "4" invites the
  // reader to assume four animals - the confusion behind "72 vacinas atrasadas"
  // in a herd of 34.
  for (const date of ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01']) {
    insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: date });
  }

  const result = healthAlertCounts(db, [farmId], TODAY, '2026-09-02');

  assert.equal(result.overdueVaccineDoses, 4);
  assert.equal(result.overdueAnimals, 1);

  db.close();
});

test('the alert query cannot fan out across joins', () => {
  const { db, farmId, a } = buildFixture();

  insertHealthEvent(db, a, { kind: 'vacina', scheduledDate: '2026-07-01' });

  // Adding unrelated rows for the same animal must not multiply the dose count.
  insertWeighing(db, a, '2026-05-01', 380);
  insertWeighing(db, a, '2026-04-01', 360);

  const result = healthAlertCounts(db, [farmId], TODAY, '2026-09-02');

  assert.equal(result.overdueVaccineDoses, 1, 'one dose is one dose regardless of other rows');

  db.close();
});

// ---------------------------------------------------------------------------
// Sem pesagem
// ---------------------------------------------------------------------------

test('animals without a recent weighing include those never weighed', () => {
  const { db, farmId } = buildFixture();

  // Cutoff is 60 days before 03/08/2026, i.e. 04/06/2026.
  // A weighed 03/08 - recent.  B weighed 03/08 - recent.  C weighed 03/08 - recent.
  // D has never been weighed  - counted, and counted as never weighed.
  const result = animalsWithoutRecentWeighing(db, [farmId], '2026-06-04');

  assert.equal(result.total, 1);
  assert.equal(result.neverWeighed, 1);

  db.close();
});

test('an animal weighed long ago counts as stale but not as never weighed', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animal = insertAnimal(db, farmId, { ear_tag: 'ANTIGO' });
  insertAnimal(db, farmId, { ear_tag: 'NUNCA' });

  insertWeighing(db, animal, '2026-01-10', 350);

  const result = animalsWithoutRecentWeighing(db, [farmId], '2026-06-04');

  assert.equal(result.total, 2);
  assert.equal(result.neverWeighed, 1, 'the two populations are reported separately');

  db.close();
});

// ---------------------------------------------------------------------------
// Custos do mês
// ---------------------------------------------------------------------------

test('monthly cost sums a half-open range and reports the entry count', () => {
  const { db, farmId } = buildFixture();

  insertCost(db, farmId, '2026-08-01', 150000); // in
  insertCost(db, farmId, '2026-08-31', 250000); // in - last day of the month
  insertCost(db, farmId, '2026-07-31', 999999); // out - previous month
  insertCost(db, farmId, '2026-09-01', 888888); // out - next month

  const result = costTotalInRange(db, [farmId], '2026-08-01', '2026-09-01');

  assert.equal(result.totalCents, 400000);
  assert.equal(result.entryCount, 2, 'the boundary dates are handled correctly');

  db.close();
});

test('no costs recorded is distinguishable from costs summing to zero', () => {
  const { db, farmId } = buildFixture();

  const empty = costTotalInRange(db, [farmId], '2026-08-01', '2026-09-01');

  // The sum is 0 either way; only entryCount tells the two situations apart,
  // which is what stops the card rendering R$ 0,00 when nothing was recorded.
  assert.equal(empty.totalCents, 0);
  assert.equal(empty.entryCount, 0);

  db.close();
});

// ---------------------------------------------------------------------------
// Service assembly
// ---------------------------------------------------------------------------

test('the service reports null rather than zero when a KPI has no data', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'SEMDADOS' });

  const kpis = buildDashboardKpis(db, [farmId], { today: TODAY });

  assert.equal(kpis.averageWeight.value, null);
  assert.ok(kpis.averageWeight.emptyMessage);

  assert.equal(kpis.averageDailyGain.value, null);
  assert.ok(kpis.averageDailyGain.emptyMessage);

  assert.equal(kpis.monthlyCost.value, null);
  assert.ok(kpis.monthlyCost.emptyMessage);

  // Counts are genuinely zero and must stay numbers.
  assert.equal(kpis.herd.total, 1);
  assert.equal(kpis.healthAlerts.overdueTotalDoses, 0);

  db.close();
});

test('the service distinguishes a real zero cost from no cost', () => {
  const { db, farmId } = buildFixture();

  const withoutCosts = buildDashboardKpis(db, [farmId], { today: TODAY });
  assert.equal(withoutCosts.monthlyCost.value, null);
  assert.equal(withoutCosts.monthlyCost.entryCount, 0);

  insertCost(db, farmId, '2026-08-10', 50000);

  const withCosts = buildDashboardKpis(db, [farmId], { today: TODAY });
  assert.equal(withCosts.monthlyCost.value, 50000);
  assert.equal(withCosts.monthlyCost.emptyMessage, null);

  db.close();
});

test('the service reports the population each average was computed over', () => {
  const { db, farmId } = buildFixture();

  const kpis = buildDashboardKpis(db, [farmId], { today: TODAY });

  assert.equal(kpis.averageWeight.animalCount, 3);
  assert.equal(kpis.averageDailyGain.animalCount, 2);
  assert.match(kpis.averageDailyGain.explanation, /uma única pesagem são excluídos/);

  db.close();
});

test('every KPI is scoped to the caller\'s farms', () => {
  const { db, farmId } = buildFixture();

  const otherFarm = insertFarm(db, { name: 'Fazenda Alheia' });
  const intruder = insertAnimal(db, otherFarm, { ear_tag: 'X-1' });
  insertWeighing(db, intruder, '2026-06-03', 1000);
  insertWeighing(db, intruder, '2026-08-03', 1200);
  insertCost(db, otherFarm, '2026-08-05', 777777);
  insertHealthEvent(db, intruder, { kind: 'vacina', scheduledDate: '2026-01-01' });

  const kpis = buildDashboardKpis(db, [farmId], { today: TODAY });

  assert.equal(kpis.herd.total, 5, 'the other farm\'s animal is invisible');
  assert.equal(kpis.averageWeight.value, 430, 'a 1200 kg animal would have moved this');
  assert.equal(kpis.monthlyCost.value, null, 'the other farm\'s cost is invisible');
  assert.equal(kpis.healthAlerts.overdueTotalDoses, 0);

  db.close();
});

test('an empty scope produces zeros and nulls, never the whole database', () => {
  const { db } = buildFixture();

  const kpis = buildDashboardKpis(db, [], { today: TODAY });

  assert.equal(kpis.herd.total, 0);
  assert.equal(kpis.averageWeight.value, null);
  assert.equal(kpis.averageDailyGain.value, null);
  assert.equal(kpis.monthlyCost.value, null);
  assert.equal(kpis.structure.farms, 0);

  db.close();
});
