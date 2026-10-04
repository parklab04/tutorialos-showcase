import test from 'node:test';
import assert from 'node:assert/strict';
import { coachLayoutKey, CoachLayoutMeasurements, GuideFitHistory } from '../../electron/features/live-guide/fit-history';
import { intersects, placeGuideBubble, placePanel } from '../../electron/platform/placement';
import type { LiveState } from '../../src/features/live-guide/contracts';

const workArea = { x: 0, y: 33, width: 1512, height: 889 };
const contextWindow = { x: 16, y: 49, width: 1480, height: 857 };
const target = { x: 4, y: 215.5, width: 1504, height: 524 };
const context = { sessionId: 'fit-session', stepIndex: 0, currentAction: 'mic-toggle', scale: 1, workArea, contextWindow };

function position(height: number, actualTarget = target) {
  return placeGuideBubble(workArea, { width: 320, height }, actualTarget) ??
    placePanel(workArea, { width: 320, height }, contextWindow, [actualTarget]);
}

test('fallback height cannot repeatedly restore controls that make the same target impossible to fit', () => {
  // These are the packaged failure's actual bounds and measured heights.
  assert.equal(intersects(position(154), target), false);
  assert.equal(intersects(position(211), target), true);
  const fit = new GuideFitHistory();
  let required = fit.requiredHeight(context, target, 211);
  assert.equal(intersects(position(required), target), true);
  fit.reject(required);
  for (let publication = 0; publication < 40; publication++) {
    required = fit.requiredHeight(context, target, publication % 2 ? 211 : 154);
    assert.equal(required, 211, 'fallback ResizeObserver reports must not lower the guiding fit requirement');
    assert.equal(intersects(position(required), target), true);
    fit.reject(required);
  }
});

test('transient observation loss preserves only failed fit history, and a new target recovers', () => {
  const fit = new GuideFitHistory();
  fit.requiredHeight(context, target, 211); fit.reject(211);
  assert.equal(fit.requiredHeight(context, null, 154), 154, 'a waiting bubble still uses its own natural size');
  assert.equal(fit.hasFailedFit(), true, 'presenter can suppress old Complete during transient target loss');
  assert.equal(fit.requiredHeight(context, target, 154), 211);
  const moved = { ...target, y: target.y + 30 };
  assert.equal(fit.requiredHeight(context, moved, 154), 154);
  assert.equal(fit.hasFailedFit(), false);
});

test('fit history resets for meaningful session, action, scale, work-area or context changes', () => {
  for (const next of [
    { ...context, sessionId: 'next-session' },
    { ...context, stepIndex: 1 },
    { ...context, currentAction: 'camera-toggle' },
    { ...context, scale: 2 },
    { ...context, workArea: { ...workArea, x: -1512 } },
    { ...context, workArea: { ...workArea, height: 1024 } },
    { ...context, contextWindow: { ...contextWindow, x: 60 } },
    { ...context, contextWindow: { ...contextWindow, width: 1200 } },
  ]) {
    const fit = new GuideFitHistory();
    fit.requiredHeight(context, target, 211); fit.reject(211);
    assert.equal(fit.requiredHeight(next, target, 154), 154);
    assert.equal(fit.hasFailedFit(), false);
  }
});

test('fit requirements can grow, while explicit reset removes the prior session floor', () => {
  const fit = new GuideFitHistory();
  fit.requiredHeight(context, target, 211); fit.reject(211);
  assert.equal(fit.requiredHeight(context, target, 260), 260);
  fit.reject(260);
  assert.equal(fit.requiredHeight(context, target, 154), 260);
  fit.reset();
  assert.equal(fit.hasFailedFit(), false);
  assert.equal(fit.requiredHeight(context, target, 154), 154);
});

const guiding: LiveState = {
  sessionId: 'measuring-session', lessonId: 'facetime-mic', status: 'guiding', stepIndex: 0,
  currentAction: 'mic-toggle', title: 'Mute my microphone', message: 'Click microphone', why: '',
  target, contextWindow, observationSource: 'accessibility', verification: null,
  goal: { id: 'mute', app: 'facetime', label: 'Mute my microphone' }, completionMode: 'manual',
  canComplete: true, canConfirm: false, permission: { accessibility: true, screenCapture: false },
};

test('expanded recovery height cannot become the first guiding measurement or a fit floor', () => {
  const measurements = new CoachLayoutMeasurements();
  const recoveryKey = coachLayoutKey({ ...guiding, status: 'permission', target: null, canComplete: false }, 360, 1);
  const normalKey = coachLayoutKey(guiding, 320, 1);
  const recoveryId = measurements.select(recoveryKey);
  assert.equal(measurements.accept(recoveryId, 400), true);
  assert.equal(measurements.height(normalKey), undefined, 'unknown normal content must be measured hidden first');
  const guidingId = measurements.select(normalKey);
  assert.equal(measurements.accept(recoveryId, 3000), false, 'late recovery report is an ignored no-op');
  assert.equal(measurements.height(normalKey), undefined);
  assert.equal(measurements.accept(guidingId, 211), true);
  assert.equal(measurements.height(normalKey), 211);
  // A stale expanded height would reject this target, but actual normal
  // content fits. Only the latter is permitted to enter the fit calculation.
  const smallerTarget = { ...target, y: 390, height: 140 };
  assert.equal(intersects(position(400, smallerTarget), smallerTarget), true);
  assert.equal(intersects(position(measurements.height(normalKey)!, smallerTarget), smallerTarget), false);
});

test('fallback measurements cannot replace cached normal content for the same geometry', () => {
  const measurements = new CoachLayoutMeasurements();
  const normalKey = coachLayoutKey(guiding, 320, 1);
  const guidingId = measurements.select(normalKey);
  measurements.accept(guidingId, 211);
  const fallbackKey = coachLayoutKey({ ...guiding, status: 'waiting-control', target: null, canComplete: false, message: 'Make room for help.' }, 320, 1);
  const fallbackId = measurements.select(fallbackKey);
  measurements.accept(fallbackId, 154);
  assert.equal(measurements.height(normalKey), 211);
  assert.equal(measurements.height(fallbackKey), 154);
  assert.equal(measurements.accept(guidingId, 3000), false);
  assert.equal(measurements.height(normalKey), 211);
});

test('previous-session measurements are invalidated without recycling their token', () => {
  const measurements = new CoachLayoutMeasurements();
  const previousId = measurements.select(coachLayoutKey(guiding, 320, 1));
  measurements.accept(previousId, 400);
  measurements.reset();
  const nextKey = coachLayoutKey({ ...guiding, sessionId: 'new-session' }, 320, 1);
  const nextId = measurements.select(nextKey);
  assert.notEqual(nextId, previousId);
  assert.equal(measurements.accept(previousId, 3000), false);
  assert.equal(measurements.height(nextKey), undefined);
  measurements.accept(nextId, 211);
  assert.equal(measurements.height(nextKey), 211);
});

test('content measurement identity survives geometry changes but changes with actual layout inputs', () => {
  const key = coachLayoutKey(guiding, 320, 1);
  assert.equal(coachLayoutKey({ ...guiding, target: { ...target, x: 800 }, contextWindow: { ...contextWindow, x: 400 } }, 320, 1), key);
  for (const next of [
    { ...guiding, sessionId: 'new' }, { ...guiding, stepIndex: 1 }, { ...guiding, currentAction: 'camera-toggle' },
    { ...guiding, title: 'Click camera' }, { ...guiding, message: 'Different explanation' },
    { ...guiding, why: 'New reason' }, { ...guiding, canComplete: false },
    { ...guiding, canConfirm: true }, { ...guiding, status: 'permission' as const },
    { ...guiding, permission: { accessibility: false, screenCapture: false } },
  ]) assert.notEqual(coachLayoutKey(next, 320, 1), key);
  assert.notEqual(coachLayoutKey(guiding, 640, 2), key);
  assert.notEqual(coachLayoutKey(guiding, 300, 1), key);
});
