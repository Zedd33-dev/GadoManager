/**
 * Movement (movimentação) rules.
 *
 * A movement is two facts that must never disagree: a historical record of
 * where an animal went, and the animal's current location. `animals.lot_id`
 * and `animals.pasture_id` are a deliberate denormalisation (see migration
 * 001) so the dashboard can filter by lote without a correlated subquery over
 * the whole movement history - which means every movement has to write both
 * in one transaction. That is issue DAT-04, and the repository is where the
 * transaction lives; this module decides whether the move is legal at all.
 */

import { isValidIsoDate, todayIso } from '../lib/dates.js';

/**
 * Validates a proposed movement.
 *
 * @param {object} input raw form fields
 * @param {object} context
 * @param {number[]} context.scopeFarmIds every farm the caller may address
 * @param {Map<number, object>} context.lotsById scoped lots, keyed by id
 * @param {Map<number, object>} context.pasturesById scoped pastures, keyed by id
 * @param {Array<object>} context.animals the animals being moved, already scoped
 * @param {string} [context.today]
 */
export function validateMovement(input, context) {
  const errors = {};
  const today = context.today ?? todayIso();

  const movedAt = typeof input.movedAt === 'string' ? input.movedAt : '';
  if (!isValidIsoDate(movedAt)) {
    errors.movedAt = 'Informe uma data de movimentação válida.';
  } else if (movedAt > today) {
    errors.movedAt = 'A movimentação não pode ter data futura.';
  }

  if (!Array.isArray(context.animals) || context.animals.length === 0) {
    errors.animals = 'Selecione ao menos um animal para movimentar.';
  }

  // A destination lot and a destination pasture are each optional on their
  // own, but a movement that changes neither is not a movement.
  const hasLot = typeof input.toLotId === 'string' && input.toLotId !== '';
  const hasPasture = typeof input.toPastureId === 'string' && input.toPastureId !== '';

  if (!hasLot && !hasPasture) {
    errors.destination = 'Informe o lote de destino, o pasto de destino, ou ambos.';
  }

  let toLotId = null;
  if (hasLot) {
    const parsed = Number.parseInt(input.toLotId, 10);
    if (!Number.isInteger(parsed) || !context.lotsById.has(parsed)) {
      errors.toLotId = 'Lote de destino inválido.';
    } else {
      toLotId = parsed;
    }
  }

  let toPastureId = null;
  if (hasPasture) {
    const parsed = Number.parseInt(input.toPastureId, 10);
    if (!Number.isInteger(parsed) || !context.pasturesById.has(parsed)) {
      errors.toPastureId = 'Pasto de destino inválido.';
    } else {
      toPastureId = parsed;
    }
  }

  // The destination lot and pasture must belong to the same farm, otherwise
  // the animal would end up in a lote on one property and a paddock on
  // another - a state the interface offers no way to reach deliberately.
  const destinationFarmIds = new Set();
  if (toLotId !== null) destinationFarmIds.add(context.lotsById.get(toLotId).farm_id);
  if (toPastureId !== null) destinationFarmIds.add(context.pasturesById.get(toPastureId).farm_id);

  if (destinationFarmIds.size > 1) {
    errors.destination = 'O lote e o pasto de destino pertencem a fazendas diferentes.';
  }

  const destinationFarmId = destinationFarmIds.size === 1 ? [...destinationFarmIds][0] : null;

  // Moving between farms is legitimate - the demo herd does exactly that when
  // young stock goes to the finishing operation - but only within the caller's
  // own scope, and only if the ear tag stays unique on the destination farm,
  // which the schema enforces per farm.
  const crossFarmAnimals =
    destinationFarmId === null
      ? []
      : context.animals.filter((animal) => animal.farm_id !== destinationFarmId);

  if (destinationFarmId !== null && !context.scopeFarmIds.includes(destinationFarmId)) {
    errors.destination = 'Você não tem acesso à fazenda de destino.';
  }

  const reason =
    typeof input.reason === 'string' && input.reason.trim() !== ''
      ? input.reason.trim().slice(0, 200)
      : null;

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      movedAt,
      toLotId,
      toPastureId,
      destinationFarmId,
      reason,
      crossFarmAnimalIds: crossFarmAnimals.map((a) => a.id),
    },
  };
}
