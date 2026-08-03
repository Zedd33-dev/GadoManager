/**
 * Authentication rules.
 *
 * Holds the decision "may this person log in", separate from how the request
 * arrived and separate from how users are stored.
 */

import { findActiveByEmail } from '../repositories/userRepository.js';
import { verifyPassword, hashPassword } from '../lib/password.js';

/**
 * A hash of a throwaway password, computed once at module load.
 *
 * When the email does not exist there is nothing to verify against, and
 * returning immediately would make a failed lookup measurably faster than a
 * wrong password - which lets an attacker enumerate valid accounts by timing
 * alone. Verifying against this decoy keeps both paths comparably expensive.
 */
const DECOY_HASH_PROMISE = hashPassword('decoy-password-for-constant-time-login');

/**
 * Attempts to authenticate a set of credentials.
 *
 * The failure reason is deliberately not distinguished between "no such email"
 * and "wrong password": the caller renders one message for both, so the login
 * form cannot be used to discover which addresses have accounts.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: true, user: object} | {ok: false}>}
 */
export async function authenticate(db, email, password) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const user = normalizedEmail ? findActiveByEmail(db, normalizedEmail) : undefined;

  if (!user) {
    await verifyPassword(await DECOY_HASH_PROMISE, String(password ?? ''));
    return { ok: false };
  }

  const passwordMatches = await verifyPassword(user.password_hash, String(password ?? ''));
  if (!passwordMatches) return { ok: false };

  return {
    ok: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}
