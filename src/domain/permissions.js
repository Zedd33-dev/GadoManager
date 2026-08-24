/**
 * Role and capability model.
 *
 * Authorization is expressed as an explicit capability matrix rather than as
 * `if (user.role === 'admin')` checks scattered through route handlers. There is
 * one table to read when answering "who can do what", and adding a capability
 * cannot silently widen an existing role.
 *
 * Hiding a button is presentation, not access control. Every capability here is
 * enforced server-side by `requireCapability` before any handler runs.
 */

/** The three roles specified for the system. */
export const ROLES = Object.freeze({
  ADMIN: 'admin',
  MANAGER: 'gerente',
  FIELD_HAND: 'peao',
});

/** Human-readable labels for the interface (pt-BR). */
export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Administrador',
  [ROLES.MANAGER]: 'Gerente',
  [ROLES.FIELD_HAND]: 'Peão',
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

const { ADMIN, MANAGER, FIELD_HAND } = ROLES;

/**
 * capability -> roles permitted to exercise it.
 *
 * The shape of the peao role is the interesting part: it can record what happens
 * in the field - weighings, and the application of a dose that was already
 * scheduled - but it cannot decide the sanitary calendar, register a sale, enter
 * a cost, or alter the herd structure.
 */
export const CAPABILITIES = Object.freeze({
  // Reading operational data. Everyone who can log in can see the herd.
  'animals:read': [ADMIN, MANAGER, FIELD_HAND],
  'weighings:read': [ADMIN, MANAGER, FIELD_HAND],
  'health:read': [ADMIN, MANAGER, FIELD_HAND],
  'reminders:read': [ADMIN, MANAGER, FIELD_HAND],
  'dashboard:read': [ADMIN, MANAGER, FIELD_HAND],

  // Field work: what a peao is employed to record.
  'weighings:write': [ADMIN, MANAGER, FIELD_HAND],
  'health:apply': [ADMIN, MANAGER, FIELD_HAND],
  'reminders:complete': [ADMIN, MANAGER, FIELD_HAND],

  // Operational management.
  'animals:write': [ADMIN, MANAGER],
  'health:schedule': [ADMIN, MANAGER],
  'protocols:write': [ADMIN, MANAGER],
  'movements:write': [ADMIN, MANAGER],
  'lots:write': [ADMIN, MANAGER],
  'pastures:write': [ADMIN, MANAGER],
  'reminders:write': [ADMIN, MANAGER],

  // Commercial and financial data.
  'sales:read': [ADMIN, MANAGER],
  'sales:write': [ADMIN, MANAGER],
  'costs:read': [ADMIN, MANAGER],
  'costs:write': [ADMIN, MANAGER],

  // Structural: creating the fazenda a gerente will run. A self-registered
  // account is granted the gerente role with zero farms (see routes/auth.js)
  // specifically so it can create its own farm here rather than waiting on
  // an admin - creating a farm grants its creator access to it in the same
  // transaction (farmRepository.insertFarmForUser), which is what actually
  // bootstraps a brand new account into having anything to manage.
  'farms:write': [ADMIN, MANAGER],

  // Destructive and system-wide operations. Deleting an animal is permanent;
  // managing users reaches every account in the system, not just the
  // caller's own farms - both stay admin-only.
  'animals:delete': [ADMIN],
  'users:manage': [ADMIN],
});

/**
 * Answers whether a role may exercise a capability.
 *
 * An unknown capability returns false rather than throwing, so that a typo in a
 * route definition fails closed - denying access - instead of crashing the
 * request and, worse, instead of allowing it.
 *
 * @param {string} role
 * @param {string} capability
 * @returns {boolean}
 */
export function can(role, capability) {
  const allowed = CAPABILITIES[capability];
  if (!allowed) return false;
  return allowed.includes(role);
}

/**
 * Lists every capability a role holds. Used to expose a permission set to views
 * so templates can hide controls the user could not use anyway.
 *
 * @param {string} role
 * @returns {Set<string>}
 */
export function capabilitiesFor(role) {
  return new Set(
    Object.entries(CAPABILITIES)
      .filter(([, roles]) => roles.includes(role))
      .map(([capability]) => capability),
  );
}
