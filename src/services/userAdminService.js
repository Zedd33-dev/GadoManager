/**
 * Validation for self-registration and admin user management.
 *
 * Password hashing is deliberately not done here - it is async (Argon2id)
 * and this module stays synchronous like every other validate*Input
 * function, so the route hashes after validation passes.
 */

import { MIN_PASSWORD_LENGTH } from '../lib/password.js';
import { ALL_ROLES } from '../domain/permissions.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {Record<string, unknown>} input
 * @param {{emailTaken: boolean}} context whether the normalised email already
 *   belongs to an account - checked by the caller via a repository lookup,
 *   since this module has no database access.
 * @returns {{ok: true, data: {name: string, email: string, password: string}} | {ok: false, errors: Record<string, string>}}
 */
export function validateRegistrationInput(input, context) {
  const errors = {};

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) errors.name = 'Informe seu nome.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email) errors.email = 'Informe seu e-mail.';
  else if (!EMAIL_PATTERN.test(email)) errors.email = 'Informe um e-mail válido.';
  else if (email.length > 190) errors.email = 'O e-mail deve ter no máximo 190 caracteres.';
  else if (context.emailTaken) errors.email = 'Este e-mail já está cadastrado.';

  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.password = `A senha deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres.`;
  }

  const confirmPassword = typeof input.confirmPassword === 'string' ? input.confirmPassword : '';
  if (!errors.password && password !== confirmPassword) {
    errors.confirmPassword = 'As senhas não conferem.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, data: { name, email, password } };
}

/**
 * @param {Record<string, unknown>} input
 * @returns {{ok: true, data: {role: string}} | {ok: false, errors: Record<string, string>}}
 */
export function validateRoleInput(input) {
  const role = typeof input.role === 'string' ? input.role : '';
  if (!ALL_ROLES.includes(role)) return { ok: false, errors: { role: 'Selecione um cargo válido.' } };
  return { ok: true, data: { role } };
}
