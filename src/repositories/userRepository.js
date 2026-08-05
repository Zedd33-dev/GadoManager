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

/**
 * Revokes a user's access to a farm. Idempotent.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} userId
 * @param {number} farmId
 */
export function revokeFarmAccess(db, userId, farmId) {
  db.prepare('DELETE FROM user_farms WHERE user_id = ? AND farm_id = ?').run(userId, farmId);
}

/**
 * Finds a user by email regardless of `active`, for the registration form's
 * uniqueness check. `findActiveByEmail` cannot be reused here: a deactivated
 * account's email must still be rejected as taken, not silently reusable.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @returns {object|undefined}
 */
export function findByEmail(db, email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email);
}

/**
 * One user by id, regardless of `active` - an admin must be able to see and
 * reactivate a deactivated account, which `findActiveById` would hide.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @returns {object|undefined}
 */
export function findById(db, id) {
  return db
    .prepare('SELECT id, name, email, role, active, created_at FROM users WHERE id = ?')
    .get(id);
}

/**
 * Every account in the system, for the admin Usuários screen. Deliberately
 * unscoped by farm - user management is a system-level capability
 * (`users:manage`, admin-only), not farm-owned data.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function listAllUsers(db) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
              COUNT(uf.farm_id) AS farm_count
         FROM users u
         LEFT JOIN user_farms uf ON uf.user_id = u.id
        GROUP BY u.id
        ORDER BY u.name`,
    )
    .all();
}

/**
 * Changes a user's role. Returns false if the id does not exist, so the
 * caller can 404 instead of silently no-op-ing.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {string} role
 * @returns {boolean}
 */
export function updateUserRole(db, id, role) {
  const result = db
    .prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?')
    .run(role, new Date().toISOString(), id);
  return result.changes > 0;
}

/**
 * Activates or deactivates a user. A deactivated account is rejected at
 * login (`findActiveByEmail` filters on `active = 1`) and, if already
 * logged in, loses its session on the very next request - `loadUser`
 * re-reads the account from the database every time and destroys the
 * session if it is no longer active.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} id
 * @param {boolean} active
 * @returns {boolean}
 */
export function setUserActive(db, id, active) {
  const result = db
    .prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?')
    .run(active ? 1 : 0, new Date().toISOString(), id);
  return result.changes > 0;
}
