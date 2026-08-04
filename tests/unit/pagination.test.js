import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePagination, buildPageInfo, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../src/lib/pagination.js';

test('parsePagination defaults to page 1 and the default page size', () => {
  assert.deepEqual(parsePagination({}), { page: 1, perPage: DEFAULT_PAGE_SIZE, offset: 0 });
});

test('parsePagination computes the offset from page and perPage', () => {
  assert.deepEqual(parsePagination({ page: '3', perPage: '10' }), { page: 3, perPage: 10, offset: 20 });
});

test('parsePagination rejects a non-positive or non-numeric page', () => {
  assert.equal(parsePagination({ page: '0' }).page, 1);
  assert.equal(parsePagination({ page: '-5' }).page, 1);
  assert.equal(parsePagination({ page: 'abc' }).page, 1);
  assert.equal(parsePagination({ page: '' }).page, 1);
});

test('parsePagination caps perPage at MAX_PAGE_SIZE', () => {
  assert.equal(parsePagination({ perPage: '99999' }).perPage, MAX_PAGE_SIZE);
});

test('parsePagination rejects a non-positive or non-numeric perPage', () => {
  assert.equal(parsePagination({ perPage: '0' }).perPage, DEFAULT_PAGE_SIZE);
  assert.equal(parsePagination({ perPage: '-1' }).perPage, DEFAULT_PAGE_SIZE);
  assert.equal(parsePagination({ perPage: 'abc' }).perPage, DEFAULT_PAGE_SIZE);
});

test('buildPageInfo computes the total pages and neighbours', () => {
  const info = buildPageInfo(130, { page: 2, perPage: 25 });

  assert.equal(info.totalPages, 6);
  assert.equal(info.hasPrevious, true);
  assert.equal(info.hasNext, true);
  assert.equal(info.rangeStart, 26);
  assert.equal(info.rangeEnd, 50);
});

test('buildPageInfo reports no neighbours on a single-page result', () => {
  const info = buildPageInfo(5, { page: 1, perPage: 25 });

  assert.equal(info.totalPages, 1);
  assert.equal(info.hasPrevious, false);
  assert.equal(info.hasNext, false);
  assert.equal(info.rangeStart, 1);
  assert.equal(info.rangeEnd, 5);
});

test('buildPageInfo handles zero rows without dividing by zero', () => {
  const info = buildPageInfo(0, { page: 1, perPage: 25 });

  assert.equal(info.totalPages, 1);
  assert.equal(info.rangeStart, 0);
  assert.equal(info.rangeEnd, 0);
});

test('buildPageInfo clamps a page number beyond the last page', () => {
  // A stale bookmark or a filter that shrank the result set.
  const info = buildPageInfo(10, { page: 99, perPage: 25 });

  assert.equal(info.page, 1);
  assert.equal(info.hasNext, false);
});

test('buildPageInfo computes the exact last-page range', () => {
  const info = buildPageInfo(130, { page: 6, perPage: 25 });

  assert.equal(info.rangeStart, 126);
  assert.equal(info.rangeEnd, 130, 'must not overrun the true total');
});
