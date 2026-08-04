/**
 * Express application.
 *
 * Builds and returns the app without starting a server, so tests can mount it
 * directly. Starting the listener is `src/server.js`'s job.
 *
 * Middleware order is deliberate and is the request lifecycle documented in
 * `docs/architecture.md`:
 *
 *   security headers -> body parsing (urlencoded + multipart) -> static assets
 *   -> session -> load user -> flash -> CSRF token -> CSRF verification
 *   -> tenant scope -> routes -> errors
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
import { flashMiddleware } from './middleware/flash.js';
import { parseMultipartBody } from './middleware/upload.js';
import { resolveTenantScope, requireFarmAccess } from './middleware/tenant.js';
import * as format from './lib/format.js';
import authRoutes from './routes/auth.js';
// The liveness probe, distinct from the sanitary module in routes/health.js.
import healthcheckRoutes from './routes/healthcheck.js';
import homeRoutes from './routes/home.js';
import animalRoutes from './routes/animals.js';
import weighingRoutes from './routes/weighings.js';
import structureRoutes from './routes/structure.js';
import healthRoutes from './routes/health.js';
import movementRoutes from './routes/movements.js';

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
  // CDN - including Chart.js, served same-origin from its own npm package
  // (see the /static/vendor/chartjs route below).
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

  // Multipart bodies (a form with a file input), parsed at the same point as
  // urlencoded bodies above and for the same reason: verifyCsrf below reads
  // req.body._csrf, and it must be populated no matter which encoding a form
  // used.
  app.use(parseMultipartBody);

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
  app.use(flashMiddleware);

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
  app.use('/', healthcheckRoutes);
  app.use('/', authRoutes);

  // Everything past this point requires a session.
  app.use(requireLogin);
  app.use(requireFarmAccess);
  app.use('/', homeRoutes);
  app.use('/', animalRoutes);
  app.use('/', weighingRoutes);
  app.use('/', structureRoutes);
  app.use('/', healthRoutes);
  app.use('/', movementRoutes);

  // Error handling, always last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
