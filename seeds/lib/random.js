/**
 * Deterministic pseudo-random number generation for the demo seed.
 *
 * Seeded on purpose: `npm run seed` must produce the same herd every time. A
 * dataset that changes between runs would make screenshots in the written
 * thesis disagree with the running system, and would make a defect found during
 * the defense impossible to reproduce.
 *
 * mulberry32 is used because it is eight lines, has no dependencies and is
 * more than adequate for generating plausible cattle - this is demo data, not
 * cryptography.
 */

/**
 * Creates a deterministic generator from a numeric seed.
 *
 * @param {number} seed
 * @returns {() => number} a function returning a float in [0, 1)
 */
export function createRandom(seed) {
  let state = seed >>> 0;

  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds the family of helpers used throughout the seed.
 *
 * @param {number} seed
 */
export function createGenerator(seed) {
  const random = createRandom(seed);

  /**
   * Random float in [min, max).
   */
  const float = (min, max) => min + random() * (max - min);

  /**
   * Random integer in [min, max], inclusive at both ends.
   */
  const int = (min, max) => Math.floor(float(min, max + 1));

  /**
   * Picks one element of an array.
   */
  const pick = (items) => items[Math.floor(random() * items.length)];

  /**
   * Picks one element using relative weights.
   *
   * @param {Array<[unknown, number]>} weighted pairs of [value, weight]
   */
  const pickWeighted = (weighted) => {
    const total = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    let threshold = random() * total;

    for (const [value, weight] of weighted) {
      threshold -= weight;
      if (threshold <= 0) return value;
    }

    return weighted[weighted.length - 1][0];
  };

  /**
   * True with the given probability.
   */
  const chance = (probability) => random() < probability;

  /**
   * Approximately normal deviate, via the sum of three uniforms.
   *
   * Used for individual animal variation: real herds cluster around a mean with
   * tails, rather than spreading uniformly.
   */
  const gaussian = (mean, standardDeviation) => {
    const sum = random() + random() + random();
    return mean + ((sum - 1.5) / 0.5) * standardDeviation;
  };

  /**
   * Returns a shuffled copy, using Fisher-Yates.
   */
  const shuffle = (items) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  return { random, float, int, pick, pickWeighted, chance, gaussian, shuffle };
}
