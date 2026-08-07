/**
 * Cross-tenant access (IDOR) over real HTTP.
 *
 * Phase 12. `tenantIsolation.test.js` already proves the repository layer
 * binds a farm scope into every query. This proves the layer above it: that a
 * real logged-in user, holding a real session, cannot reach another farm's
 * records by typing an id into the URL.
 *
 * The distinction matters. Repository-level tests would still pass if a route
 * forgot to pass `req.scope.effectiveFarmIds` and called a lookup with a
 * hardcoded or caller-supplied scope instead - the query would be "scoped",
 * just to the wrong tenant. Only driving the actual route catches that, and
 * insecure-direct-object-reference is the single most common way a
 * multi-tenant web application leaks data in practice.
 *
 * Every probe below asserts the response is NOT 200. A 404 is the preferred
 * answer (an out-of-scope id should be indistinguishable from one that never
 * existed, so the endpoint cannot be used to probe whether another farm's
 * record exists) but 403 is also acceptable - the security property being
 * asserted is "the record is not served", not a particular status code.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Must be set before src/config/env.js is first evaluated, which is why every
// application import below is dynamic: static imports are hoisted and would
// run before these assignments. dotenv does not override an already-set
// variable, so these win over the project's .env.
const TMP_DB = path.join(os.tmpdir(), `gado-idor-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = TMP_DB;
process.env.SESSION_SECRET = 'integration-test-secret-not-used-anywhere-real';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../../src/app.js');
const { getDb, closeDb } = await import('../../src/config/db.js');
const { runMigrations } = await import('../../src/db/migrate.js');
const { hashPassword } = await import('../../src/lib/password.js');

const PASSWORD = 'senha-de-teste-1234';
const NOW = '2026-08-05T12:00:00.000Z';

/** Ids of farm A's records - the ones farm B's manager must never reach. */
const farmA = {};
let server;
let baseUrl;

const csrfOf = (html) => /name="_csrf" value="([^"]+)"/.exec(html)?.[1];
const cookiesOf = (res) =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');

async function login(email) {
  const page = await fetch(`${baseUrl}/login`);
  const html = await page.text();
  const cookie = cookiesOf(page) || '';

  const res = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams({ email, password: PASSWORD, _csrf: csrfOf(html) }),
    redirect: 'manual',
  });

  assert.equal(res.status, 302, `login for ${email} should succeed`);
  return cookiesOf(res) || cookie;
}

before(async () => {
  const db = getDb();
  runMigrations(db);

  const passwordHash = await hashPassword(PASSWORD);

  const farmIdA = Number(
    db
      .prepare(
        `INSERT INTO farms (name, city, state, total_area_ha, created_at, updated_at)
         VALUES ('Fazenda A', 'Campo Grande', 'MS', 500, ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  );
  const farmIdB = Number(
    db
      .prepare(
        `INSERT INTO farms (name, city, state, total_area_ha, created_at, updated_at)
         VALUES ('Fazenda B', 'Cuiaba', 'MT', 500, ?, ?)`,
      )
      .run(NOW, NOW).lastInsertRowid,
  );
  farmA.farmId = farmIdA;

  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`,
  );
  const grant = db.prepare('INSERT INTO user_farms (user_id, farm_id) VALUES (?, ?)');

  // Both are `admin` deliberately. Using a lesser role would make the probes
  // below ambiguous - a 403 could mean "the tenant scope stopped me" or
  // merely "my role never had that capability", and only the first is the
  // property under test. An admin holds every capability in the matrix, so
  // any refusal here can only be the farm boundary doing its job. It is also
  // the strongest form of the claim: not even the highest role reaches
  // another farm's data.
  const userA = Number(
    insertUser.run('Admin A', 'a@teste.com', passwordHash, 'admin', NOW, NOW).lastInsertRowid,
  );
  const userB = Number(
    insertUser.run('Admin B', 'b@teste.com', passwordHash, 'admin', NOW, NOW).lastInsertRowid,
  );
  grant.run(userA, farmIdA);
  grant.run(userB, farmIdB);

  // Farm B gets one animal of its own, so the probes below are proving
  // "cannot see the OTHER farm's data", not the weaker "sees nothing at all".
  db.prepare(
    `INSERT INTO animals (farm_id, ear_tag, birth_date, sex, breed, origin, status, created_at, updated_at)
     VALUES (?, 'B-001', '2024-01-10', 'M', 'Nelore', 'nascido', 'ativo', ?, ?)`,
  ).run(farmIdB, NOW, NOW);

  farmA.lotId = Number(
    db
      .prepare(
        `INSERT INTO lots (farm_id, name, active, created_at, updated_at)
         VALUES (?, 'Lote A', 1, ?, ?)`,
      )
      .run(farmIdA, NOW, NOW).lastInsertRowid,
  );

  farmA.pastureId = Number(
    db
      .prepare(
        `INSERT INTO pastures (farm_id, name, area_ha, active, created_at, updated_at)
         VALUES (?, 'Pasto A', 40, 1, ?, ?)`,
      )
      .run(farmIdA, NOW, NOW).lastInsertRowid,
  );

  farmA.animalId = Number(
    db
      .prepare(
        `INSERT INTO animals (farm_id, ear_tag, birth_date, sex, breed, origin, status,
                              lot_id, pasture_id, photo_path, created_at, updated_at)
         VALUES (?, 'A-001', '2024-01-10', 'M', 'Nelore', 'nascido', 'ativo', ?, ?, 'nao-existe.jpg', ?, ?)`,
      )
      .run(farmIdA, farmA.lotId, farmA.pastureId, NOW, NOW).lastInsertRowid,
  );

  farmA.weighingId = Number(
    db
      .prepare(
        `INSERT INTO weighings (animal_id, weigh_date, weight_kg, source, created_at)
         VALUES (?, '2026-06-15', 420.5, 'manual', ?)`,
      )
      .run(farmA.animalId, NOW).lastInsertRowid,
  );

  const categoryId = db.prepare('SELECT id FROM cost_categories LIMIT 1').get().id;
  farmA.costId = Number(
    db
      .prepare(
        `INSERT INTO costs (farm_id, category_id, cost_date, amount_cents, description, created_at, updated_at)
         VALUES (?, ?, '2026-07-01', 12345, 'Custo da fazenda A', ?, ?)`,
      )
      .run(farmIdA, categoryId, NOW, NOW).lastInsertRowid,
  );

  farmA.reminderId = Number(
    db
      .prepare(
        `INSERT INTO reminders (farm_id, title, due_date, recurrence, created_at, updated_at)
         VALUES (?, 'Lembrete da fazenda A', '2026-09-01', 'nenhuma', ?, ?)`,
      )
      .run(farmIdA, NOW, NOW).lastInsertRowid,
  );

  farmA.saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (farm_id, buyer_name, sale_date, price_per_arroba_cents, created_at, updated_at)
         VALUES (?, 'Frigorifico A', '2026-07-15', 30000, ?, ?)`,
      )
      .run(farmIdA, NOW, NOW).lastInsertRowid,
  );

  farmA.protocolId = Number(
    db
      .prepare(
        `INSERT INTO health_protocols
           (farm_id, name, kind, withdrawal_days, schedule_mode, age_days, active, created_at, updated_at)
         VALUES (?, 'Protocolo A', 'vacina', 21, 'por_idade', 90, 1, ?, ?)`,
      )
      .run(farmIdA, NOW, NOW).lastInsertRowid,
  );

  farmA.eventId = Number(
    db
      .prepare(
        `INSERT INTO health_events
           (animal_id, protocol_id, kind, name, scheduled_date, withdrawal_days, created_at, updated_at)
         VALUES (?, ?, 'vacina', 'Dose da fazenda A', '2026-06-01', 21, ?, ?)`,
      )
      .run(farmA.animalId, farmA.protocolId, NOW, NOW).lastInsertRowid,
  );

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

test("farm A's own manager can read farm A's records (the probes below are meaningful)", async () => {
  // Without this, every assertion in the next test would also pass against a
  // route that is simply broken for everyone.
  const cookie = await login('a@teste.com');

  for (const [label, url] of [
    ['animal', `/animais/${farmA.animalId}`],
    ['sale', `/vendas/${farmA.saleId}`],
    ['cost edit', `/custos/${farmA.costId}/editar`],
    ['reminder edit', `/lembretes/${farmA.reminderId}/editar`],
    ['protocol edit', `/protocolos/${farmA.protocolId}/editar`],
    ['lot edit', `/lotes/${farmA.lotId}/editar`],
    ['pasture edit', `/pastos/${farmA.pastureId}/editar`],
    ['farm edit', `/fazendas/${farmA.farmId}/editar`],
    ['apply dose', `/sanidade/${farmA.eventId}/aplicar`],
  ]) {
    const res = await fetch(`${baseUrl}${url}`, { headers: { cookie } });
    assert.equal(res.status, 200, `${label} (${url}) should be readable by its own farm`);
  }
});

test("farm B's manager cannot read any of farm A's records by id", async () => {
  const cookie = await login('b@teste.com');

  for (const [label, url] of [
    ['animal detail', `/animais/${farmA.animalId}`],
    ['animal edit form', `/animais/${farmA.animalId}/editar`],
    ['animal photo', `/animais/${farmA.animalId}/foto`],
    ['sale detail', `/vendas/${farmA.saleId}`],
    ['cost edit form', `/custos/${farmA.costId}/editar`],
    ['reminder edit form', `/lembretes/${farmA.reminderId}/editar`],
    ['protocol edit form', `/protocolos/${farmA.protocolId}/editar`],
    ['protocol schedule form', `/protocolos/${farmA.protocolId}/agendar`],
    ['lot edit form', `/lotes/${farmA.lotId}/editar`],
    ['pasture edit form', `/pastos/${farmA.pastureId}/editar`],
    ['farm edit form', `/fazendas/${farmA.farmId}/editar`],
    ['apply-dose form', `/sanidade/${farmA.eventId}/aplicar`],
    ['new weighing form', `/animais/${farmA.animalId}/pesagens/nova`],
  ]) {
    const res = await fetch(`${baseUrl}${url}`, { headers: { cookie } });
    assert.notEqual(res.status, 200, `${label} (${url}) leaked another farm's record`);
  }
});

test("farm B's manager cannot MODIFY farm A's records by id", async () => {
  const cookie = await login('b@teste.com');

  // A CSRF token issued to B's own session: the point is to get past CSRF and
  // be stopped by the tenant scope, not to be stopped by CSRF and learn
  // nothing about whether the scope check exists at all.
  const ownForm = await fetch(`${baseUrl}/lembretes/novo`, { headers: { cookie } });
  const token = csrfOf(await ownForm.text());
  assert.ok(token, 'expected to obtain a CSRF token from an allowed page');

  const posts = [
    ['edit animal', `/animais/${farmA.animalId}/editar`, { earTag: 'HACKED', birthDate: '2024-01-10', sex: 'M', breed: 'Nelore', origin: 'nascido', status: 'ativo' }],
    ['edit cost', `/custos/${farmA.costId}/editar`, { categorySlug: 'alimentacao', costDate: '2026-07-01', amount: '999,00' }],
    ['edit reminder', `/lembretes/${farmA.reminderId}/editar`, { title: 'HACKED', dueDate: '2026-09-01', recurrence: 'nenhuma' }],
    ['complete reminder', `/lembretes/${farmA.reminderId}/concluir`, {}],
    ['edit lot', `/lotes/${farmA.lotId}/editar`, { name: 'HACKED', active: 'on' }],
    ['edit pasture', `/pastos/${farmA.pastureId}/editar`, { name: 'HACKED', areaHa: '40', active: 'on' }],
    ['edit farm', `/fazendas/${farmA.farmId}/editar`, { name: 'HACKED' }],
    ['delete cost', `/custos/${farmA.costId}/excluir`, {}],
    ['delete health event', `/sanidade/${farmA.eventId}/excluir`, {}],
    // The destructive bulk paths take ids straight from a form field, which
    // makes them the most attractive target: one request, arbitrary ids, and
    // permanent loss if the scope is ever dropped from the DELETE.
    ['bulk delete animals', '/animais/excluir', { ids: String(farmA.animalId) }],
    ['delete weighing', `/pesagens/${farmA.weighingId}/excluir`, {}],
  ];

  for (const [label, url, fields] of posts) {
    const res = await fetch(`${baseUrl}${url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
      body: new URLSearchParams({ ...fields, _csrf: token }),
      redirect: 'manual',
    });
    assert.notEqual(res.status, 200, `${label}: unexpected 200`);
  }

  // The decisive check: whatever status codes came back, farm A's data must
  // be byte-for-byte untouched. A route that "succeeded" with a redirect
  // while silently writing nothing would pass the status assertions above.
  // This matters most for the two bulk-delete routes above: both redirect
  // (302) whether or not anything was actually removed, so their status code
  // proves nothing on its own. Only reading the rows back does.
  const db = getDb();
  const animal = db.prepare('SELECT ear_tag FROM animals WHERE id = ?').get(farmA.animalId);
  const weighing = db.prepare('SELECT id FROM weighings WHERE id = ?').get(farmA.weighingId);
  const cost = db.prepare('SELECT amount_cents FROM costs WHERE id = ?').get(farmA.costId);
  const reminder = db.prepare('SELECT title, done_at FROM reminders WHERE id = ?').get(farmA.reminderId);
  const lot = db.prepare('SELECT name FROM lots WHERE id = ?').get(farmA.lotId);
  const pasture = db.prepare('SELECT name FROM pastures WHERE id = ?').get(farmA.pastureId);
  const farm = db.prepare('SELECT name FROM farms WHERE id = ?').get(farmA.farmId);
  const event = db.prepare('SELECT id FROM health_events WHERE id = ?').get(farmA.eventId);

  assert.ok(animal, "farm A's animal was DELETED by another farm");
  assert.equal(animal.ear_tag, 'A-001', "farm A's animal was modified");
  assert.ok(weighing, "farm A's weighing was DELETED by another farm");
  assert.equal(cost.amount_cents, 12345, "farm A's cost was modified");
  assert.equal(reminder.title, 'Lembrete da fazenda A', "farm A's reminder was modified");
  assert.equal(reminder.done_at, null, "farm A's reminder was completed by another farm");
  assert.equal(lot.name, 'Lote A', "farm A's lot was modified");
  assert.equal(pasture.name, 'Pasto A', "farm A's pasture was modified");
  assert.equal(farm.name, 'Fazenda A', 'farm A itself was modified');
  assert.ok(event, "farm A's health event was deleted");
});

test('the Fazenda filter rejects a farm id outside the caller\'s scope', async () => {
  const cookie = await login('b@teste.com');

  // ?fazenda= is validated in middleware/tenant.js because it widens scope,
  // unlike the purely cosmetic dashboard filters.
  const res = await fetch(`${baseUrl}/?fazenda=${farmA.farmId}`, { headers: { cookie } });
  assert.equal(res.status, 403);
});

test('a list page shows only the caller\'s own rows, never the other farm\'s', async () => {
  const cookie = await login('b@teste.com');

  const res = await fetch(`${baseUrl}/animais?perPage=100`, { headers: { cookie } });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.ok(html.includes('B-001'), "farm B should see its own animal");
  assert.ok(!html.includes('A-001'), "farm A's animal leaked into farm B's list");
});
