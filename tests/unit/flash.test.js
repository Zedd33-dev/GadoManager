/**
 * Tests for the one-time flash message middleware.
 *
 * The property that matters: a message set on the session is read exactly
 * once. Without the delete, a browser refresh would keep re-showing a stale
 * "Bem-vindo(a)" toast forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flashMiddleware, setFlash } from '../../src/middleware/flash.js';

function fakeReqRes(session) {
  return { req: { session }, res: { locals: {} } };
}

test('a queued message is exposed on res.locals.flash', () => {
  const { req, res } = fakeReqRes({ flash: { type: 'success', message: 'Olá' } });

  flashMiddleware(req, res, () => {});

  assert.deepEqual(res.locals.flash, { type: 'success', message: 'Olá' });
});

test('the message is removed from the session after being read', () => {
  const session = { flash: { type: 'success', message: 'Olá' } };
  const { req, res } = fakeReqRes(session);

  flashMiddleware(req, res, () => {});

  assert.equal(session.flash, undefined, 'a second read must not see the same message');
});

test('no message queued renders as null, not undefined or an error', () => {
  const { req, res } = fakeReqRes({});

  flashMiddleware(req, res, () => {});

  assert.equal(res.locals.flash, null);
});

test('a request with no session at all does not throw', () => {
  const { req, res } = fakeReqRes(undefined);

  assert.doesNotThrow(() => flashMiddleware(req, res, () => {}));
  assert.equal(res.locals.flash, null);
});

test('always calls next()', () => {
  const { req, res } = fakeReqRes({});
  let calls = 0;

  flashMiddleware(req, res, () => {
    calls += 1;
  });

  assert.equal(calls, 1);
});

test('setFlash queues a message for the next render', () => {
  const req = { session: {} };

  setFlash(req, 'success', 'Bem-vindo(a), Ana.');

  assert.deepEqual(req.session.flash, { type: 'success', message: 'Bem-vindo(a), Ana.' });
});

test('setFlash does nothing when there is no session, rather than throwing', () => {
  const req = { session: undefined };

  assert.doesNotThrow(() => setFlash(req, 'success', 'Olá'));
});

test('setFlash then flashMiddleware round-trips the exact message', () => {
  const req = { session: {} };
  setFlash(req, 'danger', 'Algo deu errado.');

  const res = { locals: {} };
  flashMiddleware(req, res, () => {});

  assert.deepEqual(res.locals.flash, { type: 'danger', message: 'Algo deu errado.' });
  assert.equal(req.session.flash, undefined);
});
