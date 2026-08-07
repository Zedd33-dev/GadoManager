/**
 * Session configuration.
 *
 * Sessions are stored in the same SQLite file as the rest of the data, which
 * keeps the deployment story to a single file and means sessions survive a
 * restart. The default in-memory store would leak and would log every user out
 * on every restart.
 */

import session from 'express-session';
import createSqliteStore from 'better-sqlite3-session-store';
import { getDb } from '../config/db.js';
import { env, isProduction } from '../config/env.js';

const SqliteStore = createSqliteStore(session);

/** Eight hours - long enough for a working day in the field, short enough to expire. */
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * Builds the session store with its expired-session sweep timer unref'd.
 *
 * `better-sqlite3-session-store` starts that sweep with a bare `setInterval`
 * and neither unrefs it nor keeps the handle, so the timer alone is enough to
 * keep a Node process alive forever - there is no way to ask the store to
 * stop it afterwards. In a running server that is invisible (the listening
 * socket holds the loop open anyway), but any process that merely builds the
 * app and finishes - a test run, a one-off script - hangs until something
 * kills it.
 *
 * `setInterval` is patched only for the duration of the synchronous
 * constructor call and restored in `finally`, so nothing else in the process
 * can observe the swap. Unref'ing is the right behaviour in production too: a
 * background janitor should never be the reason a process refuses to exit,
 * and the sweep still runs normally for as long as the server is up.
 */
function createStoreWithUnrefdSweep() {
  const realSetInterval = global.setInterval;

  global.setInterval = function unrefdSetInterval(...args) {
    const handle = realSetInterval(...args);
    if (typeof handle?.unref === 'function') handle.unref();
    return handle;
  };

  try {
    return new SqliteStore({
      client: getDb(),
      // Sweep expired sessions every 15 minutes so the table cannot grow without
      // bound. The store creates and manages its own table.
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    });
  } finally {
    global.setInterval = realSetInterval;
  }
}

export function createSessionMiddleware() {
  return session({
    store: createStoreWithUnrefdSweep(),

    secret: env.sessionSecret,

    // Do not rewrite a session that did not change.
    resave: false,

    // Do not persist a session until something is actually stored in it. This
    // avoids creating a database row for every anonymous visitor.
    saveUninitialized: false,

    // The default name advertises the framework in a cookie.
    name: 'gadomanager.sid',

    cookie: {
      httpOnly: true, // not readable from JavaScript, limiting XSS damage
      sameSite: 'lax', // blocks cross-site form posts while keeping normal navigation
      secure: isProduction, // HTTPS only in production
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}
