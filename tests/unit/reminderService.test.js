import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateReminderInput, nextOccurrence } from '../../src/services/reminderService.js';

test('a reminder requires a title and a valid due date', () => {
  assert.match(validateReminderInput({ dueDate: '2026-08-10' }).errors.title, /título/);
  assert.match(validateReminderInput({ title: 'X', dueDate: '10/08/2026' }).errors.dueDate, /válida/);
});

test('recurrence defaults to nenhuma for an unrecognised value', () => {
  const result = validateReminderInput({ title: 'X', dueDate: '2026-08-10', recurrence: 'diaria' });
  assert.equal(result.data.recurrence, 'nenhuma');
});

test('a valid reminder normalises its fields', () => {
  const result = validateReminderInput({
    title: '  Pesagem geral  ',
    dueDate: '2026-08-10',
    recurrence: 'mensal',
    assignedUserId: '3',
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.title, 'Pesagem geral');
  assert.equal(result.data.assignedUserId, 3);
});

test('nextOccurrence advances weekly by exactly 7 days', () => {
  assert.equal(nextOccurrence('2026-08-10', 'semanal'), '2026-08-17');
});

test('nextOccurrence advances monthly by calendar month, clamped at month end', () => {
  // The 31st does not exist in every following month - addMonths clamps
  // rather than overflowing into the next month, so the day never drifts
  // forward across repeated occurrences.
  assert.equal(nextOccurrence('2026-01-31', 'mensal'), '2026-02-28');
  assert.equal(nextOccurrence('2026-03-15', 'mensal'), '2026-04-15');
});

test('nextOccurrence advances yearly by twelve calendar months', () => {
  assert.equal(nextOccurrence('2026-08-10', 'anual'), '2027-08-10');
});

test('nextOccurrence returns null for a non-recurring reminder', () => {
  assert.equal(nextOccurrence('2026-08-10', 'nenhuma'), null);
});
