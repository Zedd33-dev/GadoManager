/**
 * Lembretes: validation and recurrence advancement.
 */

import { addDays, addMonths, isValidIsoDate } from '../lib/dates.js';

export function validateReminderInput(input) {
  const errors = {};

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) errors.title = 'Informe o título do lembrete.';
  else if (title.length > 120) errors.title = 'O título deve ter no máximo 120 caracteres.';

  const dueDate = typeof input.dueDate === 'string' ? input.dueDate : '';
  if (!isValidIsoDate(dueDate)) errors.dueDate = 'Informe uma data válida.';

  const recurrence = ['nenhuma', 'semanal', 'mensal', 'anual'].includes(input.recurrence)
    ? input.recurrence
    : 'nenhuma';

  const description =
    typeof input.description === 'string' && input.description.trim() !== ''
      ? input.description.trim().slice(0, 500)
      : null;

  let assignedUserId = null;
  if (typeof input.assignedUserId === 'string' && input.assignedUserId !== '') {
    const parsed = Number.parseInt(input.assignedUserId, 10);
    if (Number.isInteger(parsed)) assignedUserId = parsed;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { title, description, dueDate, recurrence, assignedUserId } };
}

/**
 * The due date of the next occurrence once a recurring reminder is completed.
 *
 * A recurring reminder regenerates on completion rather than being
 * pre-generated for every future date: "lembrete semanal" only ever has one
 * open row at a time, which is simpler to reason about than a shelf of future
 * rows that would need editing in bulk if the schedule ever changed.
 *
 * "Mensal" and "anual" advance by calendar months/years (via `addMonths`),
 * not a fixed day count - a fixed 30 or 365 days would drift the day-of-month
 * over successive occurrences (e.g. the 31st sliding earlier each cycle).
 * "Semanal" is an exact 7 days, which has no such drift.
 *
 * @param {string} dueDate ISO
 * @param {'nenhuma'|'semanal'|'mensal'|'anual'} recurrence
 * @returns {string|null} the next due date, or null if the reminder does not recur
 */
export function nextOccurrence(dueDate, recurrence) {
  if (recurrence === 'semanal') return addDays(dueDate, 7);
  if (recurrence === 'mensal') return addMonths(dueDate, 1);
  if (recurrence === 'anual') return addMonths(dueDate, 12);
  return null;
}
