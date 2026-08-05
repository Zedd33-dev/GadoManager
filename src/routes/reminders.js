/**
 * Lembretes.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { HttpError } from '../middleware/errors.js';
import { todayIso } from '../lib/dates.js';
import {
  listReminders,
  findReminderInScope,
  insertReminder,
  updateReminder,
  setReminderDone,
} from '../repositories/reminderRepository.js';
import { validateReminderInput, nextOccurrence } from '../services/reminderService.js';

const router = Router();

router.get('/lembretes', requireCapability('reminders:read'), (req, res) => {
  const db = getDb();
  const status = ['pendente', 'concluido'].includes(req.query.status) ? req.query.status : 'pendente';

  res.render('reminders/index', {
    title: 'Lembretes',
    status,
    reminders: listReminders(db, req.scope.effectiveFarmIds, { status }),
    today: todayIso(),
  });
});

router.get('/lembretes/novo', requireCapability('reminders:write'), (req, res) => {
  res.render('reminders/form', {
    title: 'Novo lembrete',
    isCreate: true,
    reminder: null,
    values: { dueDate: todayIso(), recurrence: 'nenhuma' },
    errors: {},
  });
});

router.post('/lembretes', requireCapability('reminders:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const farmId = farmIds[0];
  if (!farmId) return next(new HttpError(400, 'Nenhuma fazenda disponível.'));

  const result = validateReminderInput(req.body);
  if (!result.ok) {
    return res.status(400).render('reminders/form', {
      title: 'Novo lembrete', isCreate: true, reminder: null, values: req.body, errors: result.errors,
    });
  }

  insertReminder(db, farmId, result.data, req.user.id);
  setFlash(req, 'success', 'Lembrete criado.');
  return res.redirect('/lembretes');
});

router.get('/lembretes/:id/editar', requireCapability('reminders:write'), (req, res, next) => {
  const db = getDb();
  const reminder = findReminderInScope(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10));
  if (!reminder) return next(new HttpError(404, 'Lembrete não encontrado.'));

  res.render('reminders/form', {
    title: 'Editar lembrete',
    isCreate: false,
    reminder,
    values: {
      title: reminder.title, description: reminder.description, dueDate: reminder.due_date,
      recurrence: reminder.recurrence, assignedUserId: reminder.assigned_user_id,
    },
    errors: {},
  });
});

router.post('/lembretes/:id/editar', requireCapability('reminders:write'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const reminderId = Number.parseInt(req.params.id, 10);
  const reminder = findReminderInScope(db, farmIds, reminderId);
  if (!reminder) return next(new HttpError(404, 'Lembrete não encontrado.'));

  const result = validateReminderInput(req.body);
  if (!result.ok) {
    return res.status(400).render('reminders/form', {
      title: 'Editar lembrete', isCreate: false, reminder, values: req.body, errors: result.errors,
    });
  }

  updateReminder(db, farmIds, reminderId, result.data);
  setFlash(req, 'success', 'Lembrete atualizado.');
  return res.redirect('/lembretes');
});

router.post('/lembretes/:id/concluir', requireCapability('reminders:complete'), (req, res, next) => {
  const db = getDb();
  const farmIds = req.scope.effectiveFarmIds;
  const reminderId = Number.parseInt(req.params.id, 10);
  const reminder = findReminderInScope(db, farmIds, reminderId);
  if (!reminder) return next(new HttpError(404, 'Lembrete não encontrado.'));

  setReminderDone(db, farmIds, reminderId, true);

  // A recurring reminder regenerates one open occurrence rather than being
  // pre-generated for every future date - see nextOccurrence's own docs.
  //
  // Named nextDueDate, not next: this handler's own Express `next` callback
  // is already in scope, and shadowing it with a `const next` declared later
  // in the same function would throw a ReferenceError on the earlier
  // next(new HttpError(...)) call above, since `const` is hoisted with a
  // temporal dead zone for the whole enclosing function.
  const nextDueDate = nextOccurrence(reminder.due_date, reminder.recurrence);
  if (nextDueDate) {
    insertReminder(
      db, reminder.farm_id,
      { title: reminder.title, description: reminder.description, dueDate: nextDueDate, assignedUserId: reminder.assigned_user_id, recurrence: reminder.recurrence },
      req.user.id,
    );
  }

  setFlash(req, 'success', nextDueDate ? `Concluído. Próxima ocorrência em ${nextDueDate}.` : 'Lembrete concluído.');
  return res.redirect('/lembretes');
});

router.post('/lembretes/:id/reabrir', requireCapability('reminders:complete'), (req, res, next) => {
  const db = getDb();
  const removed = setReminderDone(db, req.scope.effectiveFarmIds, Number.parseInt(req.params.id, 10), false);
  if (!removed) return next(new HttpError(404, 'Lembrete não encontrado.'));

  setFlash(req, 'success', 'Lembrete reaberto.');
  return res.redirect('/lembretes?status=pendente');
});

export default router;
