/**
 * Centralized error handling.
 *
 * Two middlewares, registered last in the chain: one that turns an unmatched
 * route into a 404, and one that renders any error raised anywhere upstream.
 */

import { isProduction } from '../config/env.js';

/**
 * An error carrying an HTTP status code.
 *
 * Route handlers throw these instead of writing responses directly, which keeps
 * the rendering decision in one place.
 */
export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message user-facing message, written in pt-BR
   */
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/** Converts any unmatched request into a 404. */
export function notFoundHandler(req, res, next) {
  next(new HttpError(404, 'Página não encontrada.'));
}

/**
 * Renders an error response.
 *
 * Express identifies an error handler by its arity, so `next` must stay in the
 * signature even though it is unused.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  const status = Number.isInteger(error.status) ? error.status : 500;

  if (status >= 500) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, error);
  }

  // Never leak internal error text to the browser in production; unexpected
  // messages can disclose file paths or query fragments.
  const message =
    status >= 500 && isProduction
      ? 'Ocorreu um erro inesperado. Tente novamente.'
      : error.message;

  res.status(status);
  res.render('errors/error', {
    title: status === 404 ? 'Página não encontrada' : 'Erro',
    status,
    message,
    stack: isProduction ? null : error.stack,
  });
}
