/**
 * Dashboard filter resolution.
 *
 * Reads the Lote, Status and Período query parameters, validates them, and
 * gathers the option lists the filter form needs. The Fazenda filter itself is
 * not handled here - it is already resolved and validated by
 * `middleware/tenant.js`, since it doubles as part of the tenant security
 * boundary, not merely a display preference.
 *
 * Everything resolved here is a display filter, not a security boundary: an
 * out-of-scope or malformed value is silently dropped rather than rejected
 * with an error, because a bad query parameter on a dashboard page should
 * degrade gracefully, not break the page.
 */

import { ANIMAL_STATUS } from '../domain/constants.js';
import { listInScope as listFarmsInScope } from '../repositories/farmRepository.js';
import { listInScope as listLotsInScope, findInScope as findLotInScope } from '../repositories/lotRepository.js';
import { PERIOD_PRESETS } from '../lib/period.js';
import { buildQuery } from '../lib/queryString.js';

/** Valid values for the `status` query parameter. */
const STATUS_FILTER_VALUES = new Set([...Object.values(ANIMAL_STATUS), 'todos']);

/**
 * @param {import('express').Request} req
 * @param {import('better-sqlite3').Database} db
 * @returns {{
 *   farmId: number|null,
 *   lotId: number|null,
 *   status: string,
 *   period: {preset: string, customFrom: string, customUntil: string},
 *   farms: object[],
 *   lots: object[],
 * }}
 */
export function resolveDashboardFilters(req, db) {
  const farmIds = req.scope.effectiveFarmIds;

  let lotId = null;
  const lotRaw = req.query.lote;
  if (typeof lotRaw === 'string' && lotRaw !== '') {
    const parsed = Number.parseInt(lotRaw, 10);
    if (Number.isInteger(parsed) && findLotInScope(db, farmIds, parsed)) {
      lotId = parsed;
    }
  }

  const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
  const status = STATUS_FILTER_VALUES.has(statusRaw) ? statusRaw : ANIMAL_STATUS.ACTIVE;

  const presetRaw = typeof req.query.periodo === 'string' ? req.query.periodo : '';
  const preset = PERIOD_PRESETS.includes(presetRaw) ? presetRaw : 'mes';

  return {
    farmId: req.scope.activeFarmId,
    lotId,
    status,
    period: {
      preset,
      customFrom: typeof req.query.de === 'string' ? req.query.de : '',
      customUntil: typeof req.query.ate === 'string' ? req.query.ate : '',
    },
    // Lots are scoped to whichever farm is currently selected, because
    // effectiveFarmIds narrows to [farmId] once a single farm is chosen.
    farms: listFarmsInScope(db, farmIds),
    lots: listLotsInScope(db, farmIds),
  };
}

/**
 * Builds a query string that preserves the current filters, with overrides.
 *
 * Used to build links that change exactly one filter - e.g. a status chip -
 * without discarding the farm, lote or period the user already selected.
 *
 * @param {import('express').Request} req
 * @param {Record<string, string|number|null|undefined>} [overrides]
 * @returns {string}
 */
export function buildFilterQuery(req, overrides = {}) {
  const current = {
    fazenda: req.query.fazenda,
    lote: req.query.lote,
    status: req.query.status,
    periodo: req.query.periodo,
    de: req.query.de,
    ate: req.query.ate,
  };

  return buildQuery(current, overrides);
}
