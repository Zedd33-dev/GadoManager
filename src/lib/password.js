/**
 * Password hashing.
 *
 * Argon2id is the current recommendation for password storage: it is memory-hard,
 * which makes GPU and ASIC attacks far more expensive than they are against
 * bcrypt. The `@node-rs/argon2` binding ships prebuilt binaries, so installing
 * this project never requires a C compiler.
 *
 * Parameters are the library defaults, which follow the OWASP guidance
 * (m = 19456 KiB, t = 2, p = 1). They are stated explicitly rather than left
 * implicit so that the cost is visible and can be raised deliberately later.
 */

import { hash, verify, Algorithm } from '@node-rs/argon2';

const HASH_OPTIONS = Object.freeze({
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

/** Minimum password length accepted when setting a password. */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Hashes a plaintext password.
 *
 * The returned string is self-describing - it embeds the algorithm, version,
 * parameters and salt - so verification needs nothing else stored alongside it.
 *
 * @param {string} plainPassword
 * @returns {Promise<string>} the encoded Argon2id hash
 */
export async function hashPassword(plainPassword) {
  if (typeof plainPassword !== 'string' || plainPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  return hash(plainPassword, HASH_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored hash.
 *
 * Returns false rather than throwing when the stored value is missing or
 * malformed, so a corrupted row denies access instead of producing a 500 that
 * would tell an attacker the account exists.
 *
 * @param {string|null|undefined} storedHash
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(storedHash, plainPassword) {
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  if (typeof plainPassword !== 'string' || plainPassword.length === 0) return false;

  try {
    return await verify(storedHash, plainPassword);
  } catch {
    return false;
  }
}
