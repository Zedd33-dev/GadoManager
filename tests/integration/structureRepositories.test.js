/**
 * Tests for farmRepository and lotRepository.
 *
 * Both feed the dashboard's filter dropdowns, so the property that matters
 * most is the same one tested throughout this project: a farm or lote outside
 * the caller's scope must never appear, and must not be reachable by id either.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm } from '../helpers/testDb.js';
import { listInScope as listFarms } from '../../src/repositories/farmRepository.js';
import { listInScope as listLots, findInScope as findLot } from '../../src/repositories/lotRepository.js';

function insertLot(db, farmId, name, active = 1) {
  const now = '2026-08-03T12:00:00.000Z';
  return db
    .prepare(
      `INSERT INTO lots (farm_id, name, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(farmId, name, active, now, now).lastInsertRowid;
}

test('listFarms returns only farms in scope, ordered by name', () => {
  const db = createTestDb();
  const farmB = insertFarm(db, { name: 'Fazenda B' });
  const farmA = insertFarm(db, { name: 'Fazenda A' });
  insertFarm(db, { name: 'Fazenda Fora de Escopo' });

  const result = listFarms(db, [farmA, farmB]);

  assert.deepEqual(
    result.map((f) => f.name),
    ['Fazenda A', 'Fazenda B'],
  );

  db.close();
});

test('listLots includes only active lots within scope, with the farm name', () => {
  const db = createTestDb();
  const farmId = insertFarm(db, { name: 'Fazenda Boa Vista' });
  const otherFarm = insertFarm(db, { name: 'Fazenda Alheia' });

  insertLot(db, farmId, 'Matrizes');
  insertLot(db, farmId, 'Recria', 0); // inactive - must not appear
  insertLot(db, otherFarm, 'Lote Alheio');

  const result = listLots(db, [farmId]);

  assert.deepEqual(
    result.map((l) => l.name),
    ['Matrizes'],
  );
  assert.equal(result[0].farm_name, 'Fazenda Boa Vista');

  db.close();
});

test('findLot returns undefined for a lote outside scope, same as a nonexistent id', () => {
  const db = createTestDb();
  const farmId = insertFarm(db, { name: 'Fazenda Boa Vista' });
  const otherFarm = insertFarm(db, { name: 'Fazenda Alheia' });

  const ownLot = insertLot(db, farmId, 'Matrizes');
  const foreignLot = insertLot(db, otherFarm, 'Lote Alheio');

  assert.ok(findLot(db, [farmId], ownLot));
  assert.equal(findLot(db, [farmId], foreignLot), undefined);
  assert.equal(findLot(db, [farmId], 999999), undefined);

  db.close();
});

test('findLot does not return an inactive lot', () => {
  const db = createTestDb();
  const farmId = insertFarm(db, { name: 'Fazenda Boa Vista' });
  const inactiveLot = insertLot(db, farmId, 'Encerrado', 0);

  assert.equal(findLot(db, [farmId], inactiveLot), undefined);

  db.close();
});
