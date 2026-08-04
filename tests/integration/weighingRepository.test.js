import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal, insertWeighing } from '../helpers/testDb.js';
import {
  WEIGHING_SORT_COLUMNS,
  countFiltered,
  listPaginated,
  findAnimalByEarTag,
  findPreviousWeighing,
  existsOnDate,
  insertWeighing as insertRow,
  insertWeighingBatch,
  deleteWeighing,
  pastureOccupancy,
} from '../../src/repositories/weighingRepository.js';
import { resolveSort } from '../../src/lib/sorting.js';

const NOW = '2026-08-03T12:00:00.000Z';
const sortByDate = resolveSort(WEIGHING_SORT_COLUMNS, { defaultKey: 'weighDate' }, { dir: 'desc' });

function insertPasture(db, farmId, name, areaHa) {
  return db
    .prepare(
      `INSERT INTO pastures (farm_id, name, area_ha, active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run(farmId, name, areaHa, NOW, NOW).lastInsertRowid;
}

test('findAnimalByEarTag resolves a tag only within scope', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  insertAnimal(db, myFarm, { ear_tag: 'BV-0001' });
  insertAnimal(db, otherFarm, { ear_tag: 'SC-0001' });

  assert.ok(findAnimalByEarTag(db, [myFarm], 'BV-0001'));
  assert.equal(findAnimalByEarTag(db, [myFarm], 'SC-0001'), undefined);

  db.close();
});

test('findAnimalByEarTag refuses a sold or dead animal', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'VENDIDO', status: 'vendido' });
  insertAnimal(db, farmId, { ear_tag: 'MORTO', status: 'morto' });
  insertAnimal(db, farmId, { ear_tag: 'ATIVO', status: 'ativo' });

  // Weighing an animal that left the herd is a data-entry mistake by
  // definition; catching it here gives a clearer message than a later error.
  assert.equal(findAnimalByEarTag(db, [farmId], 'VENDIDO'), undefined);
  assert.equal(findAnimalByEarTag(db, [farmId], 'MORTO'), undefined);
  assert.ok(findAnimalByEarTag(db, [farmId], 'ATIVO'));

  db.close();
});

test('findPreviousWeighing is bounded by date, not simply the latest', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);

  insertWeighing(db, animalId, '2026-01-10', 300);
  insertWeighing(db, animalId, '2026-06-10', 400);

  // Back-dating a forgotten March weighing must compare against January, not
  // against the June reading that came after it.
  const previous = findPreviousWeighing(db, animalId, '2026-03-10');
  assert.equal(previous.weightKg, 300);
  assert.equal(previous.weighDate, '2026-01-10');

  db.close();
});

test('findPreviousWeighing returns undefined for a first weighing', () => {
  const db = createTestDb();
  const animalId = insertAnimal(db, insertFarm(db));

  assert.equal(findPreviousWeighing(db, animalId, '2026-01-01'), undefined);

  db.close();
});

test('existsOnDate detects the schema\'s one-weighing-per-day rule in advance', () => {
  const db = createTestDb();
  const animalId = insertAnimal(db, insertFarm(db));
  insertWeighing(db, animalId, '2026-06-10', 400);

  assert.equal(existsOnDate(db, animalId, '2026-06-10'), true);
  assert.equal(existsOnDate(db, animalId, '2026-06-11'), false);

  db.close();
});

test('the list reports the previous weighing and the implied GMD per row', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId, { ear_tag: 'BV-0001' });

  insertWeighing(db, animalId, '2026-06-03', 400);
  insertWeighing(db, animalId, '2026-08-03', 460);

  const rows = listPaginated(db, [farmId], { sort: sortByDate, limit: 10, offset: 0 });

  const latest = rows.find((r) => r.weigh_date === '2026-08-03');
  assert.equal(latest.prev_kg, 400);
  assert.ok(Math.abs(latest.gmd - 60 / 61) < 1e-9);

  const first = rows.find((r) => r.weigh_date === '2026-06-03');
  assert.equal(first.prev_kg, null, 'a first weighing has no predecessor');
  assert.equal(first.gmd, null);

  db.close();
});

test('a date filter does not blind a row to what preceded it', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);

  insertWeighing(db, animalId, '2026-06-03', 400);
  insertWeighing(db, animalId, '2026-08-03', 460);

  // Filtering to August alone must still know the June weight - the window is
  // computed over the animal's whole history and only then filtered.
  const rows = listPaginated(db, [farmId], {
    from: '2026-07-01',
    sort: sortByDate,
    limit: 10,
    offset: 0,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].prev_kg, 400);

  db.close();
});

test('countFiltered matches the list under the same filters', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });

  insertWeighing(db, a, '2026-06-03', 400);
  insertWeighing(db, a, '2026-08-03', 460);
  insertWeighing(db, b, '2026-08-03', 300);

  assert.equal(countFiltered(db, [farmId]), 3);
  assert.equal(countFiltered(db, [farmId], { search: 'A' }), 2);
  assert.equal(countFiltered(db, [farmId], { from: '2026-07-01' }), 2);

  db.close();
});

test('a batch insert is atomic - one bad row writes nothing', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });

  insertWeighing(db, b, '2026-08-03', 300);

  // The second entry duplicates an existing (animal, date), which the schema
  // rejects. A partially applied weighing day would leave the operator unable
  // to tell which animals were recorded.
  assert.throws(() =>
    insertWeighingBatch(db, [
      { animalId: a, weighDate: '2026-08-03', weightKg: 400, createdBy: null },
      { animalId: b, weighDate: '2026-08-03', weightKg: 310, createdBy: null },
    ]),
  );

  const written = db.prepare('SELECT COUNT(*) c FROM weighings WHERE animal_id = ?').get(a).c;
  assert.equal(written, 0, 'the first row must have been rolled back too');

  db.close();
});

test('a fully valid batch writes every row', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });

  const count = insertWeighingBatch(db, [
    { animalId: a, weighDate: '2026-08-03', weightKg: 400, createdBy: null },
    { animalId: b, weighDate: '2026-08-03', weightKg: 300, createdBy: null },
  ]);

  assert.equal(count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM weighings').get().c, 2);
  assert.equal(
    db.prepare("SELECT source FROM weighings LIMIT 1").get().source,
    'lote',
    'batch rows are marked as such',
  );

  db.close();
});

test('deleteWeighing is scoped through the animal\'s farm', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  const foreignAnimal = insertAnimal(db, otherFarm, { ear_tag: 'X' });
  const foreignWeighing = insertWeighing(db, foreignAnimal, '2026-08-03', 400);

  assert.equal(deleteWeighing(db, [myFarm], foreignWeighing), false);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM weighings').get().c, 1, 'it must survive');

  assert.equal(deleteWeighing(db, [otherFarm], foreignWeighing), true);

  db.close();
});

// ---------------------------------------------------------------------------
// Pasture occupancy, feeding the stocking rate
// ---------------------------------------------------------------------------

test('pastureOccupancy sums the latest weighing and counts unweighed animals', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const pastureId = insertPasture(db, farmId, 'Sede', 10);

  const weighed = insertAnimal(db, farmId, { ear_tag: 'W1', pasture_id: pastureId });
  const alsoWeighed = insertAnimal(db, farmId, { ear_tag: 'W2', pasture_id: pastureId });
  insertAnimal(db, farmId, { ear_tag: 'NEVER', pasture_id: pastureId });

  // Only the most recent weighing of each animal counts.
  insertWeighing(db, weighed, '2026-01-01', 300);
  insertWeighing(db, weighed, '2026-08-01', 450);
  insertWeighing(db, alsoWeighed, '2026-08-01', 450);

  const [occupancy] = pastureOccupancy(db, [farmId]);

  assert.equal(occupancy.animalCount, 3);
  assert.equal(occupancy.totalWeightKg, 900, 'the January reading must not be added in');
  assert.equal(occupancy.animalsWithWeight, 2);
  assert.equal(occupancy.animalsWithoutWeight, 1);

  db.close();
});

test('pastureOccupancy ignores animals that left the herd', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const pastureId = insertPasture(db, farmId, 'Sede', 10);

  const active = insertAnimal(db, farmId, { ear_tag: 'A', pasture_id: pastureId });
  const sold = insertAnimal(db, farmId, { ear_tag: 'S', pasture_id: pastureId, status: 'vendido' });

  insertWeighing(db, active, '2026-08-01', 450);
  insertWeighing(db, sold, '2026-08-01', 500);

  const [occupancy] = pastureOccupancy(db, [farmId]);

  assert.equal(occupancy.animalCount, 1);
  assert.equal(occupancy.totalWeightKg, 450, 'a sold animal no longer grazes this pasture');

  db.close();
});

test('an empty pasture still appears, with zeroes', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertPasture(db, farmId, 'Vazio', 10);

  const [occupancy] = pastureOccupancy(db, [farmId]);

  assert.equal(occupancy.animalCount, 0);
  assert.equal(occupancy.totalWeightKg, 0);
  assert.equal(occupancy.animalsWithoutWeight, 0);

  db.close();
});

test('pastureOccupancy never crosses a tenant boundary', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  insertPasture(db, otherFarm, 'Alheio', 10);

  assert.deepEqual(pastureOccupancy(db, [myFarm]), []);

  db.close();
});
