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
