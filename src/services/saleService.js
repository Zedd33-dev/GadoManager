/**
 * Vendas: arroba conversion, sale validation, and profit per animal.
 *
 * On "profit per animal computed against accumulated costs"
 * ------------------------------------------------------------------
 * A precise cost trace would need each animal's month-by-month lot history
 * cross-referenced against every cost entry allocated to that lot in that
 * month - reconstructable from `movements`, but a lot of machinery for a
 * figure that is, in the end, still an allocation rather than a measurement
 * (feed is not metered per animal). Instead this module computes the farm's
 * **average monthly cost per active animal** over a trailing window and
 * multiplies it by the animal's tenure in months. This is a real accounting
 * technique (full-cost per animal-month) and is explicit about what it is:
 * `estimatedAccumulatedCostCents` in every return value, and the interface
 * labels it "custo médio estimado", never "custo real". It treats a calf and
 * a finishing steer as costing the same per month, which is the
 * simplification a lot-precise trace would avoid - stated here rather than
 * hidden.
 */

import { isValidIsoDate, todayIso, daysBetween } from '../lib/dates.js';
import { safeDivide } from '../lib/safeMath.js';
import { ARROBA_KG } from '../domain/constants.js';

/** Average days in a month, for converting a tenure in days to months. */
const DAYS_PER_MONTH = 30.4368;

/**
 * Converts a live weight and carcass yield into arrobas of carcass, and the
 * gross value at a given price per arroba.
 *
 *   arrobas = peso_vivo_kg * (rendimento_% / 100) / 15
 *   valor   = arrobas * preço_por_arroba
 *
 * @param {number} liveWeightKg
 * @param {number} carcassYieldPct 0-100
 * @param {number} pricePerArrobaCents
 * @returns {{arrobas: number, grossValueCents: number}}
 */
export function calculateSaleValue(liveWeightKg, carcassYieldPct, pricePerArrobaCents) {
  const carcassWeightKg = liveWeightKg * (carcassYieldPct / 100);
  const arrobas = Math.round((carcassWeightKg / ARROBA_KG) * 100) / 100;
  const grossValueCents = Math.round(arrobas * pricePerArrobaCents);

  return { arrobas, grossValueCents };
}

/**
 * Estimates what an animal cost the farm to keep, for the profit-per-animal
 * figure. See the module header for what this is and is not.
 *
 * @param {object} params
 * @param {string} params.originDate birth_date or purchase_date
 * @param {string} params.saleDate
 * @param {number|null} params.purchasePriceCents
 * @param {number} params.farmTotalCostsCents costs on this farm over the reference window
 * @param {number} params.farmAverageActiveAnimals average active headcount over that same window
 * @returns {{tenureMonths: number, monthlyCostPerAnimalCents: number|null, estimatedAccumulatedCostCents: number}}
 */
export function estimateAccumulatedCost({
  originDate,
  saleDate,
  purchasePriceCents,
  farmTotalCostsCents,
  farmAverageActiveAnimals,
}) {
  const tenureDays = Math.max(0, daysBetween(originDate, saleDate));
  const tenureMonths = tenureDays / DAYS_PER_MONTH;

  const monthlyCostPerAnimalCents = safeDivide(farmTotalCostsCents, farmAverageActiveAnimals);

  const upkeepCents =
    monthlyCostPerAnimalCents === null ? 0 : Math.round(monthlyCostPerAnimalCents * tenureMonths);

  return {
    tenureMonths,
    monthlyCostPerAnimalCents,
    estimatedAccumulatedCostCents: (purchasePriceCents ?? 0) + upkeepCents,
  };
}

/**
 * Validates one sale item (one animal within a sale).
 *
 * @param {object} input
 * @param {{status: string, id: number, ear_tag: string}} animal already scope-checked
 * @param {{isUnderWithdrawal: boolean, releaseDate: string|null}} withdrawal
 */
export function validateSaleItem(input, animal, withdrawal) {
  const errors = {};

  if (animal.status !== 'ativo') {
    errors.animal = `${animal.ear_tag} não está ativo e não pode ser vendido novamente.`;
  }

  // The rule the brief explicitly asks for: an animal in carência cannot be
  // sold before the withdrawal period ends. Checked here, not just displayed
  // as a warning on the animal page, because a sale is exactly the action the
  // rule exists to block.
  if (withdrawal?.isUnderWithdrawal) {
    errors.animal =
      `${animal.ear_tag} está em período de carência até ${withdrawal.releaseDate} ` +
      `(${withdrawal.blockingEventName}) e não pode ser vendido antes dessa data.`;
  }

  const liveWeightKg = Number.parseFloat(String(input.liveWeightKg).replace(',', '.'));
  if (!Number.isFinite(liveWeightKg) || liveWeightKg <= 0) {
    errors.liveWeightKg = 'Informe o peso vivo no momento da venda.';
  }

  const carcassYieldPct = Number.parseFloat(String(input.carcassYieldPct).replace(',', '.'));
  if (!Number.isFinite(carcassYieldPct) || carcassYieldPct < 40 || carcassYieldPct > 65) {
    errors.carcassYieldPct = 'O rendimento de carcaça deve estar entre 40% e 65%.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { liveWeightKg, carcassYieldPct } };
}

/**
 * Validates the sale header.
 */
export function validateSaleHeader(input, { today = todayIso(), hasItems = true } = {}) {
  const errors = {};

  const buyerName = typeof input.buyerName === 'string' ? input.buyerName.trim() : '';
  if (!buyerName) errors.buyerName = 'Informe o comprador.';
  else if (buyerName.length > 120) errors.buyerName = 'O nome do comprador deve ter no máximo 120 caracteres.';

  const saleDate = typeof input.saleDate === 'string' ? input.saleDate : '';
  if (!isValidIsoDate(saleDate)) errors.saleDate = 'Informe uma data de venda válida.';
  else if (saleDate > today) errors.saleDate = 'A venda não pode ter data futura.';

  const pricePerArroba = Number.parseFloat(String(input.pricePerArroba ?? '').replace(',', '.'));
  const pricePerArrobaCents = Math.round(pricePerArroba * 100);
  if (!Number.isFinite(pricePerArroba) || pricePerArroba <= 0) {
    errors.pricePerArroba = 'Informe o preço por arroba.';
  }

  if (!hasItems) errors.items = 'Selecione ao menos um animal para vender.';

  const notes =
    typeof input.notes === 'string' && input.notes.trim() !== '' ? input.notes.trim().slice(0, 500) : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { buyerName, saleDate, pricePerArrobaCents, notes } };
}
