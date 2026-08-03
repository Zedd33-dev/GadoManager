/**
 * Tests for the role capability matrix.
 *
 * The shape being asserted is the one specified for the system: admin has
 * everything, gerente runs operations, peao records field work only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROLES, CAPABILITIES, can, capabilitiesFor } from '../../src/domain/permissions.js';

const { ADMIN, MANAGER, FIELD_HAND } = ROLES;

test('admin holds every capability', () => {
  for (const capability of Object.keys(CAPABILITIES)) {
    assert.ok(can(ADMIN, capability), `admin should hold ${capability}`);
  }
});

test('peao may record field work', () => {
  assert.ok(can(FIELD_HAND, 'weighings:write'));
  assert.ok(can(FIELD_HAND, 'health:apply'));
  assert.ok(can(FIELD_HAND, 'animals:read'));
  assert.ok(can(FIELD_HAND, 'reminders:complete'));
});

test('peao may not manage the herd, money or the sanitary calendar', () => {
  assert.equal(can(FIELD_HAND, 'animals:write'), false);
  assert.equal(can(FIELD_HAND, 'animals:delete'), false);
  assert.equal(can(FIELD_HAND, 'health:schedule'), false);
  assert.equal(can(FIELD_HAND, 'sales:write'), false);
  assert.equal(can(FIELD_HAND, 'sales:read'), false);
  assert.equal(can(FIELD_HAND, 'costs:read'), false);
  assert.equal(can(FIELD_HAND, 'costs:write'), false);
  assert.equal(can(FIELD_HAND, 'farms:write'), false);
  assert.equal(can(FIELD_HAND, 'users:manage'), false);
});

test('gerente runs operations but not administration', () => {
  assert.ok(can(MANAGER, 'animals:write'));
  assert.ok(can(MANAGER, 'health:schedule'));
  assert.ok(can(MANAGER, 'sales:write'));
  assert.ok(can(MANAGER, 'costs:write'));
  assert.ok(can(MANAGER, 'movements:write'));

  assert.equal(can(MANAGER, 'farms:write'), false);
  assert.equal(can(MANAGER, 'users:manage'), false);
  assert.equal(can(MANAGER, 'animals:delete'), false);
});

test('an unknown capability is denied to everyone', () => {
  // Fails closed: a typo in a route definition must deny access, never grant it.
  for (const role of [ADMIN, MANAGER, FIELD_HAND]) {
    assert.equal(can(role, 'capability:does-not-exist'), false);
    assert.equal(can(role, ''), false);
    assert.equal(can(role, undefined), false);
  }
});

test('an unknown role is denied every capability', () => {
  for (const capability of Object.keys(CAPABILITIES)) {
    assert.equal(can('proprietario', capability), false);
    assert.equal(can(undefined, capability), false);
  }
});

test('capabilitiesFor reports a strictly widening set by seniority', () => {
  const fieldHand = capabilitiesFor(FIELD_HAND);
  const manager = capabilitiesFor(MANAGER);
  const admin = capabilitiesFor(ADMIN);

  for (const capability of fieldHand) {
    assert.ok(manager.has(capability), `gerente should also hold ${capability}`);
  }
  for (const capability of manager) {
    assert.ok(admin.has(capability), `admin should also hold ${capability}`);
  }

  assert.ok(fieldHand.size < manager.size);
  assert.ok(manager.size < admin.size);
});
