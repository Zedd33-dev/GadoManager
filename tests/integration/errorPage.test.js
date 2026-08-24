/**
 * The error page, rendered both logged in and out.
 *
 * `errors/error.ejs` is the one template reachable from an anonymous
 * request - every other view lives behind `requireLogin`. It references
 * `currentUser` to decide whether to show a logout button (added so a user
 * stuck on a 403 has a way out - see CHANGELOG.md). `res.locals.currentUser`
 * was only ever set on the authenticated branch of `loadUser`, so an
 * anonymous request that reached the error page - a non-GET or non-HTML
 * request to a protected route, which `requireLogin` answers with a plain
 * 401 instead of a redirect - crashed the error page itself with
 * "currentUser is not defined". This shipped and crashed in production
 * (Render logs, 2026-08-24) before being caught here.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DB = path.join(os.tmpdir(), `gado-errorpage-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.SESSION_SECRET = 'integration-test-secret-not-used-anywhere-real';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../src/app.js');
const { getDb, closeDb } = await import('../../src/config/db.js');
const { runMigrations } = await import('../../src/db/migrate.js');
const { hashPassword } = await import('../../src/lib/password.js');

const PASSWORD = 'senha-de-teste-1234';
const NOW = '2026-08-05T12:00:00.000Z';

let server;
let baseUrl;

const csrfOf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
const cookiesOf = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

before(async () => {
  const db = getDb();
  runMigrations(db);

  const passwordHash = await hashPassword(PASSWORD);
  db.prepare(
    `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
     VALUES ('Ana Souza', 'ana@teste.com', ?, 'admin', 1, ?, ?)`,
  ).run(passwordHash, NOW, NOW);

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => {
  server?.close();
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(TMP_DB + suffix);
    } catch {
      // Already gone, or still locked on Windows - a temp file either way.
    }
  }
});

test('an anonymous request that reaches the error page renders without crashing', async () => {
  // requireLogin redirects an anonymous GET that accepts html straight to
  // /login - it never reaches errorHandler. A request that is not GET, or
  // does not accept html, is exactly what falls through to a plain 401
  // instead, which is the path that crashed in production.
  const res = await fetch(`${baseUrl}/animais`, { headers: { accept: 'application/json' } });
  const html = await res.text();

  assert.equal(res.status, 401);
  assert.ok(html.includes('É necessário entrar para continuar.'));
  assert.ok(!html.includes('action="/logout"'), 'an anonymous visitor should not see a logout button');
});

test('a logged-in user who hits an error page sees a logout button', async () => {
  const loginPage = await fetch(`${baseUrl}/login`);
  const loginHtml = await loginPage.text();
  const loginCookie = cookiesOf(loginPage) || '';

  const loginRes = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginCookie },
    body: new URLSearchParams({ email: 'ana@teste.com', password: PASSWORD, _csrf: csrfOf(loginHtml) }),
    redirect: 'manual',
  });
  const cookie = cookiesOf(loginRes) || loginCookie;

  // /usuarios/999999/editar: a logged-in admin, a route they hold the
  // capability for, but an id that does not exist - a 404 through the same
  // errorHandler, this time with req.user populated.
  const res = await fetch(`${baseUrl}/usuarios/999999/editar`, { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 404);
  assert.ok(html.includes('action="/logout"'), 'a logged-in user stuck on an error page needs a way out');
});
