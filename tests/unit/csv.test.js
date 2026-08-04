import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../../src/lib/csv.js';

test('toCsv joins fields with a semicolon, not a comma', () => {
  const csv = toCsv(['Brinco', 'Peso'], [['BV-0001', '480,5']]);

  assert.ok(csv.includes('BV-0001;480,5'), 'semicolon delimiter, comma decimal preserved as one field');
});

test('toCsv starts with a UTF-8 byte-order mark', () => {
  const csv = toCsv(['a'], [['b']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('toCsv quotes a field containing the delimiter', () => {
  const csv = toCsv(['Nome'], [['Fazenda; Sítio']]);
  assert.ok(csv.includes('"Fazenda; Sítio"'));
});

test('toCsv quotes and escapes a field containing a double quote', () => {
  const csv = toCsv(['Nota'], [['Animal "premiado"']]);
  assert.ok(csv.includes('"Animal ""premiado"""'));
});

test('toCsv quotes a field containing a newline', () => {
  const csv = toCsv(['Nota'], [['linha 1\nlinha 2']]);
  assert.ok(csv.includes('"linha 1\nlinha 2"'));
});

test('toCsv leaves a plain field unquoted', () => {
  const csv = toCsv(['Brinco'], [['BV-0001']]);
  assert.ok(csv.includes('BV-0001') && !csv.includes('"BV-0001"'));
});

test('toCsv renders null and undefined as an empty field, not the literal text', () => {
  const csv = toCsv(['A', 'B'], [[null, undefined]]);
  const dataLine = csv.split('\r\n')[1];
  assert.equal(dataLine, ';');
});

test('toCsv pads a short row with empty fields rather than shifting columns', () => {
  const csv = toCsv(['A', 'B', 'C'], [['x']]);
  const dataLine = csv.split('\r\n')[1];
  assert.equal(dataLine, 'x;;');
});

test('toCsv ends with a trailing line break', () => {
  const csv = toCsv(['A'], [['1']]);
  assert.ok(csv.endsWith('\r\n'));
});

test('toCsv produces one line per row plus the header', () => {
  const csv = toCsv(['A'], [['1'], ['2'], ['3']]);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 4);
});
