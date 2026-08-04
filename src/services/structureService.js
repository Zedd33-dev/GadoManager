/**
 * Validation for the herd-structure modules: Fazendas, Lotes and Pastos.
 *
 * Grouped into one module because the three are small, share the same shape
 * (a name, a few optional numbers, an active flag) and are edited by the same
 * kind of screen. Splitting them into three near-identical files would add
 * indirection without adding clarity.
 */

/** Brazilian state abbreviations, for the Fazenda form's UF field. */
export const BRAZILIAN_STATES = Object.freeze([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/**
 * Parses a pt-BR decimal ("12,5") into a number.
 *
 * @param {unknown} input
 * @returns {number|null}
 */
function parseDecimal(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (trimmed === '') return null;

  // Same rule as parseWeight / parseCurrencyToCents: only treat dots as
  // thousands separators when a comma is present to act as the decimal point.
  const normalized = trimmed.includes(',')
    ? trimmed.replace(/\./g, '').replace(',', '.')
    : trimmed;

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * @returns {{ok: true, data: object} | {ok: false, errors: Record<string, string>}}
 */
export function validateFarmInput(input) {
  const errors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Informe o nome da fazenda.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  const city = typeof input.city === 'string' && input.city.trim() !== '' ? input.city.trim() : null;

  let state = null;
  if (typeof input.state === 'string' && input.state.trim() !== '') {
    const candidate = input.state.trim().toUpperCase();
    if (!BRAZILIAN_STATES.includes(candidate)) errors.state = 'UF inválida.';
    else state = candidate;
  }

  let totalAreaHa = null;
  if (typeof input.totalAreaHa === 'string' && input.totalAreaHa.trim() !== '') {
    totalAreaHa = parseDecimal(input.totalAreaHa);
    if (totalAreaHa === null || totalAreaHa <= 0) {
      errors.totalAreaHa = 'A área total deve ser um número maior que zero.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name, city, state, totalAreaHa } };
}

/**
 * @param {object} input
 * @param {{isDeactivating: boolean, occupantCount: number}} context
 */
export function validateLotInput(input, context) {
  const errors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Informe o nome do lote.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  const description =
    typeof input.description === 'string' && input.description.trim() !== ''
      ? input.description.trim().slice(0, 500)
      : null;

  const active = input.active === 'on' || input.active === true || input.active === '1';

  // Deactivating a lot that still holds animals would leave those animals
  // pointing at something the interface no longer offers - they would keep
  // their lot_id but vanish from every lot-based filter and chart. The lot
  // must be emptied first, via Movimentações.
  if (context.isDeactivating && context.occupantCount > 0) {
    errors.active =
      `Este lote ainda contém ${context.occupantCount} animal(is) ativo(s). ` +
      'Movimente-os para outro lote antes de desativá-lo.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name, description, active } };
}

/**
 * @param {object} input
 * @param {{isDeactivating: boolean, occupantCount: number}} context
 */
export function validatePastureInput(input, context) {
  const errors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Informe o nome do pasto.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  // Area is the denominator of the stocking rate, so it is required and must
  // be strictly positive - a zero would make UA/ha meaningless.
  const areaHa = parseDecimal(input.areaHa);
  if (areaHa === null) errors.areaHa = 'Informe a área do pasto em hectares.';
  else if (areaHa <= 0) errors.areaHa = 'A área deve ser maior que zero.';

  const forageType =
    typeof input.forageType === 'string' && input.forageType.trim() !== ''
      ? input.forageType.trim().slice(0, 120)
      : null;

  let restPeriodDays = null;
  if (typeof input.restPeriodDays === 'string' && input.restPeriodDays.trim() !== '') {
    const parsed = Number.parseInt(input.restPeriodDays, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      errors.restPeriodDays = 'O período de descanso deve ser um número de dias válido.';
    } else {
      restPeriodDays = parsed;
    }
  }

  let maxStockingRateUaHa = null;
  if (typeof input.maxStockingRateUaHa === 'string' && input.maxStockingRateUaHa.trim() !== '') {
    maxStockingRateUaHa = parseDecimal(input.maxStockingRateUaHa);
    if (maxStockingRateUaHa === null || maxStockingRateUaHa <= 0) {
      errors.maxStockingRateUaHa = 'A capacidade de suporte deve ser maior que zero.';
    }
  }

  const active = input.active === 'on' || input.active === true || input.active === '1';

  if (context.isDeactivating && context.occupantCount > 0) {
    errors.active =
      `Este pasto ainda contém ${context.occupantCount} animal(is) ativo(s). ` +
      'Movimente-os para outro pasto antes de desativá-lo.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, data: { name, areaHa, forageType, restPeriodDays, maxStockingRateUaHa, active } };
}
