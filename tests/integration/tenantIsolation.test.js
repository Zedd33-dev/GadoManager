/**
 * Multi-tenant isolation.
 *
 * The requirement: one account must never read another account's data. These
 * tests are the proof of it.
 *
 * The scenario is the same throughout - two farms, two owners, one animal each,
 * plus a manager who legitimately sees both. Every read path is then checked
 * against every scope.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal } from '../helpers/testDb.js';
import {
  insertUser,
  grantFarmAccess,
  findFarmIdsForUser,
} from '../../src/repositories/userRepository.js';
import {
  countInScope,
  listInScope,
  findInScope,
} from '../../src/repositories/animalRepository.js';
import { inClause } from '../../src/middleware/tenant.js';

/**
 * Builds two farms with one owner each and a manager over both.
 */
function buildTwoTenants() {
  const db = createTestDb();

  const farmA = insertFarm(db, { name: 'Fazenda Boa Vista' });
  const farmB = insertFarm(db, { name: 'Fazenda Santa Clara' });

  const animalA = insertAnimal(db, farmA, { ear_tag: 'A-001' });
  const animalB = insertAnimal(db, farmB, { ear_tag: 'B-001' });

  const makeUser = (name, email, role) =>
    insertUser(db, { name, email, passwordHash: 'not-used-here', role });

  const ownerA = makeUser('Dona da A', 'a@fazenda.com', 'gerente');
  const ownerB = makeUser('Dono da B', 'b@fazenda.com', 'gerente');
  const bothFarms = makeUser('Gerente Geral', 'geral@fazenda.com', 'gerente');
  const orphan = makeUser('Sem Fazenda', 'orfao@fazenda.com', 'peao');

  grantFarmAccess(db, ownerA, farmA);
  grantFarmAccess(db, ownerB, farmB);
  grantFarmAccess(db, bothFarms, farmA);
  grantFarmAccess(db, bothFarms, farmB);
  // `orphan` is deliberately granted nothing.

  return { db, farmA, farmB, animalA, animalB, ownerA, ownerB, bothFarms, orphan };
}

test('a user resolves only the farms they were granted', () => {
  const { db, farmA, farmB, ownerA, ownerB, bothFarms, orphan } = buildTwoTenants();

  assert.deepEqual(findFarmIdsForUser(db, ownerA), [farmA]);
  assert.deepEqual(findFarmIdsForUser(db, ownerB), [farmB]);
  assert.deepEqual(findFarmIdsForUser(db, bothFarms).sort(), [farmA, farmB].sort());
  assert.deepEqual(findFarmIdsForUser(db, orphan), []);

  db.close();
});

test('counting animals never crosses a tenant boundary', () => {
  const { db, ownerA, ownerB, bothFarms } = buildTwoTenants();

  assert.equal(countInScope(db, findFarmIdsForUser(db, ownerA)), 1);
  assert.equal(countInScope(db, findFarmIdsForUser(db, ownerB)), 1);
  assert.equal(countInScope(db, findFarmIdsForUser(db, bothFarms)), 2);

  db.close();
});

test('listing animals returns only the caller\'s herd', () => {
  const { db, ownerA, ownerB } = buildTwoTenants();

  const tagsForA = listInScope(db, findFarmIdsForUser(db, ownerA)).map((a) => a.ear_tag);
  const tagsForB = listInScope(db, findFarmIdsForUser(db, ownerB)).map((a) => a.ear_tag);

  assert.deepEqual(tagsForA, ['A-001']);
  assert.deepEqual(tagsForB, ['B-001']);

  db.close();
});

test('fetching another tenant\'s animal by id returns nothing', () => {
  const { db, animalA, animalB, ownerA, ownerB } = buildTwoTenants();

  const scopeA = findFarmIdsForUser(db, ownerA);
  const scopeB = findFarmIdsForUser(db, ownerB);

  // Each owner can read their own animal.
  assert.ok(findInScope(db, scopeA, animalA));
  assert.ok(findInScope(db, scopeB, animalB));

  // Knowing the id of the other tenant's animal is not enough to read it. The
  // scope is part of the WHERE clause, so the row simply does not match - an
  // out-of-scope id is indistinguishable from one that does not exist, and
  // cannot be used to probe whether another farm's animal is there.
  assert.equal(findInScope(db, scopeA, animalB), undefined);
  assert.equal(findInScope(db, scopeB, animalA), undefined);

  db.close();
});

test('a user with no farms can read nothing at all', () => {
  const { db, animalA, animalB, orphan } = buildTwoTenants();

  const scope = findFarmIdsForUser(db, orphan);
  assert.deepEqual(scope, []);

  // An empty scope must match no rows rather than degrade into "no filter".
  assert.equal(countInScope(db, scope), 0);
  assert.deepEqual(listInScope(db, scope), []);
  assert.equal(findInScope(db, scope, animalA), undefined);
  assert.equal(findInScope(db, scope, animalB), undefined);

  db.close();
});

test('an empty scope compiles to a clause that matches nothing', () => {
  // This is the degenerate case that would be dangerous if it were wrong: an
  // empty IN list must never be rendered as an absent filter.
  const empty = inClause([]);
  assert.equal(empty.placeholders, 'NULL');
  assert.deepEqual(empty.params, []);

  const populated = inClause([4, 7, 9]);
  assert.equal(populated.placeholders, '?, ?, ?');
  assert.deepEqual(populated.params, [4, 7, 9]);
});

test('scope placeholders are generated from length, never from content', () => {
  // The placeholder string is built from the array's length; the values are
  // always bound. Even a hostile value cannot become SQL syntax.
  const hostile = inClause(["1); DROP TABLE animals; --"]);
  assert.equal(hostile.placeholders, '?');
  assert.deepEqual(hostile.params, ["1); DROP TABLE animals; --"]);
});

test('a hostile farm id is bound as a value and matches nothing', () => {
  const { db } = buildTwoTenants();

  // Passed through the same path a real scope takes. If any part of the query
  // were built by concatenation this would not simply return zero.
  assert.equal(countInScope(db, ["1 OR 1=1"]), 0);
  assert.deepEqual(listInScope(db, ["1); DROP TABLE animals; --"]), []);

  // The table is still there.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM animals').get().c, 2);

  db.close();
});
