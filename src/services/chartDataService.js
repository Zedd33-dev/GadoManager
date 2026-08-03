/**
 * Chart view-model assembly.
 *
 * Turns the raw rows from `dashboardRepository` into the labels/series shape
 * `public/js/charts.js` expects, plus a plain-data `rows` array used to render
 * each chart's accessible text-alternative table. Every chart function returns
 * both from a single query pass, so the visual and the table can never disagree
 * with each other - they are built from the same numbers.
 *
 * Age-range classification is business logic and therefore lives here, not in
 * SQL (see `activeAnimalDemographics` in the repository) and not in the
 * client-side chart script (which only draws what it is given).
 */

import {
  weightByLot,
  activeAnimalDemographics,
  monthlyWeightByLot,
  monthlyGmdByLot,
  monthlyCostByCategory,
} from '../repositories/dashboardRepository.js';
import { listInScope as listLotsInScope } from '../repositories/lotRepository.js';
import { ageInMonths, addMonths, startOfMonth } from '../lib/dates.js';
import { safeDivide } from '../lib/safeMath.js';
import {
  CHART_TREND_MONTHS,
  CALF_MAX_AGE_MONTHS,
  YOUNG_MAX_AGE_MONTHS,
  ANIMAL_STATUS_LABELS,
} from '../domain/constants.js';

const NO_LOT_LABEL = 'Sem lote';

/**
 * Builds a lot-id -> name lookup, including a `null` entry for animals with no
 * lote assigned.
 */
function buildLotNameMap(db, farmIds) {
  const map = new Map([[null, NO_LOT_LABEL]]);
  for (const lot of listLotsInScope(db, farmIds)) map.set(lot.id, lot.name);
  return map;
}

/**
 * The last `CHART_TREND_MONTHS` calendar months as `YYYY-MM` keys, oldest
 * first, ending with the current month. Generated explicitly so a month with
 * no data still appears on the chart as a gap rather than being skipped, which
 * would otherwise compress the time axis and misrepresent the gap as absence
 * of a chart point rather than absence of activity.
 *
 * @param {string} today ISO date
 * @returns {string[]}
 */
function trailingMonthKeys(today) {
  const start = startOfMonth(addMonths(today, -(CHART_TREND_MONTHS - 1)));
  return Array.from({ length: CHART_TREND_MONTHS }, (_, i) => addMonths(start, i).slice(0, 7));
}

/**
 * Herd status donut - "Status do rebanho".
 *
 * Reuses the counts already computed by `kpiService.buildDashboardKpis`
 * rather than re-querying, since the dashboard always builds both from the
 * same request.
 *
 * @param {{total: number, active: number, sold: number, dead: number, transferred: number}} herd
 */
export function herdStatusChart(herd) {
  const entries = [
    { key: 'ativo', count: herd.active },
    { key: 'vendido', count: herd.sold },
    { key: 'morto', count: herd.dead },
    { key: 'transferido', count: herd.transferred },
  ];

  return {
    total: herd.total,
    labels: entries.map((e) => ANIMAL_STATUS_LABELS[e.key]),
    values: entries.map((e) => e.count),
    rows: entries.map((e) => ({
      status: ANIMAL_STATUS_LABELS[e.key],
      count: e.count,
      percent: safeDivide(e.count, herd.total),
    })),
  };
}

/**
 * "Peso médio por lote" bar chart, with the herd average as a reference line.
 */
export function weightByLotChart(db, farmIds, { lotId = null } = {}) {
  const rows = weightByLot(db, farmIds, { lotId });
  const lotNames = buildLotNameMap(db, farmIds);

  const sorted = [...rows].sort((a, b) => b.averageKg - a.averageKg);

  const totalAnimals = sorted.reduce((sum, r) => sum + r.animalCount, 0);
  const weightedSum = sorted.reduce((sum, r) => sum + r.averageKg * r.animalCount, 0);
  const herdAverage = safeDivide(weightedSum, totalAnimals);

  return {
    labels: sorted.map((r) => lotNames.get(r.lotId) ?? NO_LOT_LABEL),
    values: sorted.map((r) => r.averageKg),
    herdAverage,
    rows: sorted.map((r) => ({
      lot: lotNames.get(r.lotId) ?? NO_LOT_LABEL,
      averageKg: r.averageKg,
      animalCount: r.animalCount,
    })),
  };
}

/**
 * Classifies one animal into the five herd-composition categories.
 *
 * @param {number} months age in whole months
 * @param {string} sex 'M' or 'F'
 * @returns {string}
 */
function classifyAgeRange(months, sex) {
  if (months < CALF_MAX_AGE_MONTHS) return 'Bezerro(a)';
  if (months < YOUNG_MAX_AGE_MONTHS) return sex === 'F' ? 'Novilha' : 'Boi';
  return sex === 'F' ? 'Vaca' : 'Touro';
}

/** Fixed display order, independent of which categories happen to be populated. */
const AGE_RANGE_ORDER = ['Bezerro(a)', 'Novilha', 'Boi', 'Vaca', 'Touro'];

/**
 * "Composição do rebanho" - grouped bar by age range and sex.
 */
export function herdCompositionChart(db, farmIds, today, { lotId = null } = {}) {
  const animals = activeAnimalDemographics(db, farmIds, { lotId });

  const counts = new Map(AGE_RANGE_ORDER.map((range) => [range, { M: 0, F: 0 }]));

  for (const { birthDate, sex } of animals) {
    const range = classifyAgeRange(ageInMonths(birthDate, today), sex);
    counts.get(range)[sex] += 1;
  }

  const populated = AGE_RANGE_ORDER.filter((range) => counts.get(range).M + counts.get(range).F > 0);

  return {
    labels: populated,
    male: populated.map((range) => counts.get(range).M),
    female: populated.map((range) => counts.get(range).F),
    rows: populated.map((range) => ({
      range,
      male: counts.get(range).M,
      female: counts.get(range).F,
      total: counts.get(range).M + counts.get(range).F,
    })),
  };
}

/**
 * Reshapes a series of `{yearMonth, lotId, value}` rows into one array per
 * lote, aligned against a common set of month keys so every series has the
 * same length and a missing month reads as `null` (a gap), not a zero.
 *
 * @param {Array<{yearMonth: string, lotId: number|null}>} rows
 * @param {string} valueKey the property on each row holding the number
 * @param {string[]} monthKeys
 * @param {Map<number|null, string>} lotNames
 */
function seriesByLot(rows, valueKey, monthKeys, lotNames) {
  const byLot = new Map();

  for (const row of rows) {
    if (!byLot.has(row.lotId)) {
      byLot.set(row.lotId, new Map());
    }
    byLot.get(row.lotId).set(row.yearMonth, row[valueKey]);
  }

  return [...byLot.entries()]
    .map(([lotId, valuesByMonth]) => ({
      lotId,
      lotName: lotNames.get(lotId) ?? NO_LOT_LABEL,
      data: monthKeys.map((month) => valuesByMonth.get(month) ?? null),
    }))
    .sort((a, b) => a.lotName.localeCompare(b.lotName, 'pt-BR'));
}

/**
 * "Evolução do peso médio" - one line per lote, over the trailing window.
 *
 * Deliberately not restricted to active animals - see the repository function
 * for why a historical trend must include animals later sold or that died.
 */
export function weightEvolutionChart(db, farmIds, today, { lotId = null } = {}) {
  const monthKeys = trailingMonthKeys(today);
  const sinceMonth = `${monthKeys[0]}-01`;
  const lotNames = buildLotNameMap(db, farmIds);

  const rows = monthlyWeightByLot(db, farmIds, sinceMonth, { lotId });
  const series = seriesByLot(rows, 'averageKg', monthKeys, lotNames);

  return {
    months: monthKeys,
    series,
    rows: monthKeys.flatMap((month) =>
      series
        .filter((s) => s.data[monthKeys.indexOf(month)] !== null)
        .map((s) => ({
          month,
          lot: s.lotName,
          averageKg: s.data[monthKeys.indexOf(month)],
        })),
    ),
  };
}

/**
 * "Curva de GMD" - one line per lote, over the trailing window.
 */
export function gmdCurveChart(db, farmIds, today, { lotId = null } = {}) {
  const monthKeys = trailingMonthKeys(today);
  const sinceMonth = `${monthKeys[0]}-01`;
  const lotNames = buildLotNameMap(db, farmIds);

  const rows = monthlyGmdByLot(db, farmIds, sinceMonth, { lotId });
  const series = seriesByLot(rows, 'averageGmd', monthKeys, lotNames);

  return {
    months: monthKeys,
    series,
    rows: monthKeys.flatMap((month) =>
      series
        .filter((s) => s.data[monthKeys.indexOf(month)] !== null)
        .map((s) => ({
          month,
          lot: s.lotName,
          averageGmd: s.data[monthKeys.indexOf(month)],
        })),
    ),
  };
}

/**
 * "Custos por categoria" - stacked bar, one series per category, over the
 * trailing window.
 */
export function costsByCategoryChart(db, farmIds, today, { lotId = null } = {}) {
  const monthKeys = trailingMonthKeys(today);
  const sinceMonth = `${monthKeys[0]}-01`;

  const rows = monthlyCostByCategory(db, farmIds, sinceMonth, { lotId });

  const byCategory = new Map();
  for (const row of rows) {
    if (!byCategory.has(row.categorySlug)) {
      byCategory.set(row.categorySlug, { name: row.categoryName, values: new Map() });
    }
    byCategory.get(row.categorySlug).values.set(row.yearMonth, row.totalCents);
  }

  const series = [...byCategory.entries()].map(([slug, { name, values }]) => ({
    slug,
    name,
    data: monthKeys.map((month) => (values.get(month) ?? 0) / 100), // reais, for the chart's tooltip formatting
  }));

  return {
    months: monthKeys,
    series,
    rows: monthKeys.flatMap((month, index) =>
      series
        .filter((s) => s.data[index] > 0)
        .map((s) => ({ month, category: s.name, amountCents: Math.round(s.data[index] * 100) })),
    ),
  };
}
