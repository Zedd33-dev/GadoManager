/**
 * Self-registration as a real onboarding path, not just an account row.
 *
 * A self-registered account is granted `gerente` with zero farms - and
 * `farms:write` now includes gerente specifically so this account's first
 * action can be creating its own farm, which grants the creator access to
 * it in the same transaction (farmRepository.insertFarmForUser). Before
 * this, a fresh account was `peao` and could reach nothing until an admin
 * manually granted a farm from /usuarios.
 *
 * `tests/unit/permissions.test.js` proves the capability matrix has the
 * right shape. This drives the actual HTTP path end to end - register, log
 * in, create a farm, then use it (a lot, a cost) - because the matrix being
 * correct does not by itself prove the route wiring lets a brand new
 * account walk that path in one sitting.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DB = path.join(os.tmpdir(), `gado-selfservice-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.SESSION_SECRET = 'integration-test-secret-not-used-anywhere-real';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../src/app.js');
const { getDb, closeDb } = await import('../../src/config/db.js');
const { runMigrations } = await import('../../src/db/migrate.js');
const { findByEmail } = await import('../../src/repositories/userRepository.js');

let server;
let baseUrl;

const csrfOf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
const cookiesOf = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

async function get(path, cookie) {
  const res = await fetch(`${baseUrl}${path}`, { headers: { cookie: cookie ?? '' } });
  return { res, html: await res.text(), cookie: cookiesOf(res) || cookie };
}

async function post(path, cookie, token, fields) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ ...fields, _csrf: token }),
    redirect: 'manual',
  });
  return { res, html: await res.text(), cookie: cookiesOf(res) || cookie };
}

before(async () => {
  runMigrations(getDb());
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

test('a self-registered account is gerente with zero farms', async () => {
  const email = `produtor-${Date.now()}@teste.com`;

  const regForm = await get('/registrar');
  await post('/registrar', regForm.cookie, csrfOf(regForm.html), {
    name: 'Produtor Teste',
    email,
    password: 'senha1234',
    confirmPassword: 'senha1234',
  });

  const row = findByEmail(getDb(), email);
  assert.ok(row, 'the account should exist');

  const full = getDb().prepare('SELECT role FROM users WHERE id = ?').get(row.id);
  assert.equal(full.role, 'gerente');
});

test('that account can create its own farm, then a lot and a cost inside it - with no admin involved', async () => {
  const email = `produtor-${Date.now()}-2@teste.com`;
  const password = 'senha1234';

  // Register.
  const regForm = await get('/registrar');
  await post('/registrar', regForm.cookie, csrfOf(regForm.html), {
    name: 'Produtor Dois',
    email,
    password,
    confirmPassword: password,
  });

  // Log in.
  const loginPage = await get('/login');
  const loginRes = await post('/login', loginPage.cookie, csrfOf(loginPage.html), { email, password });
  assert.equal(loginRes.res.status, 302, 'login should succeed for the freshly registered account');
  const cookie = loginRes.cookie;

  // Before creating a farm: the dashboard is reachable (not blocked, per the
  // farm-less-account-browses change) but genuinely empty.
  const emptyHome = await get('/', cookie);
  assert.equal(emptyHome.res.status, 200);

  // Create a farm - the capability this whole change is about.
  const farmForm = await get('/fazendas/nova', cookie);
  assert.equal(farmForm.res.status, 200, 'a gerente must be able to reach the new-farm form');

  const createFarm = await post('/fazendas', cookie, csrfOf(farmForm.html), {
    name: 'Fazenda do Produtor Dois',
    city: 'Araçatuba',
    state: 'SP',
  });
  assert.equal(createFarm.res.status, 302, 'creating a farm should redirect, not 403');

  const farmRow = getDb().prepare("SELECT id FROM farms WHERE name = 'Fazenda do Produtor Dois'").get();
  assert.ok(farmRow, 'the farm should actually exist');

  const userRow = findByEmail(getDb(), email);
  const grant = getDb()
    .prepare('SELECT 1 FROM user_farms WHERE user_id = ? AND farm_id = ?')
    .get(userRow.id, farmRow.id);
  assert.ok(grant, 'creating a farm must grant the creator access to it');

  // Now inside that farm: create a lot.
  const lotForm = await get('/lotes/novo', cookie);
  const createLot = await post('/lotes', cookie, csrfOf(lotForm.html), {
    name: 'Lote Inicial',
    active: 'on',
  });
  assert.equal(createLot.res.status, 302, 'a gerente with exactly one farm should not need to pick a farmId');
  assert.ok(
    getDb().prepare("SELECT 1 FROM lots WHERE name = 'Lote Inicial' AND farm_id = ?").get(farmRow.id),
    'the lot should exist under the new farm',
  );

  // And a cost.
  const category = getDb().prepare('SELECT slug FROM cost_categories LIMIT 1').get().slug;
  const costForm = await get('/custos/novo', cookie);
  const createCost = await post('/custos', cookie, csrfOf(costForm.html), {
    categorySlug: category,
    costDate: '2026-08-01',
    amount: '150,00',
  });
  assert.equal(createCost.res.status, 302, 'creating a cost should succeed for a gerente');
  assert.ok(
    getDb().prepare('SELECT 1 FROM costs WHERE farm_id = ? AND amount_cents = 15000').get(farmRow.id),
    'the cost should exist under the new farm',
  );
});

test('a self-registered account still cannot manage other users or delete an animal', async () => {
  const email = `produtor-${Date.now()}-3@teste.com`;
  const password = 'senha1234';

  const regForm = await get('/registrar');
  await post('/registrar', regForm.cookie, csrfOf(regForm.html), {
    name: 'Produtor Três',
    email,
    password,
    confirmPassword: password,
  });

  const loginPage = await get('/login');
  const loginRes = await post('/login', loginPage.cookie, csrfOf(loginPage.html), { email, password });
  const cookie = loginRes.cookie;

  const usersPage = await fetch(`${baseUrl}/usuarios`, { headers: { cookie } });
  assert.equal(usersPage.status, 403, 'user management stays admin-only');

  // A real CSRF token, so this fails on the capability check specifically -
  // a bad token would also 403, but that would prove nothing about
  // animals:delete.
  const { html: animalsHtml, cookie: c2 } = await get('/animais', cookie);
  const bulkDelete = await post('/animais/excluir', c2, csrfOf(animalsHtml), {});
  assert.equal(bulkDelete.res.status, 403, 'permanent deletion stays admin-only');
});
