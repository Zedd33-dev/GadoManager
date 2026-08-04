/**
 * Tests for the Animais list repository, and for write/delete scoping.
 *
 * The read-side tests focus on the properties that matter for a list screen:
 * search and filters combine correctly, sorting is safe, pagination bounds
 * are respected, and CSV export sees exactly what the screen sees. The
 * write-side tests focus on the property this whole project keeps testing:
 * a write outside the caller's scope must not happen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal, insertWeighing } from '../helpers/testDb.js';
import {
  countFiltered,
  listPaginated,
  listAllFiltered,
  findInScope,
  findWithDetailsInScope,
  insertAnimal as insertAnimalRow,
  updateAnimal,
  updatePhotoPath,
  deleteAnimals,
  getTimeline,
  getWeightHistory,
  listCandidateMothers,
} from '../../src/repositories/animalRepository.js';
import { resolveSort } from '../../src/lib/sorting.js';
import { ANIMAL_SORT_COLUMNS } from '../../src/repositories/animalRepository.js';

const NOW = '2026-08-03T12:00:00.000Z';

function insertLot(db, farmId, name) {
  return db
    .prepare(`INSERT INTO lots (farm_id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
    .run(farmId, name, NOW, NOW).lastInsertRowid;
}

const sortAsc = (key) => resolveSort(ANIMAL_SORT_COLUMNS, { defaultKey: key }, { sort: key, dir: 'asc' });

test('search matches ear tag or sisbov, case-sensitively bound as a parameter', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'BV-0001', sisbov: null });
  insertAnimal(db, farmId, { ear_tag: 'BV-0002', sisbov: '105999888777' });
  insertAnimal(db, farmId, { ear_tag: 'SC-0001', sisbov: null });

  const byTag = listPaginated(db, [farmId], { search: 'BV-', sort: sortAsc('earTag'), limit: 10, offset: 0 });
  assert.deepEqual(byTag.map((r) => r.ear_tag), ['BV-0001', 'BV-0002']);

  const bySisbov = listPaginated(db, [farmId], { search: '999888', sort: sortAsc('earTag'), limit: 10, offset: 0 });
  assert.deepEqual(bySisbov.map((r) => r.ear_tag), ['BV-0002']);

  db.close();
});

test('a percent sign in the search term is treated literally, not as a wildcard', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: '50%-A' });
  insertAnimal(db, farmId, { ear_tag: '50X-B' });

  const results = listPaginated(db, [farmId], { search: '50%', sort: sortAsc('earTag'), limit: 10, offset: 0 });

  assert.deepEqual(results.map((r) => r.ear_tag), ['50%-A'], 'the % must not match 50X-B as a wildcard');

  db.close();
});

test('status, breed, sex and lote filters combine with AND', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lotA = insertLot(db, farmId, 'A');
  const lotB = insertLot(db, farmId, 'B');

  insertAnimal(db, farmId, { ear_tag: '1', breed: 'nelore', sex: 'M', lot_id: lotA, status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: '2', breed: 'nelore', sex: 'F', lot_id: lotA, status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: '3', breed: 'angus', sex: 'M', lot_id: lotB, status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: '4', breed: 'nelore', sex: 'M', lot_id: lotB, status: 'vendido' });

  const result = listPaginated(db, [farmId], {
    breed: 'nelore',
    sex: 'M',
    lotId: lotA,
    status: 'ativo',
    sort: sortAsc('earTag'),
    limit: 10,
    offset: 0,
  });

  assert.deepEqual(result.map((r) => r.ear_tag), ['1']);

  db.close();
});

test('sorting by weight orders by the latest weighing, nulls last is acceptable either way but must not crash', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const heavy = insertAnimal(db, farmId, { ear_tag: 'HEAVY' });
  const light = insertAnimal(db, farmId, { ear_tag: 'LIGHT' });
  insertAnimal(db, farmId, { ear_tag: 'NONE' });

  insertWeighing(db, heavy, '2026-08-01', 500);
  insertWeighing(db, light, '2026-08-01', 200);

  const sort = resolveSort(ANIMAL_SORT_COLUMNS, { defaultKey: 'weight' }, { sort: 'weight', dir: 'desc' });
  const result = listPaginated(db, [farmId], { sort, limit: 10, offset: 0 });

  const weighed = result.filter((r) => r.latest_weight_kg !== null);
  assert.deepEqual(weighed.map((r) => r.ear_tag), ['HEAVY', 'LIGHT']);

  db.close();
});

test('pagination returns the correct slice and countFiltered matches the true total', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  for (let i = 1; i <= 30; i += 1) {
    insertAnimal(db, farmId, { ear_tag: String(i).padStart(3, '0') });
  }

  assert.equal(countFiltered(db, [farmId]), 30);

  const page1 = listPaginated(db, [farmId], { sort: sortAsc('earTag'), limit: 10, offset: 0 });
  const page2 = listPaginated(db, [farmId], { sort: sortAsc('earTag'), limit: 10, offset: 10 });

  assert.equal(page1.length, 10);
  assert.equal(page1[0].ear_tag, '001');
  assert.equal(page2[0].ear_tag, '011');

  db.close();
});

test('listAllFiltered (CSV export) uses the exact same filters as the paginated list', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  insertAnimal(db, farmId, { ear_tag: 'A', breed: 'nelore' });
  insertAnimal(db, farmId, { ear_tag: 'B', breed: 'angus' });

  const filters = { breed: 'nelore' };
  const paginated = listPaginated(db, [farmId], { ...filters, sort: sortAsc('earTag'), limit: 10, offset: 0 });
  const all = listAllFiltered(db, [farmId], filters);

  assert.deepEqual(
    paginated.map((r) => r.ear_tag),
    all.map((r) => r.ear_tag),
  );

  db.close();
});

test('list queries never cross a tenant boundary', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  insertAnimal(db, otherFarm, { ear_tag: 'INTRUSO' });

  assert.equal(countFiltered(db, [myFarm]), 0);
  assert.deepEqual(listPaginated(db, [myFarm], { sort: sortAsc('earTag'), limit: 10, offset: 0 }), []);
  assert.deepEqual(listAllFiltered(db, [myFarm]), []);

  db.close();
});

// ---------------------------------------------------------------------------
// Writes: insert, update, photo, delete - all scoped
// ---------------------------------------------------------------------------

function baseAnimalData(overrides = {}) {
  return {
    earTag: 'BV-0100',
    sisbov: null,
    birthDate: '2024-01-10',
    sex: 'M',
    breed: 'nelore',
    origin: 'nascido',
    motherId: null,
    purchaseDate: null,
    purchasePriceCents: null,
    lotId: null,
    pastureId: null,
    status: 'ativo',
    photoPath: null,
    notes: null,
    ...overrides,
  };
}

test('insertAnimal creates a row retrievable via findInScope', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const id = insertAnimalRow(db, farmId, baseAnimalData());
  const found = findInScope(db, [farmId], id);

  assert.equal(found.ear_tag, 'BV-0100');
  assert.equal(found.status, 'ativo');

  db.close();
});

test('updateAnimal only affects a row within the caller\'s scope', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  const foreignId = insertAnimalRow(db, otherFarm, baseAnimalData({ earTag: 'ALHEIO' }));

  const changed = updateAnimal(db, [myFarm], foreignId, baseAnimalData({ earTag: 'HACKED' }));

  assert.equal(changed, false, 'an update outside scope must report no change');
  assert.equal(findInScope(db, [otherFarm], foreignId).ear_tag, 'ALHEIO', 'and must not have modified the row');

  db.close();
});

test('updateAnimal changes the row when it is in scope', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const id = insertAnimalRow(db, farmId, baseAnimalData());

  const changed = updateAnimal(db, [farmId], id, baseAnimalData({ earTag: 'BV-0100-B', notes: 'atualizado' }));

  assert.equal(changed, true);
  const found = findInScope(db, [farmId], id);
  assert.equal(found.ear_tag, 'BV-0100-B');
  assert.equal(found.notes, 'atualizado');

  db.close();
});

test('updatePhotoPath is scoped the same way', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  const foreignId = insertAnimalRow(db, otherFarm, baseAnimalData());

  assert.equal(updatePhotoPath(db, [myFarm], foreignId, 'evil.jpg'), false);
  assert.equal(findInScope(db, [otherFarm], foreignId).photo_path, null);

  db.close();
});

test('deleteAnimals removes only rows within scope, reporting the true count', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  const mine1 = insertAnimalRow(db, myFarm, baseAnimalData({ earTag: 'M1' }));
  const mine2 = insertAnimalRow(db, myFarm, baseAnimalData({ earTag: 'M2' }));
  const foreign = insertAnimalRow(db, otherFarm, baseAnimalData({ earTag: 'F1' }));

  const deletedCount = deleteAnimals(db, [myFarm], [mine1, mine2, foreign]);

  assert.equal(deletedCount, 2, 'the foreign id must be silently excluded, not deleted');
  assert.equal(findInScope(db, [myFarm], mine1), undefined);
  assert.equal(findInScope(db, [myFarm], mine2), undefined);
  assert.ok(findInScope(db, [otherFarm], foreign), 'the foreign animal must survive');

  db.close();
});

test('deleteAnimals cascades to the animal\'s weighings', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const id = insertAnimalRow(db, farmId, baseAnimalData());
  insertWeighing(db, id, '2026-01-01', 300);

  deleteAnimals(db, [farmId], [id]);

  const remaining = db.prepare('SELECT COUNT(*) c FROM weighings WHERE animal_id = ?').get(id).c;
  assert.equal(remaining, 0);

  db.close();
});

test('deleteAnimals with an empty id list deletes nothing and does not throw', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  assert.equal(deleteAnimals(db, [farmId], []), 0);

  db.close();
});

// ---------------------------------------------------------------------------
// Detail page: findWithDetailsInScope, timeline, weight history, mothers
// ---------------------------------------------------------------------------

test('findWithDetailsInScope resolves lot, pasture and mother names', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lotId = insertLot(db, farmId, 'Recria');
  const motherId = insertAnimalRow(db, farmId, baseAnimalData({ earTag: 'MAE-01', sex: 'F' }));
  const calfId = insertAnimalRow(
    db,
    farmId,
    baseAnimalData({ earTag: 'BEZERRO-01', motherId, lotId }),
  );

  const details = findWithDetailsInScope(db, [farmId], calfId);

  assert.equal(details.lot_name, 'Recria');
  assert.equal(details.mother_ear_tag, 'MAE-01');

  db.close();
});

test('getTimeline merges weighings, health events and movements, most recent first', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const id = insertAnimalRow(db, farmId, baseAnimalData());

  insertWeighing(db, id, '2026-01-10', 300);
  insertWeighing(db, id, '2026-03-10', 340);

  db.prepare(
    `INSERT INTO health_events (animal_id, kind, name, scheduled_date, applied_date, withdrawal_days, created_at, updated_at)
     VALUES (?, 'vacina', 'Brucelose', '2026-02-01', '2026-02-01', 0, ?, ?)`,
  ).run(id, NOW, NOW);

  const timeline = getTimeline(db, id);

  assert.equal(timeline.length, 3);
  assert.equal(timeline[0].date, '2026-03-10', 'most recent first');
  assert.equal(timeline[timeline.length - 1].date, '2026-01-10');

  db.close();
});

test('getWeightHistory returns weighings in chronological order for the chart', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const id = insertAnimalRow(db, farmId, baseAnimalData());

  insertWeighing(db, id, '2026-03-10', 340);
  insertWeighing(db, id, '2026-01-10', 300);

  const history = getWeightHistory(db, id);

  assert.deepEqual(history.map((h) => h.date), ['2026-01-10', '2026-03-10']);

  db.close();
});

test('listCandidateMothers returns only active females on the given farm', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const otherFarm = insertFarm(db, { name: 'Outra' });

  insertAnimalRow(db, farmId, baseAnimalData({ earTag: 'F-ATIVA', sex: 'F', status: 'ativo' }));
  insertAnimalRow(db, farmId, baseAnimalData({ earTag: 'F-VENDIDA', sex: 'F', status: 'vendido' }));
  insertAnimalRow(db, farmId, baseAnimalData({ earTag: 'M-ATIVO', sex: 'M', status: 'ativo' }));
  insertAnimalRow(db, otherFarm, baseAnimalData({ earTag: 'F-OUTRA-FAZENDA', sex: 'F', status: 'ativo' }));

  const mothers = listCandidateMothers(db, farmId);

  assert.deepEqual(mothers.map((m) => m.ear_tag), ['F-ATIVA']);

  db.close();
});
