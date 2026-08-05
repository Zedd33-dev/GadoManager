import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm } from '../helpers/testDb.js';
import {
  insertUser,
  findByEmail,
  findById,
  listAllUsers,
  findFarmIdsForUser,
  grantFarmAccess,
  revokeFarmAccess,
  updateUserRole,
  setUserActive,
} from '../../src/repositories/userRepository.js';
import { listAll as listAllFarms } from '../../src/repositories/farmRepository.js';

function seedUser(db, overrides = {}) {
  return insertUser(db, {
    name: 'Maria Silva',
    email: 'maria@fazenda.com',
    passwordHash: '$argon2id$fake-hash-for-tests',
    role: 'peao',
    ...overrides,
  });
}

test('findByEmail finds an account regardless of active status', () => {
  const db = createTestDb();
  const userId = seedUser(db);

  assert.equal(findByEmail(db, 'maria@fazenda.com').id, userId);

  setUserActive(db, userId, false);
  assert.equal(findByEmail(db, 'maria@fazenda.com').id, userId, 'a deactivated email is still taken');

  assert.equal(findByEmail(db, 'ninguem@fazenda.com'), undefined);

  db.close();
});

test('a newly registered user starts with zero farms - harmless until an admin grants access', () => {
  const db = createTestDb();
  const userId = seedUser(db);

  assert.deepEqual(findFarmIdsForUser(db, userId), []);

  db.close();
});

test('listAllUsers reports every account with its farm count, unscoped by farm', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const userId = seedUser(db);
  grantFarmAccess(db, userId, farmId);

  const users = listAllUsers(db);
  const row = users.find((u) => u.id === userId);

  assert.equal(row.farm_count, 1);
  assert.equal(row.email, 'maria@fazenda.com');

  db.close();
});

test('updateUserRole changes the role and reports whether a row existed', () => {
  const db = createTestDb();
  const userId = seedUser(db);

  assert.equal(updateUserRole(db, userId, 'gerente'), true);
  assert.equal(findById(db, userId).role, 'gerente');

  assert.equal(updateUserRole(db, 999999, 'admin'), false);

  db.close();
});

test('setUserActive toggles the account and findById sees deactivated accounts', () => {
  const db = createTestDb();
  const userId = seedUser(db);

  assert.equal(setUserActive(db, userId, false), true);
  assert.equal(findById(db, userId).active, 0);

  assert.equal(setUserActive(db, userId, true), true);
  assert.equal(findById(db, userId).active, 1);

  db.close();
});

test('grantFarmAccess is idempotent and revokeFarmAccess removes exactly one grant', () => {
  const db = createTestDb();
  const farmA = insertFarm(db, { name: 'Fazenda A' });
  const farmB = insertFarm(db, { name: 'Fazenda B' });
  const userId = seedUser(db);

  grantFarmAccess(db, userId, farmA);
  grantFarmAccess(db, userId, farmA);
  grantFarmAccess(db, userId, farmB);
  assert.deepEqual(findFarmIdsForUser(db, userId).sort(), [farmA, farmB].sort());

  revokeFarmAccess(db, userId, farmA);
  assert.deepEqual(findFarmIdsForUser(db, userId), [farmB]);

  db.close();
});

test('farmRepository.listAll returns every farm regardless of who is asking', () => {
  const db = createTestDb();
  insertFarm(db, { name: 'Fazenda A' });
  insertFarm(db, { name: 'Fazenda B' });

  assert.equal(listAllFarms(db).length, 2);

  db.close();
});
