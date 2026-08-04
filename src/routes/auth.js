/**
 * Login and logout.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { authenticate } from '../services/authService.js';
import { rotateCsrfToken } from '../middleware/csrf.js';
import { setFlash } from '../middleware/flash.js';

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

router.post('/logout', (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie('gadomanager.sid');
    return res.redirect('/login');
  });
});

export default router;
