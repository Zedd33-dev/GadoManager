import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery } from '../../src/lib/queryString.js';

test('buildQuery preserves current values not touched by overrides', () => {
  const query = buildQuery({ status: 'ativo', sort: 'earTag' }, { dir: 'desc' });
  const params = new URLSearchParams(query);

  assert.equal(params.get('status'), 'ativo');
  assert.equal(params.get('sort'), 'earTag');
  assert.equal(params.get('dir'), 'desc');
});

test('buildQuery lets an override replace a current value', () => {
  const query = buildQuery({ page: '3' }, { page: '5' });
  assert.equal(new URLSearchParams(query).get('page'), '5');
});

test('buildQuery removes a key when the override is undefined', () => {
  const query = buildQuery({ page: '3', status: 'ativo' }, { page: undefined });
  const params = new URLSearchParams(query);

  assert.equal(params.has('page'), false);
  assert.equal(params.get('status'), 'ativo');
});

test('buildQuery omits empty-string and null current values', () => {
  const query = buildQuery({ status: '', breed: null, sex: 'M' });
  const params = new URLSearchParams(query);

  assert.equal(params.has('status'), false);
  assert.equal(params.has('breed'), false);
  assert.equal(params.get('sex'), 'M');
});
