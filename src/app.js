/**
 * Express application.
 *
 * Builds and returns the app without starting a server, so tests can mount it
 * directly. Starting the listener is `src/server.js`'s job.
 *
 * Middleware order matters and is documented in `docs/architecture.md`.
 */

import path from 'node:path';
import express from 'express';
import { ROOT_DIR, isProduction } from './config/env.js';
import { notFoundHandler, errorHandler } from './middleware/errors.js';
import * as format from './lib/format.js';
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

  // Form submissions. `extended: false` keeps parsing to plain key/value pairs,
  // which is all this application posts.
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  // Static assets, including the locally vendored Chart.js. Nothing is loaded
  // from a CDN: the application has to work on a weak rural connection.
  app.use(
    '/static',
    express.static(path.join(ROOT_DIR, 'public'), {
      maxAge: isProduction ? '7d' : 0,
    }),
  );

  // The pt-BR formatting helpers are exposed to every template so that views
  // never build their own date or currency strings.
  app.use((req, res, next) => {
    res.locals.fmt = format;
    res.locals.currentPath = req.path;
    next();
  });

  // Routes
  app.use('/', homeRoutes);

  // Error handling, always last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
