/**
 * Sanitary domain rules: carência (withdrawal period), protocol scheduling,
 * and the overdue classification shared with the dashboard.
 *
 * On where the sanitary calendar itself lives
 * -------------------------------------------
 * No vaccine, product or interval is hardcoded anywhere in this module. A
 * protocol is a row in `health_protocols` that the user creates and edits, so
 * the schedule is *data*, not a rule baked into the application. That is
 * deliberate: which vaccines a herd needs depends on the state, the year and
 * current sanitary legislation, and a calendar invented in code would be
 * indefensible and would go stale. What this module encodes is only the
 * arithmetic that is genuinely universal - when a scheduled dose becomes
 * overdue, and when an applied dose stops blocking slaughter.
 */

import { addDays, daysBetween, isValidIsoDate, todayIso } from '../lib/dates.js';

/**
 * The date an applied dose stops blocking slaughter.
 *
 *   liberado_em = data_aplicacao + carência_dias
 *
 * @param {string} appliedDate ISO
 * @param {number} withdrawalDays
 * @returns {string} ISO date
 */
export function withdrawalReleaseDate(appliedDate, withdrawalDays) {
  return addDays(appliedDate, withdrawalDays ?? 0);
}

/**
 * Determines whether an animal is currently within a withdrawal period, given
 * every dose applied to it.
 *
 * An animal may carry several products at once, each with its own carência.
 * The binding constraint is the *latest* release date among them - clearing
 * one product does not clear the animal while another is still in effect.
 *
 * @param {Array<{appliedDate: string|null, withdrawalDays: number, name: string}>} appliedEvents
 * @param {string} [today] ISO, injectable for tests
 * @returns {{
 *   isUnderWithdrawal: boolean,
 *   releaseDate: string|null,
 *   daysRemaining: number|null,
 *   blockingEventName: string|null,
 * }}
 */
export function evaluateWithdrawal(appliedEvents, today = todayIso()) {
  let latestRelease = null;
  let blockingEventName = null;

  for (const event of appliedEvents ?? []) {
    // A dose that was never applied cannot start a withdrawal period, and one
    // with a zero carência never blocks anything.
    if (!event.appliedDate || !isValidIsoDate(event.appliedDate)) continue;
    if (!event.withdrawalDays || event.withdrawalDays <= 0) continue;

    const release = withdrawalReleaseDate(event.appliedDate, event.withdrawalDays);

    // The withdrawal has already elapsed if the release date is today or past:
    // an animal is clear *on* the release day, not the day after.
    if (release <= today) continue;

    if (latestRelease === null || release > latestRelease) {
      latestRelease = release;
      blockingEventName = event.name;
    }
  }

  if (latestRelease === null) {
    return {
      isUnderWithdrawal: false,
      releaseDate: null,
      daysRemaining: null,
      blockingEventName: null,
    };
  }

  return {
    isUnderWithdrawal: true,
    releaseDate: latestRelease,
    daysRemaining: daysBetween(today, latestRelease),
    blockingEventName,
  };
}

/**
 * A dose is overdue when all three hold: it was due before today, it was never
 * applied, and the animal is still active.
 *
 * The animal's status is checked by the caller's query (see
 * `dashboardRepository.healthAlertCounts`); this function covers the two
 * conditions that are properties of the event itself, so the same rule is
 * applied identically wherever a single event is classified.
 *
 * @param {{scheduledDate: string, appliedDate: string|null}} event
 * @param {string} [today] ISO
 * @returns {'aplicada'|'atrasada'|'a-vencer'}
 */
export function classifyEvent(event, today = todayIso()) {
  if (event.appliedDate) return 'aplicada';
  // Strictly before today: a dose due *today* is still due, not yet late.
  if (event.scheduledDate < today) return 'atrasada';
  return 'a-vencer';
}

export const EVENT_STATUS_LABELS = Object.freeze({
  aplicada: 'Aplicada',
  atrasada: 'Atrasada',
  'a-vencer': 'A vencer',
});

export const EVENT_STATUS_VARIANTS = Object.freeze({
  aplicada: 'success',
  atrasada: 'danger',
  'a-vencer': 'info',
});

/**
 * Computes the dates a protocol schedules for one animal.
 *
 * Two scheduling modes, both taken from the protocol row:
 *
 *   por_idade - the dose is due when the animal reaches a given age, so the
 *               date is derived from its own birth date. Applying one protocol
 *               to a whole lote therefore produces a different date per
 *               animal, which is the point.
 *   por_data  - every animal gets the same date, chosen at scheduling time.
 *
 * When the protocol carries `interval_days`, a booster (reforço) is scheduled
 * that many days after the first dose.
 *
 * @param {{schedule_mode: string, age_days: number|null, interval_days: number|null}} protocol
 * @param {{birth_date: string}} animal
 * @param {string|null} baseDate ISO, required for `por_data`
 * @returns {{ok: true, dates: string[]} | {ok: false, reason: string}}
 */
export function scheduleDatesFor(protocol, animal, baseDate) {
  let firstDose;

  if (protocol.schedule_mode === 'por_idade') {
    if (!Number.isInteger(protocol.age_days)) {
      return { ok: false, reason: 'O protocolo não define a idade de aplicação.' };
    }
    firstDose = addDays(animal.birth_date, protocol.age_days);
  } else {
    if (!isValidIsoDate(baseDate)) {
      return { ok: false, reason: 'Informe a data de aplicação prevista.' };
    }
    firstDose = baseDate;
  }

  // An age-based protocol applied to an animal that is already older than the
  // target age schedules a date in the past. That is correct and useful - the
  // dose genuinely is overdue - so it is kept rather than silently shifted to
  // today, which would hide a real gap in the herd's sanitary history.
  const dates = [firstDose];

  if (Number.isInteger(protocol.interval_days) && protocol.interval_days > 0) {
    dates.push(addDays(firstDose, protocol.interval_days));
  }

  return { ok: true, dates };
}

/**
 * Validates recording the application of a scheduled dose.
 *
 * @param {object} input
 * @param {{birth_date: string}} animal
 * @param {string} [today] ISO
 */
export function validateApplication(input, animal, today = todayIso()) {
  const errors = {};

  const appliedDate = typeof input.appliedDate === 'string' ? input.appliedDate : '';

  if (!isValidIsoDate(appliedDate)) {
    errors.appliedDate = 'Informe uma data de aplicação válida.';
  } else if (appliedDate > today) {
    errors.appliedDate = 'A aplicação não pode ter data futura.';
  } else if (appliedDate < animal.birth_date) {
    errors.appliedDate = 'A aplicação não pode ser anterior ao nascimento do animal.';
  }

  const batchNumber =
    typeof input.batchNumber === 'string' && input.batchNumber.trim() !== ''
      ? input.batchNumber.trim().slice(0, 60)
      : null;

  const notes =
    typeof input.notes === 'string' && input.notes.trim() !== ''
      ? input.notes.trim().slice(0, 500)
      : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { appliedDate, batchNumber, notes } };
}

/**
 * Validates a protocol definition.
 */
export function validateProtocolInput(input) {
  const errors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Informe o nome do protocolo.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  const kind = input.kind === 'vacina' || input.kind === 'tratamento' ? input.kind : null;
  if (!kind) errors.kind = 'Selecione se é vacina ou tratamento.';

  const scheduleMode =
    input.scheduleMode === 'por_idade' || input.scheduleMode === 'por_data'
      ? input.scheduleMode
      : null;
  if (!scheduleMode) errors.scheduleMode = 'Selecione o modo de agendamento.';

  let ageDays = null;
  if (scheduleMode === 'por_idade') {
    const parsed = Number.parseInt(input.ageDays, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.ageDays = 'Informe a idade de aplicação em dias.';
    } else {
      ageDays = parsed;
    }
  }

  let intervalDays = null;
  if (typeof input.intervalDays === 'string' && input.intervalDays.trim() !== '') {
    const parsed = Number.parseInt(input.intervalDays, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.intervalDays = 'O intervalo de reforço deve ser um número de dias maior que zero.';
    } else {
      intervalDays = parsed;
    }
  }

  let withdrawalDays = 0;
  if (typeof input.withdrawalDays === 'string' && input.withdrawalDays.trim() !== '') {
    const parsed = Number.parseInt(input.withdrawalDays, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.withdrawalDays = 'A carência deve ser um número de dias válido.';
    } else {
      withdrawalDays = parsed;
    }
  }

  const product =
    typeof input.product === 'string' && input.product.trim() !== ''
      ? input.product.trim().slice(0, 120)
      : null;

  let dose = null;
  if (typeof input.dose === 'string' && input.dose.trim() !== '') {
    const parsed = Number.parseFloat(input.dose.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      errors.dose = 'A dose deve ser maior que zero.';
    } else {
      dose = parsed;
    }
  }

  const doseUnit =
    typeof input.doseUnit === 'string' && input.doseUnit.trim() !== ''
      ? input.doseUnit.trim().slice(0, 20)
      : null;

  const active = input.active === 'on' || input.active === true;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: { name, kind, product, dose, doseUnit, withdrawalDays, scheduleMode, ageDays, intervalDays, active },
  };
}
