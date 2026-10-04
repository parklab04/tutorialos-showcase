import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSession, createSession, requestHint } from '../../src/features/practice/session';

test('wrong control never advances or credits completion', () => {
  const initial = createSession('facetime-mic');
  assert.equal(advanceSession(initial, 'camera-off'), initial);
  assert.equal(advanceSession(initial, 'mic-on'), initial);
  assert.equal(initial.verification, null);
});
test('mute lesson requires a real off then on action in order', () => {
  const first = advanceSession(createSession('facetime-mic'), 'mic-off');
  assert.equal(first.complete, false);
  assert.equal(advanceSession(first, 'mic-off'), first);
  const done = advanceSession(first, 'mic-on');
  assert.equal(done.complete, true);
  assert.deepEqual(done.actions, ['mic-off', 'mic-on']);
  assert.equal(done.verification, 'practice-event');
  assert.equal(advanceSession(done, 'mic-off'), done);
});
test('Safari zoom cannot skip opening the menu', () => {
  const state = createSession('safari-zoom');
  assert.equal(advanceSession(state, 'zoom-in'), state);
  assert.equal(advanceSession(advanceSession(state, 'open-view-menu'), 'zoom-in').complete, true);
});
test('unassisted repeat resets outcome and exposes help only on request', () => {
  const state = createSession('finder-downloads', false);
  assert.equal(state.hints, false);
  assert.equal(state.verification, null);
  const assisted = requestHint(state);
  assert.equal(assisted.helpRequests, 1);
  assert.equal(assisted.hints, true);
  assert.equal(assisted.complete, false);
});
test('ending guide is not an end-call action', () => {
  const state = createSession('facetime-end');
  assert.equal(advanceSession(state, 'stop-guide'), state);
  assert.equal(advanceSession(state, 'end-call').complete, true);
});
