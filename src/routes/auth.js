/**
 * Login and logout.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { authenticate } from '../services/authService.js';
import { validateRegistrationInput } from '../services/userAdminService.js';
import { rotateCsrfToken } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';
import { hashPassword } from '../lib/password.js';
import { findByEmail, insertUser } from '../repositories/userRepository.js';
import { ROLES } from '../domain/permissions.js';

const router = Router();

/**
 * Validates a post-login redirect target.
 *
 * Only same-site absolute paths are allowed. Without this check an attacker
 * could send a victim to /login?next=https://exemplo-falso.com and have the
 * application itself perform the redirect after a successful login, lending
 * credibility to a phishing page. Rejecting '//' also blocks protocol-relative
 * URLs, which browsers treat as absolute.
 *
 * @param {unknown} target
 * @returns {string} a safe path
 */
function safeRedirect(target) {
  if (typeof target !== 'string') return '/';
  if (!target.startsWith('/')) return '/';
  if (target.startsWith('//')) return '/';
  return target;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');

  res.render('auth/login', {
    title: 'Entrar',
    error: null,
    email: '',
    next: safeRedirect(req.query.next),
  });
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const redirectTo = safeRedirect(req.body.next);

    const result = await authenticate(getDb(), email, password);

    if (!result.ok) {
      // One message for both "no such account" and "wrong password", so the
      // form cannot be used to discover which addresses are registered.
      return res.status(401).render('auth/login', {
        title: 'Entrar',
        error: 'E-mail ou senha inválidos.',
        email: typeof email === 'string' ? email : '',
        next: redirectTo,
      });
    }

    // Regenerate the session id on privilege change. Without this, an attacker
    // who fixed a known session id in the victim's browser before login would
    // still hold a valid id afterwards (session fixation).
    return req.session.regenerate((error) => {
      if (error) return next(error);

      req.session.userId = result.user.id;
      rotateCsrfToken(req);
      // Set after regenerate() (a fresh session) and before save(), so it is
      // persisted in the same write and survives to the next request. This is
      // the demonstration of the flash mechanism Phase 8's create/update/
      // delete actions will reuse - logout cannot use it the same way, since
      // session.destroy() removes the session the message would live in.
      setFlash(req, 'success', `Bem-vindo(a), ${result.user.name}.`);

      return req.session.save((saveError) => {
        if (saveError) return next(saveError);
        return res.redirect(redirectTo);
      });
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/registrar', (req, res) => {
  if (req.user) return res.redirect('/');

  res.render('auth/register', {
    title: 'Criar conta',
    errors: {},
    values: {},
  });
});

router.post('/registrar', async (req, res, next) => {
  try {
    const db = getDb();
    const normalizedEmail = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const emailTaken = normalizedEmail !== '' && Boolean(findByEmail(db, normalizedEmail));

    const result = validateRegistrationInput(req.body, { emailTaken });

    if (!result.ok) {
      return res.status(400).render('auth/register', {
        title: 'Criar conta',
        errors: result.errors,
        values: { name: req.body.name, email: req.body.email },
      });
    }

    const passwordHash = await hashPassword(result.data.password);

    // New accounts start as `peao` with no farm access - harmless until an
    // administrator assigns a role and one or more farms from /usuarios
    // (issue SEC-06: a user with no rows in user_farms can address no farm
    // data at all, regardless of role). Nobody can grant themselves admin or
    // farm access simply by registering.
    insertUser(db, {
      name: result.data.name,
      email: result.data.email,
      passwordHash,
      role: ROLES.FIELD_HAND,
    });

    setFlash(
      req,
      'success',
      'Conta criada. Peça a um administrador para liberar o acesso a uma fazenda.',
    );
    return res.redirect('/login');
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('gadomanager.sid');
    return res.redirect('/login');
  });
});

export default router;
