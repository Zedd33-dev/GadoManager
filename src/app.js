/**
 * Express application.
 *
 * Builds and returns the app without starting a server, so tests can mount it
 * directly. Starting the listener is `src/server.js`'s job.
 *
 * Middleware order is deliberate and is the request lifecycle documented in
 * `docs/architecture.md`:
 *
 *   security headers -> body parsing -> static assets -> session -> load user
 *   -> CSRF token -> CSRF verification -> tenant scope -> routes -> errors
 *
 * Each stage depends on the one before it: CSRF verification needs both a
 * parsed body and a session, and the tenant scope needs a loaded user.
 */

import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { ROOT_DIR, isProduction } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import { createSessionMiddleware } from './middleware/session.js';
import { csrfToken, verifyCsrf } from './middleware/csrf.js';
import { loadUser, requireLogin } from './middleware/auth.js';
import { resolveTenantScope, requireFarmAccess } from './middleware/tenant.js';
import * as format from './lib/format.js';
import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import homeRoutes from './routes/home.js';

export function createApp() {
  const app = express();

  // Views
  app.set('view engine', 'ejs');
  app.set('views', path.join(ROOT_DIR, 'src', 'views'));

  // Trust the reverse proxy in production so secure cookies and req.ip work.
  if (isProduction) app.set('trust proxy', 1);

  // Do not advertise the framework.
  app.disable('x-powered-by');

  // Security headers. The content security policy is restricted to same-origin
  // assets, which the application can satisfy because nothing is loaded from a
  // CDN - including Chart.js, which is vendored into public/.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      // Only meaningful over HTTPS, and would be counterproductive locally.
      hsts: isProduction,
    }),
  );

  // Form submissions. `extended: false` keeps parsing to plain key/value pairs,
  // which is all this application posts. The size limit bounds what an
  // unauthenticated caller can make the server parse.
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Static assets. Mounted before the session so that serving a stylesheet does
  // not touch the session store.
  app.use(
    '/static',
    express.static(path.join(ROOT_DIR, 'public'), {
      maxAge: isProduction ? '7d' : 0,
    }),
  );

  // Chart.js, served from the installed npm package rather than a CDN or a
  // hand-copied file in public/. It is a real, versioned dependency
  // (package.json / package-lock.json), so there is no second copy of the
  // library to keep in sync - and the CSP's `script-src 'self'` is satisfied
  // because the file is same-origin either way.
  app.use(
    '/static/vendor/chartjs',
    express.static(path.join(ROOT_DIR, 'node_modules', 'chart.js', 'dist'), {
      maxAge: isProduction ? '7d' : 0,
    }),
  );

  // Session, then the user it identifies.
  app.use(createSessionMiddleware());
  app.use(loadUser);

  // CSRF: issue a token for every session, then verify it on anything that
  // changes state. Registered globally so a new route cannot forget it.
  app.use(csrfToken);
  app.use(verifyCsrf);

  // Which farms the caller may address. Populates req.scope.
  app.use(resolveTenantScope);

  // The pt-BR formatting helpers are exposed to every template so that views
  // never build their own date or currency strings.
  app.use((req, res, next) => {
    res.locals.fmt = format;
    res.locals.currentPath = req.path;
    next();
  });

  // Public routes.
  app.use('/', healthRoutes);
  app.use('/', authRoutes);

  // Everything past this point requires a session.
  app.use(requireLogin);
  app.use(requireFarmAccess);
  app.use('/', homeRoutes);

  // Error handling, always last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
