/**
 * Authentication and authorization middleware.
 *
 * `requireLogin` establishes who the caller is; `requireCapability` decides what
 * they may do. Both run on the server before any handler executes, which is the
 * distinction that matters: hiding a button in a template is presentation, not
 * access control (issue SEC-05).
 */

import { getDb } from '../config/db.js';
import { findActiveById } from '../repositories/userRepository.js';
import { can, capabilitiesFor, ROLE_LABELS } from '../domain/permissions.js';
import { HttpError } from './errors.js';

/**
 * Loads the session user onto `req.user`, if there is one.
 *
 * The user is re-read from the database on every request rather than trusted
 * from the session, so that deactivating an account or changing a role takes
 * effect immediately instead of at the user's next login.
 */
export function loadUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();

  const user = findActiveById(getDb(), userId);

  if (!user) {
    // The account was deleted or deactivated while the session was alive.
    req.session.destroy(() => next());
    return;
  }

  req.user = user;
  res.locals.currentUser = user;
  res.locals.roleLabel = ROLE_LABELS[user.role] ?? user.role;
  res.locals.userCan = (capability) => can(user.role, capability);
  res.locals.capabilities = capabilitiesFor(user.role);

  next();
}

/**
 * Blocks anonymous callers.
 *
 * A browser navigation is redirected to the login form with a `next` parameter
 * so the user returns to where they were going. The parameter is validated on
 * the way back out (see `routes/auth.js`) to prevent an open redirect.
 */
export function requireLogin(req, res, next) {
  if (req.user) return next();

  if (req.method === 'GET' && req.accepts('html')) {
    const target = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${target}`);
  }

  return next(new HttpError(401, 'É necessário entrar para continuar.'));
}

/**
 * Blocks callers whose role does not hold the given capability.
 *
 * Fails closed: an unrecognised capability name denies everyone rather than
 * allowing everyone.
 *
 * @param {string} capability a key from `domain/permissions.js`
 */
export function requireCapability(capability) {
  return function capabilityGuard(req, res, next) {
    if (!req.user) return next(new HttpError(401, 'É necessário entrar para continuar.'));

    if (!can(req.user.role, capability)) {
      return next(new HttpError(403, 'Você não tem permissão para executar esta ação.'));
    }

    return next();
  };
}
