/**
 * CSRF protection - synchronizer token pattern.
 *
 * Implemented directly rather than pulled from a package. It is about forty
 * lines, the mechanism has to be explained in the thesis anyway, and the widely
 * used Express package for this (`csurf`) has been deprecated.
 *
 * How it works:
 *   1. A random token is generated once per session and stored server-side.
 *   2. Every form embeds it in a hidden field.
 *   3. Any state-changing request must present a token matching the session's.
 *
 * An attacker's page can make a browser send a request to this application, but
 * it cannot read the victim's session to learn the token, so the forged request
 * fails step 3. `sameSite: 'lax'` on the session cookie is a second, independent
 * layer (issue SEC-03).
 */

import crypto from 'node:crypto';
import { HttpError } from './errors.js';

/** Methods that cannot change server state and therefore need no token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const TOKEN_BYTES = 32;

/**
 * Compares two tokens without leaking their contents through timing.
 *
 * A plain `===` on strings returns as soon as it finds a differing character,
 * so the time it takes reveals how much of a guess was correct.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on length mismatch, which would itself be a timing
  // signal; comparing lengths first is fine because the length is not secret.
  if (bufferA.length !== bufferB.length) return false;

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Ensures the session has a token and exposes it to templates as `csrfToken`.
 *
 * Every form in the application includes it via the `csrfField` partial.
 */
export function csrfToken(req, res, next) {
  if (!req.session) return next(new Error('Session middleware must run before CSRF.'));

  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  }

  res.locals.csrfToken = req.session.csrfToken;
  next();
}

/**
 * Rejects state-changing requests that do not carry a valid token.
 */
export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const expected = req.session?.csrfToken;
  const submitted = req.body?._csrf ?? req.get('x-csrf-token');

  if (!expected || !timingSafeEqual(expected, submitted ?? '')) {
    return next(new HttpError(403, 'Sessão expirada ou requisição inválida. Recarregue a página e tente novamente.'));
  }

  return next();
}

/**
 * Issues a fresh token. Called after login, since the session id is regenerated
 * there and the old token must not carry over.
 *
 * @param {import('express').Request} req
 */
export function rotateCsrfToken(req) {
  req.session.csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}
