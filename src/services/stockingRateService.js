/**
 * Stocking rate (taxa de lotação) in UA/ha.
 *
 *   UA total = Σ (peso vivo de cada animal no pasto) ÷ 450
 *   taxa     = UA total ÷ área do pasto em hectares
 *
 * One animal unit (UA) is 450 kg of live weight, the Brazilian convention.
 * Expressing stocking as UA/ha rather than head/ha is what lets pastures
 * carrying different-sized animals be compared: forty 225 kg calves and twenty
 * 450 kg steers are both 20 UA.
 *
 * The honest-denominator problem
 * ------------------------------
 * Live weight comes from each animal's most recent weighing, and some animals
 * have never been weighed (the demo seed deliberately contains three). Those
 * animals occupy the pasture and eat its forage, but contribute no measurable
 * weight.
 *
 * Three options existed: exclude them (understating the real rate), estimate
 * their weight from the herd average (inventing data), or compute from the
 * animals that *do* have a weight and report how many were left out. This
 * module does the third. The figure is therefore a lower bound, and every
 * caller receives `animalsWithoutWeight` so the interface can say so rather
 * than presenting an underestimate as fact - the same "report the population
 * the average was computed over" rule the Phase 4 KPIs follow.
 */

import { ANIMAL_UNIT_KG } from '../domain/constants.js';
import { safeDivide } from '../lib/safeMath.js';

/**
 * Computes the stocking rate for one pasture.
 *
 * @param {object} pasture
 * @param {number} pasture.areaHa
 * @param {number|null} pasture.maxStockingRateUaHa informed capacity, or null
 * @param {number} pasture.totalWeightKg summed live weight of weighed animals
 * @param {number} pasture.animalsWithWeight
 * @param {number} pasture.animalsWithoutWeight
 * @returns {{
 *   animalUnits: number|null,
 *   stockingRate: number|null,
 *   isUnderestimate: boolean,
 *   status: 'sem-dados'|'sem-capacidade'|'adequada'|'atencao'|'excedida',
 *   usagePercent: number|null,
 * }}
 */
export function calculatePastureStockingRate(pasture) {
  const {
    areaHa,
    maxStockingRateUaHa,
    totalWeightKg,
    animalsWithWeight,
    animalsWithoutWeight,
  } = pasture;

  const animalUnits = animalsWithWeight > 0 ? safeDivide(totalWeightKg, ANIMAL_UNIT_KG) : null;
  const stockingRate = animalUnits === null ? null : safeDivide(animalUnits, areaHa);

  // A pasture with animals but no weighings has a real but unknown rate; one
  // with no animals at all has a genuine rate of zero. Distinguishing them
  // matters, so the first reports null and the second reports 0.
  const isEmpty = animalsWithWeight === 0 && animalsWithoutWeight === 0;
  const resolvedUnits = isEmpty ? 0 : animalUnits;
  const resolvedRate = isEmpty ? 0 : stockingRate;

  if (resolvedRate === null) {
    return {
      animalUnits: null,
      stockingRate: null,
      isUnderestimate: false,
      status: 'sem-dados',
      usagePercent: null,
    };
  }

  const isUnderestimate = animalsWithoutWeight > 0;

  if (maxStockingRateUaHa === null || maxStockingRateUaHa === undefined) {
    return {
      animalUnits: resolvedUnits,
      stockingRate: resolvedRate,
      isUnderestimate,
      status: 'sem-capacidade',
      usagePercent: null,
    };
  }

  const usagePercent = safeDivide(resolvedRate, maxStockingRateUaHa) * 100;

  // Deliberately three bands rather than a boolean: a pasture at 95% of
  // capacity is not overgrazed, but it is the one to move animals out of
  // first, and a warning that only appears after the damage is done is of
  // limited use to whoever has to act on it.
  let status = 'adequada';
  if (resolvedRate > maxStockingRateUaHa) status = 'excedida';
  else if (usagePercent >= 90) status = 'atencao';

  return {
    animalUnits: resolvedUnits,
    stockingRate: resolvedRate,
    isUnderestimate,
    status,
    usagePercent,
  };
}

/** Human-readable pt-BR labels for each status. */
export const STOCKING_STATUS_LABELS = Object.freeze({
  'sem-dados': 'Sem pesagens',
  'sem-capacidade': 'Capacidade não informada',
  adequada: 'Adequada',
  atencao: 'Próxima do limite',
  excedida: 'Acima da capacidade',
});

/** The semantic colour each status maps to in the interface. */
export const STOCKING_STATUS_VARIANTS = Object.freeze({
  'sem-dados': 'warning',
  'sem-capacidade': 'info',
  adequada: 'success',
  atencao: 'warning',
  excedida: 'danger',
});
