import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm, insertAnimal } from '../helpers/testDb.js';
import {
  insertSale,
  listSales,
  listSaleItems,
  findSaleInScope,
  farmCostSummary,
} from '../../src/repositories/saleRepository.js';
import { resolveSort } from '../../src/lib/sorting.js';
import { SALE_SORT_COLUMNS } from '../../src/repositories/saleRepository.js';

const NOW = '2026-08-03T12:00:00.000Z';
const sortByDate = resolveSort(SALE_SORT_COLUMNS, { defaultKey: 'saleDate' }, { dir: 'desc' });

function saleHeader(overrides = {}) {
  return {
    buyerName: 'Frigorífico Teste',
    saleDate: '2026-08-01',
    pricePerArrobaCents: 32000,
    notes: null,
    createdBy: null,
    ...overrides,
  };
}

test('insertSale writes the header, the items, and marks each animal vendido together', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animal = insertAnimal(db, farmId, { ear_tag: 'BV-0001' });

  const saleId = insertSale(db, farmId, saleHeader(), [
    { animalId: animal, liveWeightKg: 510, carcassYieldPct: 54, arrobas: 18.36, grossValueCents: 587520 },
  ]);

  const sale = findSaleInScope(db, [farmId], saleId);
  assert.equal(sale.buyer_name, 'Frigorífico Teste');

  const items = listSaleItems(db, saleId);
  assert.equal(items.length, 1);
  assert.equal(items[0].gross_value_cents, 587520);

  const status = db.prepare('SELECT status FROM animals WHERE id = ?').get(animal).status;
  assert.equal(status, 'vendido', 'the sale and the status change happen together');

  db.close();
});

test('a sale with multiple animals marks every one of them sold', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });

  insertSale(db, farmId, saleHeader(), [
    { animalId: a, liveWeightKg: 500, carcassYieldPct: 53, arrobas: 17.67, grossValueCents: 565440 },
    { animalId: b, liveWeightKg: 480, carcassYieldPct: 55, arrobas: 17.6, grossValueCents: 563200 },
  ]);

  assert.equal(db.prepare("SELECT COUNT(*) c FROM animals WHERE status='vendido'").get().c, 2);

  db.close();
});

test('the schema refuses a second sale of the same animal, and nothing from that attempt is written', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const animal = insertAnimal(db, farmId, { ear_tag: 'BV-0001' });

  insertSale(db, farmId, saleHeader({ saleDate: '2026-07-01' }), [
    { animalId: animal, liveWeightKg: 500, carcassYieldPct: 53, arrobas: 17.67, grossValueCents: 565440 },
  ]);

  // sale_items.animal_id is UNIQUE - a second sale of the same animal must fail
  // and must not silently succeed as a duplicate entry.
  assert.throws(() =>
    insertSale(db, farmId, saleHeader({ saleDate: '2026-08-01', buyerName: 'Outro Comprador' }), [
      { animalId: animal, liveWeightKg: 510, carcassYieldPct: 54, arrobas: 18.36, grossValueCents: 587520 },
    ]),
  );

  assert.equal(db.prepare('SELECT COUNT(*) c FROM sales').get().c, 1, 'the second sale header must not persist');

  db.close();
});

test('listSales aggregates the item count and total value per sale', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const a = insertAnimal(db, farmId, { ear_tag: 'A' });
  const b = insertAnimal(db, farmId, { ear_tag: 'B' });

  insertSale(db, farmId, saleHeader(), [
    { animalId: a, liveWeightKg: 500, carcassYieldPct: 53, arrobas: 17.67, grossValueCents: 500000 },
    { animalId: b, liveWeightKg: 480, carcassYieldPct: 55, arrobas: 17.6, grossValueCents: 400000 },
  ]);

  const [row] = listSales(db, [farmId], { sort: sortByDate, limit: 10, offset: 0 });

  assert.equal(row.animal_count, 2);
  assert.equal(row.total_value_cents, 900000);

  db.close();
});

test('sales are scoped to the caller\'s farms', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });
  const foreignAnimal = insertAnimal(db, otherFarm, { ear_tag: 'X' });

  const foreignSaleId = insertSale(db, otherFarm, saleHeader(), [
    { animalId: foreignAnimal, liveWeightKg: 500, carcassYieldPct: 53, arrobas: 17.67, grossValueCents: 500000 },
  ]);

  assert.equal(findSaleInScope(db, [myFarm], foreignSaleId), undefined);
  assert.deepEqual(listSales(db, [myFarm], { sort: sortByDate, limit: 10, offset: 0 }), []);

  db.close();
});

test('farmCostSummary sums costs within the date range for the given farm only', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);
  const otherFarm = insertFarm(db, { name: 'Outra' });
  const categoryId = db.prepare("SELECT id FROM cost_categories WHERE slug='alimentacao'").get().id;

  const insertCost = (farm, date, cents) =>
    db.prepare(
      `INSERT INTO costs (farm_id, category_id, cost_date, amount_cents, is_recurring, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
    ).run(farm, categoryId, date, cents, NOW, NOW);

  insertCost(farmId, '2026-06-01', 100000);
  insertCost(farmId, '2026-07-01', 100000);
  insertCost(farmId, '2026-09-01', 999999); // outside range
  insertCost(otherFarm, '2026-06-15', 555555); // different farm

  insertAnimal(db, farmId, { ear_tag: 'A', status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: 'B', status: 'ativo' });
  insertAnimal(db, farmId, { ear_tag: 'C', status: 'vendido' });

  const summary = farmCostSummary(db, farmId, '2026-06-01', '2026-08-01');

  assert.equal(summary.totalCostsCents, 200000);
  assert.equal(summary.averageActiveAnimals, 2, 'only active animals on this farm count');

  db.close();
});
