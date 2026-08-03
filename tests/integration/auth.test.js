/**
 * Authentication tests.
 *
 * Covers password hashing and the login decision. The behaviours asserted here
 * are security properties, not conveniences: a stored hash must not resemble the
 * password, and a failed login must not reveal whether the account exists.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../helpers/testDb.js';
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../../src/lib/password.js';
import { insertUser, findActiveByEmail } from '../../src/repositories/userRepository.js';
import { authenticate } from '../../src/services/authService.js';

const PASSWORD = 'senha-de-teste-123';

async function seedUser(db, overrides = {}) {
  const passwordHash = await hashPassword(overrides.password ?? PASSWORD);

  return insertUser(db, {
    name: overrides.name ?? 'Ana Souza',
    email: overrides.email ?? 'ana@fazenda.com',
    passwordHash,
    role: overrides.role ?? 'gerente',
  });
}

test('a stored password is hashed with Argon2id, never stored in the clear', async () => {
  const db = createTestDb();
  await seedUser(db);

  const stored = findActiveByEmail(db, 'ana@fazenda.com').password_hash;

  assert.ok(stored.startsWith('$argon2id$'), 'hash must be Argon2id');
  assert.ok(!stored.includes(PASSWORD), 'the plaintext must not appear in the hash');

  db.close();
});

test('the same password hashes differently every time', async () => {
  // Argon2 salts each hash, so two users with the same password do not share a
  // stored value - which is what stops one cracked hash from revealing others.
  const first = await hashPassword(PASSWORD);
  const second = await hashPassword(PASSWORD);

  assert.notEqual(first, second);
  assert.ok(await verifyPassword(first, PASSWORD));
  assert.ok(await verifyPassword(second, PASSWORD));
});

test('verifyPassword rejects a wrong password and malformed stored values', async () => {
  const hash = await hashPassword(PASSWORD);

  assert.equal(await verifyPassword(hash, 'senha-errada'), false);
  assert.equal(await verifyPassword(hash, ''), false);

  // A corrupted or missing hash must deny access, not throw a 500 that would
  // itself confirm the account exists.
  assert.equal(await verifyPassword(null, PASSWORD), false);
  assert.equal(await verifyPassword('', PASSWORD), false);
  assert.equal(await verifyPassword('not-a-hash', PASSWORD), false);
});

test('hashPassword refuses a password below the minimum length', async () => {
  await assert.rejects(() => hashPassword('curta'), /no mínimo/);
  await assert.rejects(() => hashPassword(''), /no mínimo/);
  await assert.doesNotReject(() => hashPassword('x'.repeat(MIN_PASSWORD_LENGTH)));
});

test('authenticate accepts correct credentials', async () => {
  const db = createTestDb();
  await seedUser(db);

  const result = await authenticate(db, 'ana@fazenda.com', PASSWORD);

  assert.equal(result.ok, true);
  assert.equal(result.user.email, 'ana@fazenda.com');
  assert.equal(result.user.role, 'gerente');
  assert.equal(result.user.password_hash, undefined, 'the hash must not escape the service');

  db.close();
});

test('authenticate is case-insensitive and trims the email', async () => {
  const db = createTestDb();
  await seedUser(db);

  assert.equal((await authenticate(db, '  ANA@Fazenda.com  ', PASSWORD)).ok, true);

  db.close();
});

test('authenticate rejects a wrong password', async () => {
  const db = createTestDb();
  await seedUser(db);

  assert.equal((await authenticate(db, 'ana@fazenda.com', 'senha-errada')).ok, false);

  db.close();
});

test('authenticate reports the same failure for unknown and wrong', async () => {
  const db = createTestDb();
  await seedUser(db);

  const unknownAccount = await authenticate(db, 'ninguem@fazenda.com', PASSWORD);
  const wrongPassword = await authenticate(db, 'ana@fazenda.com', 'senha-errada');

  // Identical shapes: the caller cannot tell which failed, so the login form
  // cannot be used to enumerate registered addresses.
  assert.deepEqual(unknownAccount, wrongPassword);
  assert.deepEqual(unknownAccount, { ok: false });

  db.close();
});

test('authenticate rejects a deactivated account', async () => {
  const db = createTestDb();
  const userId = await seedUser(db);

  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(userId);

  assert.equal((await authenticate(db, 'ana@fazenda.com', PASSWORD)).ok, false);

  db.close();
});

test('authenticate handles missing and non-string input without throwing', async () => {
  const db = createTestDb();
  await seedUser(db);

  for (const [email, password] of [
    ['', ''],
    [null, null],
    [undefined, undefined],
    ['ana@fazenda.com', null],
    [{}, []],
  ]) {
    const result = await authenticate(db, email, password);
    assert.equal(result.ok, false);
  }

  db.close();
});

test("a SQL payload in the email field is treated as a value", async () => {
  const db = createTestDb();
  await seedUser(db);

  const result = await authenticate(db, "' OR '1'='1", 'qualquer-senha');
  assert.equal(result.ok, false);

  // The users table is intact.
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, 1);

  db.close();
});
