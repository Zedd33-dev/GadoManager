import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal } from '../helpers/testDb.js';
import {
  EVENT_SORT_COLUMNS,
  insertProtocol,
  findProtocolInScope,
  listProtocols,
  insertEventBatch,
  countEvents,
  listEvents,
  findEventInScope,
  markApplied,
  listAppliedWithWithdrawal,
  listAnimalsUnderWithdrawal,
} from '../../src/repositories/healthRepository.js';
import { recordMovements, findMovableByIds } from '../../src/repositories/movementRepository.js';
import { resolveSort } from '../../src/lib/sorting.js';

const NOW = '2026-08-03T12:00:00.000Z';
const TODAY = '2026-08-03';
const sort = resolveSort(EVENT_SORT_COLUMNS, { defaultKey: 'scheduledDate' }, {});

function protocolData(overrides = {}) {
  return {
    name: 'Vermífugo',
    kind: 'tratamento',
    product: 'Produto X',
    dose: 5,
    doseUnit: 'ml',
    withdrawalDays: 30,
    scheduleMode: 'por_data',
    ageDays: null,
    intervalDays: null,
    active: true,
    ...overrides,
  };
}

function scheduleEvent(db, animalId, overrides = {}) {
  return insertEventBatch(db, [
    {
      animalId,
      protocolId: null,
      kind: 'vacina',
      name: 'Dose de teste',
      product: null,
      dose: null,
      doseUnit: null,
      scheduledDate: '2026-07-01',
      withdrawalDays: 0,
      ...overrides,
    },
  ]);
}

test('protocols are scoped to the caller\'s farms', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  insertProtocol(db, myFarm, protocolData({ name: 'Meu' }));
  const foreignId = insertProtocol(db, otherFarm, protocolData({ name: 'Alheio' }));

  assert.deepEqual(listProtocols(db, [myFarm]).map((p) => p.name), ['Meu']);
  assert.equal(findProtocolInScope(db, [myFarm], foreignId), undefined);

  db.close();
});

test('the overdue filter applies all three conditions together', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const active = insertAnimal(db, farmId, { ear_tag: 'ATIVO' });
  const sold = insertAnimal(db, farmId, { ear_tag: 'VENDIDO', status: 'vendido' });

  // Past due, unapplied, active animal -> overdue.
  scheduleEvent(db, active, { scheduledDate: '2026-07-01' });
  // Past due but already applied -> not overdue.
  scheduleEvent(db, active, { scheduledDate: '2026-06-01' });
  db.prepare("UPDATE health_events SET applied_date = '2026-06-02' WHERE scheduled_date = '2026-06-01'").run();
  // Past due, unapplied, but the animal was sold -> must never alert.
  scheduleEvent(db, sold, { scheduledDate: '2026-05-01' });
  // Due in the future -> not overdue.
  scheduleEvent(db, active, { scheduledDate: '2026-12-01' });

  const overdue = countEvents(db, [farmId], { status: 'atrasada', today: TODAY });
  assert.equal(overdue, 1, 'only the genuinely overdue dose counts');

  const upcoming = countEvents(db, [farmId], { status: 'a-vencer', today: TODAY });
  assert.equal(upcoming, 1);

  const applied = countEvents(db, [farmId], { status: 'aplicada', today: TODAY });
  assert.equal(applied, 1);

  db.close();
});

test('a dose due today counts as upcoming, not overdue', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);

  scheduleEvent(db, animalId, { scheduledDate: TODAY });

  assert.equal(countEvents(db, [farmId], { status: 'atrasada', today: TODAY }), 0);
  assert.equal(countEvents(db, [farmId], { status: 'a-vencer', today: TODAY }), 1);

  db.close();
});

test('the kind filter is what separates Vacinas from Tratamentos', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);

  scheduleEvent(db, animalId, { kind: 'vacina', name: 'Brucelose', scheduledDate: '2026-07-01' });
  scheduleEvent(db, animalId, { kind: 'tratamento', name: 'Vermífugo', scheduledDate: '2026-07-02' });

  const vaccines = listEvents(db, [farmId], { kind: 'vacina', sort, limit: 10, offset: 0 });
  const treatments = listEvents(db, [farmId], { kind: 'tratamento', sort, limit: 10, offset: 0 });

  assert.deepEqual(vaccines.map((e) => e.name), ['Brucelose']);
  assert.deepEqual(treatments.map((e) => e.name), ['Vermífugo']);

  db.close();
});

test('markApplied records the application once and refuses a repeat', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);
  scheduleEvent(db, animalId, { withdrawalDays: 30 });

  const eventId = db.prepare('SELECT id FROM health_events LIMIT 1').get().id;

  assert.equal(
    markApplied(db, [farmId], eventId, {
      appliedDate: '2026-07-02', applicatorUserId: null, batchNumber: 'L1', notes: null,
    }),
    true,
  );

  // A double submission must not restart the carência clock from a later date.
  assert.equal(
    markApplied(db, [farmId], eventId, {
      appliedDate: '2026-08-01', applicatorUserId: null, batchNumber: null, notes: null,
    }),
    false,
  );

  assert.equal(findEventInScope(db, [farmId], eventId).applied_date, '2026-07-02');

  db.close();
});

test('markApplied refuses an event outside the caller\'s scope', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  const foreignAnimal = insertAnimal(db, otherFarm);
  scheduleEvent(db, foreignAnimal);

  const eventId = db.prepare('SELECT id FROM health_events LIMIT 1').get().id;

  assert.equal(
    markApplied(db, [myFarm], eventId, {
      appliedDate: '2026-07-02', applicatorUserId: null, batchNumber: null, notes: null,
    }),
    false,
  );
  assert.equal(findEventInScope(db, [otherFarm], eventId).applied_date, null);

  db.close();
});

test('listAppliedWithWithdrawal returns only applied doses that carry a carência', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animalId = insertAnimal(db, farmId);

  scheduleEvent(db, animalId, { name: 'Com carência', scheduledDate: '2026-07-01', withdrawalDays: 30 });
  scheduleEvent(db, animalId, { name: 'Sem carência', scheduledDate: '2026-07-02', withdrawalDays: 0 });
  scheduleEvent(db, animalId, { name: 'Não aplicada', scheduledDate: '2026-07-03', withdrawalDays: 30 });

  db.prepare("UPDATE health_events SET applied_date = '2026-07-05' WHERE name IN ('Com carência','Sem carência')").run();

  const withWithdrawal = listAppliedWithWithdrawal(db, animalId);

  assert.deepEqual(withWithdrawal.map((e) => e.name), ['Com carência']);

  db.close();
});

test('listAnimalsUnderWithdrawal reports the binding release date per animal', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const blocked = insertAnimal(db, farmId, { ear_tag: 'BLOQUEADO' });
  const clear = insertAnimal(db, farmId, { ear_tag: 'LIVRE' });

  // Two overlapping products: the later release date must win.
  scheduleEvent(db, blocked, { name: 'Curto', scheduledDate: '2026-08-01', withdrawalDays: 10 });
  scheduleEvent(db, blocked, { name: 'Longo', scheduledDate: '2026-08-01', withdrawalDays: 45 });
  // An elapsed withdrawal must not block.
  scheduleEvent(db, clear, { name: 'Antigo', scheduledDate: '2026-01-01', withdrawalDays: 30 });

  db.prepare("UPDATE health_events SET applied_date = '2026-08-01' WHERE name IN ('Curto','Longo')").run();
  db.prepare("UPDATE health_events SET applied_date = '2026-01-01' WHERE name = 'Antigo'").run();

  const blockedAnimals = listAnimalsUnderWithdrawal(db, [farmId], TODAY);

  assert.equal(blockedAnimals.length, 1);
  assert.equal(blockedAnimals[0].earTag, 'BLOQUEADO');
  assert.equal(blockedAnimals[0].releaseDate, '2026-09-15', 'the longer carência binds');

  db.close();
});

// ---------------------------------------------------------------------------
// Movements - the atomic location update (DAT-04)
// ---------------------------------------------------------------------------

function insertLot(db, farmId, name) {
  return db
    .prepare(`INSERT INTO lots (farm_id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`)
    .run(farmId, name, NOW, NOW).lastInsertRowid;
}

function insertPasture(db, farmId, name) {
  return db
    .prepare(
      `INSERT INTO pastures (farm_id, name, area_ha, active, created_at, updated_at)
       VALUES (?, ?, 10, 1, ?, ?)`,
    )
    .run(farmId, name, NOW, NOW).lastInsertRowid;
}

test('a movement writes history and updates the current location together', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const fromLot = insertLot(db, farmId, 'Origem');
  const toLot = insertLot(db, farmId, 'Destino');
  const animalId = insertAnimal(db, farmId, { lot_id: fromLot });

  const animals = findMovableByIds(db, [farmId], [animalId]);
  recordMovements(db, animals, {
    movedAt: '2026-08-01',
    toLotId: toLot,
    toPastureId: null,
    destinationFarmId: null,
    reason: 'Rodízio',
    createdBy: null,
  });

  // The denormalised current location must match the history it summarises.
  const animal = db.prepare('SELECT lot_id FROM animals WHERE id = ?').get(animalId);
  assert.equal(animal.lot_id, toLot);

  const movement = db.prepare('SELECT from_lot_id, to_lot_id FROM movements WHERE animal_id = ?').get(animalId);
  assert.equal(movement.from_lot_id, fromLot);
  assert.equal(movement.to_lot_id, toLot);

  db.close();
});

test('a null destination leaves that dimension untouched', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lot = insertLot(db, farmId, 'Lote');
  const fromPasture = insertPasture(db, farmId, 'Origem');
  const toPasture = insertPasture(db, farmId, 'Destino');
  const animalId = insertAnimal(db, farmId, { lot_id: lot, pasture_id: fromPasture });

  // Moving between paddocks must not disturb the animal's lote.
  recordMovements(db, findMovableByIds(db, [farmId], [animalId]), {
    movedAt: '2026-08-01',
    toLotId: null,
    toPastureId: toPasture,
    destinationFarmId: null,
    reason: null,
    createdBy: null,
  });

  const animal = db.prepare('SELECT lot_id, pasture_id FROM animals WHERE id = ?').get(animalId);
  assert.equal(animal.lot_id, lot, 'the lote is unchanged');
  assert.equal(animal.pasture_id, toPasture);

  db.close();
});

test('a cross-farm movement changes the animal\'s farm', () => {
  const db = createTestDb();
  const origin = insertFarm(db, { name: 'Origem' });
  const destination = insertFarm(db, { name: 'Destino' });
  const toLot = insertLot(db, destination, 'Engorda');
  const animalId = insertAnimal(db, origin, { ear_tag: 'BV-0001' });

  recordMovements(db, findMovableByIds(db, [origin], [animalId]), {
    movedAt: '2026-08-01',
    toLotId: toLot,
    toPastureId: null,
    destinationFarmId: destination,
    reason: 'Transferência para terminação',
    createdBy: null,
  });

  const animal = db.prepare('SELECT farm_id FROM animals WHERE id = ?').get(animalId);
  assert.equal(animal.farm_id, destination);

  const movement = db.prepare('SELECT from_farm_id, to_farm_id FROM movements WHERE animal_id = ?').get(animalId);
  assert.equal(movement.from_farm_id, origin);
  assert.equal(movement.to_farm_id, destination);

  db.close();
});

test('a movement batch is atomic - a collision writes nothing', () => {
  const db = createTestDb();
  const origin = insertFarm(db, { name: 'Origem' });
  const destination = insertFarm(db, { name: 'Destino' });
  const toLot = insertLot(db, destination, 'Engorda');

  // The destination farm already has an animal with this tag, and the schema
  // enforces UNIQUE(farm_id, ear_tag).
  insertAnimal(db, destination, { ear_tag: 'DUP' });
  const safe = insertAnimal(db, origin, { ear_tag: 'OK' });
  const colliding = insertAnimal(db, origin, { ear_tag: 'DUP' });

  const animals = findMovableByIds(db, [origin], [safe, colliding]);

  assert.throws(() =>
    recordMovements(db, animals, {
      movedAt: '2026-08-01',
      toLotId: toLot,
      toPastureId: null,
      destinationFarmId: destination,
      reason: null,
      createdBy: null,
    }),
  );

  // The safe animal must have been rolled back with the failing one, so the
  // history and the current location cannot end up half-applied.
  const stillHome = db.prepare('SELECT farm_id FROM animals WHERE id = ?').get(safe);
  assert.equal(stillHome.farm_id, origin);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM movements').get().c, 0);

  db.close();
});

test('findMovableByIds refuses animals outside scope or no longer active', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  const mine = insertAnimal(db, myFarm, { ear_tag: 'MEU' });
  const sold = insertAnimal(db, myFarm, { ear_tag: 'VENDIDO', status: 'vendido' });
  const foreign = insertAnimal(db, otherFarm, { ear_tag: 'ALHEIO' });

  const movable = findMovableByIds(db, [myFarm], [mine, sold, foreign]);

  assert.deepEqual(movable.map((a) => a.ear_tag), ['MEU']);

  db.close();
});
