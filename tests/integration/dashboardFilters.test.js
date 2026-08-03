/**
 * Tests for dashboard filter resolution.
 *
 * `resolveDashboardFilters` reads user-supplied query parameters, so the
 * property under test throughout is that a malformed or out-of-scope value is
 * dropped rather than trusted - a display filter degrades gracefully instead
 * of erroring, unlike the tenant `?fazenda=` parameter, which is a hard
 * security boundary enforced separately in `middleware/tenant.js`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm } from '../helpers/testDb.js';
import { resolveDashboardFilters, buildFilterQuery } from '../../src/services/dashboardFilters.js';

function insertLot(db, farmId, name) {
  const now = '2026-08-03T12:00:00.000Z';
  return db
    .prepare(
      `INSERT INTO lots (farm_id, name, active, created_at, updated_at) VALUES (?, ?, 1, ?, ?)`,
    )
    .run(farmId, name, now, now).lastInsertRowid;
}

/** Builds a minimal fake request carrying only what the function reads. */
function fakeReq(query, scope) {
  return { query, scope };
}

test('a lote belonging to the caller\'s scope is accepted', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const lotId = insertLot(db, farmId, 'Matrizes');

  const req = fakeReq(
    { lote: String(lotId) },
    { activeFarmId: farmId, effectiveFarmIds: [farmId] },
  );

  const filters = resolveDashboardFilters(req, db);

  assert.equal(filters.lotId, lotId);

  db.close();
});

test('a lote outside scope is silently dropped, not rejected', () => {
  const db = createTestDb();
  const farmId = insertFarm(db, { name: 'Fazenda Minha' });
  const otherFarm = insertFarm(db, { name: 'Fazenda Alheia' });
  const foreignLot = insertLot(db, otherFarm, 'Lote Alheio');

  const req = fakeReq(
    { lote: String(foreignLot) },
    { activeFarmId: farmId, effectiveFarmIds: [farmId] },
  );

  const filters = resolveDashboardFilters(req, db);

  assert.equal(filters.lotId, null);

  db.close();
});

test('a non-numeric or empty lote value is dropped', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  for (const value of ['abc', '', '-1', 'NaN']) {
    const req = fakeReq({ lote: value }, { activeFarmId: farmId, effectiveFarmIds: [farmId] });
    assert.equal(resolveDashboardFilters(req, db).lotId, null, `value "${value}" should be dropped`);
  }

  db.close();
});

test('status defaults to ativo and rejects unknown values', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const scope = { activeFarmId: farmId, effectiveFarmIds: [farmId] };

  assert.equal(resolveDashboardFilters(fakeReq({}, scope), db).status, 'ativo');
  assert.equal(
    resolveDashboardFilters(fakeReq({ status: 'vendido' }, scope), db).status,
    'vendido',
  );
  assert.equal(resolveDashboardFilters(fakeReq({ status: 'todos' }, scope), db).status, 'todos');
  assert.equal(
    resolveDashboardFilters(fakeReq({ status: "'; DROP TABLE animals; --" }, scope), db).status,
    'ativo',
  );

  db.close();
});

test('period preset defaults to "mes" and rejects unknown values', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const scope = { activeFarmId: farmId, effectiveFarmIds: [farmId] };

  assert.equal(resolveDashboardFilters(fakeReq({}, scope), db).period.preset, 'mes');
  assert.equal(
    resolveDashboardFilters(fakeReq({ periodo: '90' }, scope), db).period.preset,
    '90',
  );
  assert.equal(
    resolveDashboardFilters(fakeReq({ periodo: 'bimestre' }, scope), db).period.preset,
    'mes',
  );

  db.close();
});

test('the farms and lots lists are scoped to the caller', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha Fazenda' });
  insertFarm(db, { name: 'Fazenda Alheia' });
  insertLot(db, myFarm, 'Meu Lote');

  const filters = resolveDashboardFilters(
    fakeReq({}, { activeFarmId: null, effectiveFarmIds: [myFarm] }),
    db,
  );

  assert.deepEqual(filters.farms.map((f) => f.name), ['Minha Fazenda']);
  assert.deepEqual(filters.lots.map((l) => l.name), ['Meu Lote']);

  db.close();
});

test('buildFilterQuery preserves existing filters and applies overrides', () => {
  const req = fakeReq(
    { fazenda: '1', lote: '2', status: 'ativo', periodo: '90' },
    { activeFarmId: 1, effectiveFarmIds: [1] },
  );

  const query = buildFilterQuery(req, { status: 'vendido' });
  const params = new URLSearchParams(query);

  assert.equal(params.get('fazenda'), '1');
  assert.equal(params.get('lote'), '2');
  assert.equal(params.get('periodo'), '90');
  assert.equal(params.get('status'), 'vendido', 'the override replaces the original value');
});

test('buildFilterQuery omits empty and undefined values', () => {
  const req = fakeReq({ status: 'ativo' }, { activeFarmId: null, effectiveFarmIds: [] });

  const query = buildFilterQuery(req, { lote: '' });
  const params = new URLSearchParams(query);

  assert.equal(params.has('lote'), false);
  assert.equal(params.has('fazenda'), false);
  assert.equal(params.get('status'), 'ativo');
});
