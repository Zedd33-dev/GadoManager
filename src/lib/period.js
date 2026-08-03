/**
 * Dashboard period presets.
 *
 * Resolves the "Período" filter (Últimos 30/90/180 dias, Este ano, Mês atual,
 * personalizado) into a concrete half-open date range `[from, until)`, matching
 * the convention used everywhere else costs are summed.
 *
 * Kept as a pure function with no HTTP or database dependency, so it can be
 * called both from the request-handling layer (to build the filter form) and
 * from `kpiService` (to compute a default when no period was supplied, as in
 * every Phase 4 test that predates this filter).
 */

import { addDays, startOfMonth, startOfNextMonth, startOfYear, isValidIsoDate } from './dates.js';

/** Valid values for the `periodo` query parameter, in display order. */
export const PERIOD_PRESETS = ['mes', '30', '90', '180', 'ano', 'custom'];

const PRESET_LABELS = {
  mes: 'Custos do mês',
  30: 'Custos (últimos 30 dias)',
  90: 'Custos (últimos 90 dias)',
  180: 'Custos (últimos 180 dias)',
  ano: 'Custos (este ano)',
  custom: 'Custos (período selecionado)',
};

/**
 * Resolves a period preset (plus optional custom bounds) into a date range.
 *
 * @param {{preset?: string, customFrom?: string, customUntil?: string}} [input]
 * @param {string} today ISO date
 * @returns {{preset: string, from: string, until: string, label: string}}
 */
export function resolvePeriod({ preset = 'mes', customFrom, customUntil } = {}, today) {
  switch (preset) {
    case '30':
    case '90':
    case '180': {
      const days = Number(preset);
      return {
        preset,
        from: addDays(today, -days),
        until: addDays(today, 1),
        label: PRESET_LABELS[preset],
      };
    }

    case 'ano':
      return {
        preset: 'ano',
        from: startOfYear(today),
        until: addDays(today, 1),
        label: PRESET_LABELS.ano,
      };

    case 'custom': {
      const valid =
        isValidIsoDate(customFrom) && isValidIsoDate(customUntil) && customFrom <= customUntil;

      if (!valid) {
        // An incomplete or invalid custom range falls back to the current
        // month rather than producing an empty or backwards range.
        return resolvePeriod({ preset: 'mes' }, today);
      }

      // The user picks calendar days at both ends ("de" and "até" are both
      // inclusive from their point of view), so the exclusive upper bound is
      // the day after customUntil.
      return {
        preset: 'custom',
        from: customFrom,
        until: addDays(customUntil, 1),
        label: PRESET_LABELS.custom,
      };
    }

    case 'mes':
    default:
      return {
        preset: 'mes',
        from: startOfMonth(today),
        until: startOfNextMonth(today),
        label: PRESET_LABELS.mes,
      };
  }
}
