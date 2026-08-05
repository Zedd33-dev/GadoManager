import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistrationInput, validateRoleInput } from '../../src/services/userAdminService.js';

function validInput(overrides = {}) {
  return {
    name: 'Maria Silva',
    email: 'maria@example.com',
    password: 'senha1234',
    confirmPassword: 'senha1234',
    ...overrides,
  };
}

test('a valid registration passes and normalises the email', () => {
  const result = validateRegistrationInput(validInput({ email: '  Maria@Example.com  ' }), { emailTaken: false });

  assert.equal(result.ok, true);
  assert.equal(result.data.email, 'maria@example.com');
  assert.equal(result.data.name, 'Maria Silva');
});

test('name is required', () => {
  assert.ok(validateRegistrationInput(validInput({ name: '' }), { emailTaken: false }).errors.name);
  assert.ok(validateRegistrationInput(validInput({ name: '   ' }), { emailTaken: false }).errors.name);
});

test('email must look like an email', () => {
  assert.ok(validateRegistrationInput(validInput({ email: 'not-an-email' }), { emailTaken: false }).errors.email);
});

test('a taken email is rejected without leaking why elsewhere', () => {
  const result = validateRegistrationInput(validInput(), { emailTaken: true });
  assert.ok(result.errors.email);
});

test('password must meet the minimum length', () => {
  assert.ok(
    validateRegistrationInput(validInput({ password: 'short', confirmPassword: 'short' }), { emailTaken: false })
      .errors.password,
  );
});

test('password confirmation must match', () => {
  const result = validateRegistrationInput(validInput({ confirmPassword: 'different1' }), { emailTaken: false });
  assert.ok(result.errors.confirmPassword);
});

test('a mismatched confirmation is not reported when the password itself is already invalid', () => {
  // Avoids stacking two errors on the same underlying problem.
  const result = validateRegistrationInput(
    validInput({ password: 'short', confirmPassword: 'alsoShort' }),
    { emailTaken: false },
  );
  assert.ok(result.errors.password);
  assert.equal(result.errors.confirmPassword, undefined);
});

test('role must be one of the three known roles', () => {
  assert.equal(validateRoleInput({ role: 'admin' }).ok, true);
  assert.equal(validateRoleInput({ role: 'gerente' }).ok, true);
  assert.equal(validateRoleInput({ role: 'peao' }).ok, true);
  assert.ok(validateRoleInput({ role: 'superadmin' }).errors.role);
  assert.ok(validateRoleInput({ role: '' }).errors.role);
});
