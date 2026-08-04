/**
 * Global multipart body parsing.
 *
 * Registered once in `app.js`, right alongside `express.urlencoded()`, rather
 * than attached per-route. The reason is CSRF, not convenience: `verifyCsrf`
 * (middleware/csrf.js) is deliberately global - "registered globally so a new
 * route cannot forget it" - and it reads `req.body._csrf`. `express.urlencoded`
 * only parses `application/x-www-form-urlencoded` bodies; a multipart form
 * (required for a file input) would reach `verifyCsrf` with an empty `req.body`
 * if multer only ran inside the specific route handler, since route-level
 * middleware runs after the global stack. Parsing multipart bodies here, at
 * the same point urlencoded bodies are parsed, keeps `req.body._csrf`
 * populated regardless of which encoding a form used - so CSRF protection
 * stays genuinely impossible to forget for a multipart form too.
 *
 * A no-op for any request that is not multipart, so the great majority of
 * requests - JSON APIs this project does not have, urlencoded forms, GETs -
 * pass straight through.
 */

import { photoUpload } from '../lib/upload.js';
import { HttpError } from './errors.js';

export function parseMultipartBody(req, res, next) {
  if (!req.is('multipart/form-data')) return next();

  photoUpload(req, res, (error) => {
    if (error) return next(new HttpError(400, error.message));
    return next();
  });
}
