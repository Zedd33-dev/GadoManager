/**
 * User and farm-access queries.
 *
 * Every statement is prepared with bound parameters. No SQL string in this
 * project is ever built by concatenation, which is what makes SQL injection
 * impossible by construction rather than by review (issue SEC-01).
 */

/**
 * Finds an active user by email, for login.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @returns {object|undefined}
 */
export function findActiveByEmail(db, email) {
  return db
    .prepare(
      `SELECT id, name, email, password_hash, role, active
         FROM users
        WHERE email = ? AND active = 1`,
    )
    .get(email);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {object|undefined}
 */
export function findActiveById(db, id) {
  return db
    .prepare(
      `SELECT id, name, email, role, active
         FROM users
        WHERE id = ? AND active = 1`,
    )
    .get(id);
}

/**
 * Returns the ids of the farms a user is allowed to see.
 *
 * This is the root of the multi-tenant guarantee. The result is bound into every
 * subsequent query as parameters; a user with no rows here can address no farm
 * data at all (issue SEC-06).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @returns {number[]}
 */
export function findFarmIdsForUser(db, userId) {
  return db
    .prepare('SELECT farm_id FROM user_farms WHERE user_id = ? ORDER BY farm_id')
    .all(userId)
    .map((row) => row.farm_id);
}

/**
 * Creates a user. The caller is responsible for hashing the password.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {{name: string, email: string, passwordHash: string, role: string}} user
 * @returns {number} the new user id
 */
export function insertUser(db, { name, email, passwordHash, role }) {
  const now = new Date().toISOString();

  return Number(
    db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(name, email, passwordHash, role, now, now).lastInsertRowid,
  );
}

/**
 * Grants a user access to a farm. Idempotent.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {number} farmId
 */
export function grantFarmAccess(db, userId, farmId) {
  db.prepare(
    'INSERT OR IGNORE INTO user_farms (user_id, farm_id) VALUES (?, ?)',
  ).run(userId, farmId);
}
