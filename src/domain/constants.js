/**
 * Domain constants.
 *
 * Every magic number in the business rules is named here, with its unit and its
 * justification. A figure that appears bare in a query is a figure nobody can
 * defend in front of a board.
 */

/** Animal statuses, matching the CHECK constraint on `animals.status`. */
export const ANIMAL_STATUS = Object.freeze({
  ACTIVE: 'ativo',
  SOLD: 'vendido',
  DEAD: 'morto',
  TRANSFERRED: 'transferido',
});

export const ANIMAL_STATUS_LABELS = Object.freeze({
  ativo: 'Ativo',
  vendido: 'Vendido',
  morto: 'Morto',
  transferido: 'Transferido',
});

/**
 * One animal unit (unidade animal, UA) is 450 kg of live weight.
 *
 * This is the Brazilian convention used to express stocking rate as UA/ha,
 * allowing pastures carrying animals of different sizes to be compared.
 */
export const ANIMAL_UNIT_KG = 450;

/**
 * One arroba is 15 kg of *carcass* weight, not live weight.
 *
 * Cattle in Brazil are priced per arroba of carcass, so converting a live
 * weight to arrobas requires the carcass yield:
 *   arrobas = live_weight_kg * (carcass_yield_pct / 100) / 15
 */
export const ARROBA_KG = 15;

/** Horizon for the "a vencer" card, in days. */
export const UPCOMING_WINDOW_DAYS = 30;

/**
 * An active animal not weighed within this many days is flagged.
 *
 * Sixty days is roughly one weighing cycle: the demo operation weighs every
 * 60-90 days, so passing sixty means a cycle was likely missed.
 */
export const STALE_WEIGHING_DAYS = 60;

/**
 * Minimum weighings required for an animal to contribute to average daily gain.
 *
 * Gain is a rate between two points, so one weighing yields no rate at all.
 * Such an animal is excluded from the average - not counted as zero, which
 * would drag the herd figure down and misrepresent performance.
 */
export const MIN_WEIGHINGS_FOR_GMD = 2;

/**
 * How many trailing months the dashboard's time-series charts cover
 * (Evolução do peso médio, Curva de GMD, Custos por categoria).
 *
 * Deliberately independent of the Período KPI filter (Fase 5): a "últimos 30
 * dias" window would leave a monthly-bucketed line chart with one or two
 * points, which communicates nothing. A fixed trailing window is the standard
 * choice for a trend chart and is not expected to track a single-value KPI's
 * date filter.
 */
export const CHART_TREND_MONTHS = 12;

/**
 * Age thresholds, in whole months, used to classify an animal into the herd
 * composition chart's five categories: bezerro (<12m), novilha/boi (12-36m,
 * by sex), vaca/touro (>36m, by sex).
 *
 * This classification uses age only. A real herd's category also depends on
 * reproductive status - whether a female has calved, whether a male is used
 * for breeding - which this schema does not track. The approximation is
 * stated here rather than hidden, so it can be defended as a scoping decision
 * rather than mistaken for an oversight.
 */
export const CALF_MAX_AGE_MONTHS = 12;
export const YOUNG_MAX_AGE_MONTHS = 36;
