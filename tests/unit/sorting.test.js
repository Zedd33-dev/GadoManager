import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSort, nextDirectionFor } from '../../src/lib/sorting.js';

const COLUMNS = {
  earTag: 'a.ear_tag',
  birthDate: 'a.birth_date',
  weight: 'lw.weight_kg',
};
const DEFAULTS = { defaultKey: 'earTag', defaultDirection: 'asc' };

test('resolveSort accepts a known column and direction', () => {
  const sort = resolveSort(COLUMNS, DEFAULTS, { sort: 'birthDate', dir: 'desc' });

  assert.equal(sort.key, 'birthDate');
  assert.equal(sort.direction, 'desc');
  assert.equal(sort.orderBy, 'a.birth_date DESC');
});

test('resolveSort falls back to the default column for an unknown key', () => {
  const sort = resolveSort(COLUMNS, DEFAULTS, { sort: 'not_a_real_column' });

  assert.equal(sort.key, 'earTag');
  assert.equal(sort.orderBy, 'a.ear_tag ASC');
});

test('resolveSort rejects a SQL-injection attempt as an unknown key', () => {
  // The only defence that matters: an unrecognised key can never reach the
  // query string, because orderBy is built from the allow-listed expression,
  // never from the request value itself.
  const sort = resolveSort(COLUMNS, DEFAULTS, { sort: 'a.ear_tag; DROP TABLE animals; --' });

  assert.equal(sort.key, 'earTag');
  assert.equal(sort.orderBy, 'a.ear_tag ASC');
});

test('resolveSort rejects an invalid direction', () => {
  const sort = resolveSort(COLUMNS, DEFAULTS, { sort: 'weight', dir: 'sideways' });

  assert.equal(sort.direction, 'asc');
});

test('resolveSort uses the default direction when none is given', () => {
  const desc = resolveSort(COLUMNS, { defaultKey: 'earTag', defaultDirection: 'desc' }, {});
  assert.equal(desc.direction, 'desc');
});

test('resolveSort is case-insensitive on direction', () => {
  assert.equal(resolveSort(COLUMNS, DEFAULTS, { dir: 'DESC' }).direction, 'desc');
});

test('nextDirectionFor starts a new column ascending', () => {
  const current = { key: 'earTag', direction: 'desc' };
  assert.equal(nextDirectionFor(current, 'weight'), 'asc');
});

test('nextDirectionFor flips the direction of the active column', () => {
  assert.equal(nextDirectionFor({ key: 'earTag', direction: 'asc' }, 'earTag'), 'desc');
  assert.equal(nextDirectionFor({ key: 'earTag', direction: 'desc' }, 'earTag'), 'asc');
});
