import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, insertFarm } from '../helpers/testDb.js';
import {
  listCategories,
  insertCostBatch,
  listCosts,
  countCosts,
  updateCost,
  deleteCost,
  findCostInScope,
} from '../../src/repositories/costRepository.js';
import {
  insertReminder,
  listReminders,
  listUpcoming,
  setReminderDone,
  findReminderInScope,
} from '../../src/repositories/reminderRepository.js';
import { resolveSort } from '../../src/lib/sorting.js';
import { COST_SORT_COLUMNS } from '../../src/repositories/costRepository.js';

const sortByDate = resolveSort(COST_SORT_COLUMNS, { defaultKey: 'costDate' }, { dir: 'desc' });

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

test('the five cost categories seeded in migration 003 are all present', () => {
  const db = createTestDb();
  assert.equal(listCategories(db).length, 5);
  db.close();
});

test('insertCostBatch writes one row for a non-recurring cost', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const count = insertCostBatch(
    db, farmId,
    { lotId: null, categorySlug: 'alimentacao', amountCents: 150000, description: 'Sal mineral', isRecurring: false, recurrenceMonths: null },
    [{ costDate: '2026-07-01' }],
    null,
  );

  assert.equal(count, 1);
  assert.equal(countCosts(db, [farmId]), 1);

  db.close();
});

test('insertCostBatch writes every occurrence of a recurring cost in one transaction', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const occurrences = [{ costDate: '2026-07-01' }, { costDate: '2026-08-01' }, { costDate: '2026-09-01' }];
  const count = insertCostBatch(
    db, farmId,
    { lotId: null, categorySlug: 'mao_de_obra', amountCents: 800000, description: 'Aluguel', isRecurring: true, recurrenceMonths: 1 },
    occurrences,
    null,
  );

  assert.equal(count, 3);
  assert.equal(countCosts(db, [farmId]), 3);

  const rows = listCosts(db, [farmId], { sort: resolveSort(COST_SORT_COLUMNS, { defaultKey: 'costDate' }, { dir: 'asc' }), limit: 10, offset: 0 });
  assert.deepEqual(rows.map((r) => r.cost_date), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.ok(rows.every((r) => r.is_recurring === 1));

  db.close();
});

test('costs are scoped, and update/delete outside scope report no change', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  insertCostBatch(
    db, otherFarm,
    { lotId: null, categorySlug: 'outros', amountCents: 50000, description: null, isRecurring: false, recurrenceMonths: null },
    [{ costDate: '2026-07-01' }],
    null,
  );
  const foreignId = db.prepare('SELECT id FROM costs LIMIT 1').get().id;

  assert.equal(findCostInScope(db, [myFarm], foreignId), undefined);
  assert.equal(
    updateCost(db, [myFarm], foreignId, { lotId: null, categorySlug: 'outros', costDate: '2026-08-01', amountCents: 1, description: null }),
    false,
  );
  assert.equal(deleteCost(db, [myFarm], foreignId), false);
  assert.equal(countCosts(db, [otherFarm]), 1, 'the foreign row must survive both attempts');

  db.close();
});

test('the category filter narrows the list', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  insertCostBatch(db, farmId, { lotId: null, categorySlug: 'alimentacao', amountCents: 100000, description: null, isRecurring: false, recurrenceMonths: null }, [{ costDate: '2026-07-01' }], null);
  insertCostBatch(db, farmId, { lotId: null, categorySlug: 'sanidade', amountCents: 50000, description: null, isRecurring: false, recurrenceMonths: null }, [{ costDate: '2026-07-02' }], null);

  assert.equal(countCosts(db, [farmId], { categorySlug: 'alimentacao' }), 1);

  db.close();
});

// ---------------------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------------------

test('a reminder can be created, listed, and marked done', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const id = insertReminder(
    db, farmId,
    { title: 'Pesagem geral', description: null, dueDate: '2026-08-10', assignedUserId: null, recurrence: 'mensal' },
    null,
  );

  assert.equal(listReminders(db, [farmId]).length, 1);

  assert.equal(setReminderDone(db, [farmId], id, true), true);
  assert.ok(findReminderInScope(db, [farmId], id).done_at);

  assert.equal(setReminderDone(db, [farmId], id, false), true);
  assert.equal(findReminderInScope(db, [farmId], id).done_at, null, 'reopening clears done_at');

  db.close();
});

test('listReminders filters by pending/done status', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  const pending = insertReminder(db, farmId, { title: 'A', description: null, dueDate: '2026-08-10', assignedUserId: null, recurrence: 'nenhuma' }, null);
  const done = insertReminder(db, farmId, { title: 'B', description: null, dueDate: '2026-08-05', assignedUserId: null, recurrence: 'nenhuma' }, null);
  setReminderDone(db, [farmId], done, true);

  assert.deepEqual(listReminders(db, [farmId], { status: 'pendente' }).map((r) => r.id), [pending]);
  assert.deepEqual(listReminders(db, [farmId], { status: 'concluido' }).map((r) => r.id), [done]);

  db.close();
});

test('listUpcoming returns only open reminders due within the window, soonest first', () => {
  const db = createTestDb();
  const farmId = insertFarm(db);

  insertReminder(db, farmId, { title: 'Distante', description: null, dueDate: '2026-12-01', assignedUserId: null, recurrence: 'nenhuma' }, null);
  const soon = insertReminder(db, farmId, { title: 'Logo', description: null, dueDate: '2026-08-05', assignedUserId: null, recurrence: 'nenhuma' }, null);
  const overdue = insertReminder(db, farmId, { title: 'Atrasado', description: null, dueDate: '2026-08-01', assignedUserId: null, recurrence: 'nenhuma' }, null);
  const doneOne = insertReminder(db, farmId, { title: 'Feito', description: null, dueDate: '2026-08-02', assignedUserId: null, recurrence: 'nenhuma' }, null);
  setReminderDone(db, [farmId], doneOne, true);

  const upcoming = listUpcoming(db, [farmId], { until: '2026-08-10', limit: 5 });

  assert.deepEqual(upcoming.map((r) => r.id), [overdue, soon], 'overdue and near-term only, soonest first, done excluded');

  db.close();
});

test('reminders are scoped to the caller\'s farms', () => {
  const db = createTestDb();
  const myFarm = insertFarm(db, { name: 'Minha' });
  const otherFarm = insertFarm(db, { name: 'Alheia' });

  const foreignId = insertReminder(db, otherFarm, { title: 'X', description: null, dueDate: '2026-08-10', assignedUserId: null, recurrence: 'nenhuma' }, null);

  assert.equal(findReminderInScope(db, [myFarm], foreignId), undefined);
  assert.equal(setReminderDone(db, [myFarm], foreignId, true), false);
  assert.deepEqual(listReminders(db, [myFarm]), []);

  db.close();
});
