/**
 * Usuários: admin-only account management.
 *
 * Deliberately no delete - a user row is referenced by health_events
 * (applicator_user_id), movements and other history tables, so removing one
 * would either orphan that history or cascade it away. Deactivating keeps
 * the record and its history intact while blocking login immediately (see
 * `setUserActive` and `loadUser`), the same pattern already used for
 * Fazendas/Lotes/Pastos.
 */

import { Router } from 'express';
import { getDb } from '../config/db.js';
import { requireCapability } from '../middleware/auth.js';
import { setFlash } from '../middleware/flash.js';
import { HttpError } from '../middleware/errors.js';
import {
  listAllUsers,
  findById,
  findFarmIdsForUser,
  updateUserRole,
  setUserActive,
  grantFarmAccess,
  revokeFarmAccess,
} from '../repositories/userRepository.js';
import { listAll as listAllFarms } from '../repositories/farmRepository.js';
import { validateRoleInput } from '../services/userAdminService.js';
import { ROLE_LABELS, ALL_ROLES } from '../domain/permissions.js';

const router = Router();

/** Normalises the submitted farmIds (a single value, an array, or absent) to a Set<number>. */
function parseFarmIds(input) {
  const raw = Array.isArray(input) ? input : input !== undefined ? [input] : [];
  return new Set(raw.map((value) => Number.parseInt(value, 10)).filter(Number.isInteger));
}

router.get('/usuarios', requireCapability('users:manage'), (req, res) => {
  res.render('users/index', {
    title: 'Usuários',
    users: listAllUsers(getDb()),
    roleLabels: ROLE_LABELS,
  });
});

router.get('/usuarios/:id/editar', requireCapability('users:manage'), (req, res, next) => {
  const db = getDb();
  const userId = Number.parseInt(req.params.id, 10);
  const user = findById(db, userId);
  if (!user) return next(new HttpError(404, 'Usuário não encontrado.'));

  const grantedFarmIds = new Set(findFarmIdsForUser(db, userId));

  res.render('users/form', {
    title: `Editar ${user.name}`,
    editedUser: user,
    isSelf: req.user.id === userId,
    errors: {},
    values: { role: user.role, active: user.active ? 'on' : '' },
    roles: ALL_ROLES,
    roleLabels: ROLE_LABELS,
    farms: listAllFarms(db),
    grantedFarmIds,
  });
});

router.post('/usuarios/:id/editar', requireCapability('users:manage'), (req, res, next) => {
  const db = getDb();
  const userId = Number.parseInt(req.params.id, 10);
  const user = findById(db, userId);
  if (!user) return next(new HttpError(404, 'Usuário não encontrado.'));

  const isSelf = req.user.id === userId;
  // The active checkbox is rendered `disabled` for isSelf (see form.ejs), and
  // a disabled control is never submitted by the browser - so `wantsActive`
  // is forced true here rather than read from req.body.active, which would
  // otherwise be undefined and misread as "unchecked" on every self-edit.
  const wantsActive = isSelf ? true : req.body.active === 'on';
  const result = validateRoleInput(req.body);
  const errors = result.ok ? {} : { ...result.errors };

  // An admin cannot demote their own account - otherwise a mistake here
  // could lock every admin out of the one screen that could undo it, since
  // granting the admin capability back would itself require the capability
  // being removed.
  if (isSelf && result.ok && result.data.role !== 'admin') {
    errors.role = 'Você não pode remover seu próprio cargo de administrador.';
  }

  if (Object.keys(errors).length > 0) {
    return res.status(400).render('users/form', {
      title: `Editar ${user.name}`,
      editedUser: user,
      isSelf,
      errors,
      values: req.body,
      roles: ALL_ROLES,
      roleLabels: ROLE_LABELS,
      farms: listAllFarms(db),
      grantedFarmIds: parseFarmIds(req.body.farmIds),
    });
  }

  const allFarmIds = listAllFarms(db).map((f) => f.id);
  const submittedFarmIds = parseFarmIds(req.body.farmIds);
  const currentFarmIds = new Set(findFarmIdsForUser(db, userId));

  for (const farmId of allFarmIds) {
    const shouldHaveAccess = submittedFarmIds.has(farmId);
    const hasAccess = currentFarmIds.has(farmId);
    if (shouldHaveAccess && !hasAccess) grantFarmAccess(db, userId, farmId);
    else if (!shouldHaveAccess && hasAccess) revokeFarmAccess(db, userId, farmId);
  }

  updateUserRole(db, userId, result.data.role);
  setUserActive(db, userId, wantsActive);

  setFlash(req, 'success', `Usuário ${user.name} atualizado.`);
  return res.redirect('/usuarios');
});

export default router;
