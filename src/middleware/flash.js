/**
 * One-time flash messages ("toasts").
 *
 * A route sets a message before redirecting; the next request's render
 * consumes it and clears it, so a browser refresh never repeats it. Backed by
 * the session, so it only works across a redirect that keeps the session
 * alive - `session.regenerate()` (login) carries it forward, but
 * `session.destroy()` (logout) does not, since there is no session left to
 * read it from on the following request. Actions that end a session need a
 * different mechanism; none in this application currently do.
 */

/** Populates `res.locals.flash` and clears it so it survives exactly one render. */
export function flashMiddleware(req, res, next) {
  res.locals.flash = req.session?.flash ?? null;
  if (req.session) delete req.session.flash;
  next();
}

/**
 * Queues a message to show on the next page the current session renders.
 *
 * @param {import('express').Request} req
 * @param {'success'|'warning'|'danger'|'info'} type
 * @param {string} message pt-BR, user-facing
 */
export function setFlash(req, type, message) {
  if (!req.session) return;
  req.session.flash = { type, message };
}
