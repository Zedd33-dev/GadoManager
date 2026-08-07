/**
 * Route authorization audit.
 *
 * Phase 12. Every previous check that "every route is guarded" was a manual
 * grep - true at the moment someone ran it, and silently false the next time
 * a route was added. This walks Express's own router stack instead, so the
 * claim is re-verified on every `npm test` run and a new unguarded route
 * fails the build rather than shipping.
 *
 * Two things are asserted per route:
 *
 *  1. It carries a `requireCapability` guard, unless it is on the explicit
 *     public allow-list below. The allow-list is deliberately a literal list
 *     of paths rather than a pattern - a rule like "anything under /auth" is
 *     exactly the kind of thing that quietly widens later.
 *
 *  2. The capability it names actually exists in the permission matrix. A
 *     typo there fails closed (see `can()`), which is safe but silent: the
 *     route would deny *everyone*, including admins, and nobody would find
 *     out until a user reported that a screen "does nothing".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import animalRoutes from '../../src/routes/animals.js';
import authRoutes from '../../src/routes/auth.js';
import costRoutes from '../../src/routes/costs.js';
import healthRoutes from '../../src/routes/health.js';
import healthcheckRoutes from '../../src/routes/healthcheck.js';
import homeRoutes from '../../src/routes/home.js';
import movementRoutes from '../../src/routes/movements.js';
import reminderRoutes from '../../src/routes/reminders.js';
import reportRoutes from '../../src/routes/reports.js';
import saleRoutes from '../../src/routes/sales.js';
import structureRoutes from '../../src/routes/structure.js';
import userRoutes from '../../src/routes/users.js';
import weighingRoutes from '../../src/routes/weighings.js';

import { CAPABILITIES } from '../../src/domain/permissions.js';

/**
 * Every router the application mounts. Kept in sync with `src/app.js` by the
 * first test below, which fails if a router file exists that this list does
 * not name - otherwise a whole new module could be added and audited by
 * nobody.
 */
const ROUTERS = {
  'animals.js': animalRoutes,
  'auth.js': authRoutes,
  'costs.js': costRoutes,
  'health.js': healthRoutes,
  'healthcheck.js': healthcheckRoutes,
  'home.js': homeRoutes,
  'movements.js': movementRoutes,
  'reminders.js': reminderRoutes,
  'reports.js': reportRoutes,
  'sales.js': saleRoutes,
  'structure.js': structureRoutes,
  'users.js': userRoutes,
  'weighings.js': weighingRoutes,
};

/**
 * Routes that are intentionally reachable without a capability.
 *
 * Every one of these is public *by design* and the reason is stated, because
 * "why is this one exempt" is precisely the question this file exists to
 * answer for a reader who is checking the authorization story.
 */
const PUBLIC_ROUTES = new Map([
  ['GET /login', 'the login form itself - unreachable if it required a session'],
  ['POST /login', 'authenticates; there is no user to check a capability against yet'],
  ['GET /registrar', 'public self-registration form'],
  ['POST /registrar', 'creates the account; same reason as POST /login'],
  ['POST /logout', 'ends a session; must work even for a session already half-invalid'],
  ['GET /health', 'liveness probe, scraped by a process manager that has no login'],
]);

/** Flattens one router into `{ method, path, capabilities[] }` rows. */
function routesOf(router) {
  const rows = [];

  for (const layer of router.stack) {
    if (!layer.route) continue;

    const capabilities = layer.route.stack
      .map((handlerLayer) => handlerLayer.handle.capability)
      .filter((capability) => capability !== undefined);

    for (const method of Object.keys(layer.route.methods)) {
      rows.push({ method: method.toUpperCase(), path: layer.route.path, capabilities });
    }
  }

  return rows;
}

function allRoutes() {
  return Object.entries(ROUTERS).flatMap(([file, router]) =>
    routesOf(router).map((route) => ({ ...route, file })),
  );
}

test('the audited router list covers every file in src/routes', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { ROOT_DIR } = await import('../../src/config/env.js');

  const onDisk = fs
    .readdirSync(path.join(ROOT_DIR, 'src', 'routes'))
    .filter((name) => name.endsWith('.js'))
    .sort();

  assert.deepEqual(
    onDisk,
    Object.keys(ROUTERS).sort(),
    'a route file exists that this audit does not import - add it to ROUTERS',
  );
});

test('every route either carries a capability guard or is explicitly public', () => {
  const unguarded = allRoutes()
    .filter((route) => route.capabilities.length === 0)
    .filter((route) => !PUBLIC_ROUTES.has(`${route.method} ${route.path}`));

  assert.deepEqual(
    unguarded.map((r) => `${r.method} ${r.path} (${r.file})`),
    [],
    'these routes are reachable by any logged-in user regardless of role',
  );
});

test('every capability named on a route exists in the permission matrix', () => {
  const known = new Set(Object.keys(CAPABILITIES));

  const unknown = allRoutes().flatMap((route) =>
    route.capabilities
      .filter((capability) => !known.has(capability))
      .map((capability) => `${route.method} ${route.path} -> "${capability}"`),
  );

  // `can()` fails closed on an unknown capability, so a typo here does not
  // open a hole - it silently seals the route shut for everyone, including
  // an admin, which is a bug that would otherwise surface only as a user
  // complaint that the screen does nothing.
  assert.deepEqual(unknown, [], 'route names a capability that does not exist');
});

test('the public allow-list contains no route that has since been removed', () => {
  const existing = new Set(allRoutes().map((route) => `${route.method} ${route.path}`));

  const stale = [...PUBLIC_ROUTES.keys()].filter((entry) => !existing.has(entry));

  // A stale exemption is dead weight that makes the allow-list less
  // trustworthy to read: the next person cannot tell which entries still
  // describe something real.
  assert.deepEqual(stale, [], 'allow-list names a route that no longer exists');
});

test('every state-changing route requires a write-ish capability, not merely a read one', () => {
  // A POST guarded only by a `:read` capability would let a peao (who holds
  // every `:read`) perform an action the role was never meant to perform.
  // This does not check *which* write capability - only that a mutation is
  // never gated behind read permission alone.
  const readOnly = new Set(Object.keys(CAPABILITIES).filter((c) => c.endsWith(':read')));

  const offenders = allRoutes()
    .filter((route) => route.method === 'POST')
    .filter((route) => !PUBLIC_ROUTES.has(`${route.method} ${route.path}`))
    .filter((route) => route.capabilities.length > 0)
    .filter((route) => route.capabilities.every((capability) => readOnly.has(capability)))
    .map((route) => `${route.method} ${route.path} (${route.file})`);

  assert.deepEqual(offenders, [], 'a mutation is gated behind a read-only capability');
});
