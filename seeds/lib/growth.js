/**
 * Weight growth simulation for the demo herd.
 *
 * The demo data has to survive a thesis defense, which means the weight curves
 * must look like real cattle rather than a straight line with noise. Three
 * effects are modelled, all of them standard for pasture-raised beef cattle in
 * central Brazil:
 *
 *   Life phase   - fast gain while suckling, a slower store period during
 *                  recria, then rapid gain during finishing.
 *   Season       - forage quality collapses in the dry season (May-September).
 *                  Animals on pasture gain little, and the lightest can lose
 *                  weight. Animals on supplementation in the finishing lots feel
 *                  a damped version of the same curve.
 *   Individual   - a fixed per-animal factor, so the herd spreads around the
 *                  mean instead of moving as one block.
 *
 * The visible consequence is that the "Curva de GMD" chart shows a real seca
 * dip and the finishing lots outperform the pasture lots - which is the point of
 * having that chart at all.
 *
 * These are plausible figures for a demonstration dataset, not measurements.
 */

import { daysBetween, addDays, ageInMonths } from '../../src/lib/dates.js';

/** Birth weight in kilograms, by breed. */
const BIRTH_WEIGHT = { nelore: 30, angus: 33, cruzado: 32 };

/** Genetic gain modifier in kg/day, relative to Nelore. */
const BREED_GAIN_BONUS = { nelore: 0, angus: 0.12, cruzado: 0.07 };

/**
 * Mature weight ceiling in kilograms.
 *
 * Gain tapers smoothly as an animal approaches its ceiling, so nothing grows
 * without bound over an 18-month simulation.
 */
const MATURE_WEIGHT = {
  M: { nelore: 600, angus: 660, cruzado: 640 },
  F: { nelore: 490, angus: 540, cruzado: 515 },
};

/**
 * Forage quality by calendar month, as a multiplier on daily gain.
 *
 * July and August are the worst of the dry season; December and January are the
 * peak of the rains.
 */
const SEASON_FACTOR = {
  1: 1.25, 2: 1.20, 3: 1.15, 4: 0.95,
  5: 0.75, 6: 0.55, 7: 0.45, 8: 0.45, 9: 0.60,
  10: 1.05, 11: 1.20, 12: 1.25,
};

/**
 * Base daily gain in kg by life phase, before modifiers.
 *
 * @param {number} months age in whole months
 * @param {boolean} isFinishing whether the animal is in a finishing lot
 * @param {string} sex
 */
function baseGain(months, isFinishing, sex) {
  if (months < 8) return 0.72; // suckling, on the cow
  if (months < 18) return 0.45; // recria, store period on pasture
  if (isFinishing) return 0.92; // engorda, with supplementation

  // Adults that were never sent to finishing: breeding females sit near
  // maintenance, males keep growing slowly toward their ceiling.
  if (months >= 30) return sex === 'F' ? 0.05 : 0.30;
  return 0.48;
}

/**
 * Builds a day-by-day weight curve for one animal.
 *
 * Returns a lookup that answers "what did this animal weigh on this date",
 * which the seed then samples on weighing days.
 *
 * @param {object} animal
 * @param {string} animal.birthDate ISO
 * @param {string} animal.breed
 * @param {string} animal.sex
 * @param {boolean} animal.isFinishing
 * @param {number} animal.individualFactor typically 0.85 - 1.15
 * @param {string} endDate ISO, the last date to simulate
 * @returns {{weightOn: (iso: string) => number|null, finalWeight: number}}
 */
export function buildWeightCurve(animal, endDate) {
  const { birthDate, breed, sex, isFinishing, individualFactor } = animal;

  const totalDays = daysBetween(birthDate, endDate);
  if (totalDays < 0) return { weightOn: () => null, finalWeight: 0 };

  const ceiling = MATURE_WEIGHT[sex][breed];
  const weights = new Float64Array(totalDays + 1);

  weights[0] = BIRTH_WEIGHT[breed];

  for (let offset = 1; offset <= totalDays; offset += 1) {
    const date = addDays(birthDate, offset);
    const month = Number(date.slice(5, 7));
    const months = ageInMonths(birthDate, date);
    const previous = weights[offset - 1];

    let gain = baseGain(months, isFinishing, sex) + BREED_GAIN_BONUS[breed];

    // Seasonal forage quality. Supplemented animals feel a damped version.
    const season = SEASON_FACTOR[month];
    gain *= isFinishing ? 1 + (season - 1) * 0.4 : season;

    // Individual variation, fixed for the life of the animal.
    gain *= individualFactor;

    // Taper toward the mature ceiling so growth is asymptotic, not linear. The
    // high exponent keeps the taper from biting until the animal is genuinely
    // close to mature weight - a steer at 80% of its ceiling is still finishing
    // at full rate, which a gentler curve would wrongly suppress.
    const proximity = previous / ceiling;
    gain *= Math.max(0, 1 - proximity ** 6);

    // In the worst of the dry season a light animal on pasture genuinely loses
    // weight. Allowing this is what makes the outlier detection in Phase 9 have
    // something real to find.
    if (!isFinishing && season <= 0.5 && individualFactor < 0.95) {
      gain -= 0.12;
    }

    weights[offset] = Math.max(previous + gain, previous * 0.97);
  }

  return {
    /**
     * @param {string} iso
     * @returns {number|null} weight in kg, or null if outside the animal's life
     */
    weightOn(iso) {
      const offset = daysBetween(birthDate, iso);
      if (offset < 0 || offset > totalDays) return null;
      return weights[offset];
    },
    finalWeight: weights[totalDays],
  };
}
