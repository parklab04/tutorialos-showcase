import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine } from '../../electron/features/live-guide/live-engine';
import type { LiveState, Observation, ObservedElement } from '../../src/features/live-guide/contracts';
import type { VoiceGoal, VoiceGoalId } from '../../src/features/voice-guide/contracts';

const windowRect = { x: 100, y: 80, width: 1000, height: 650 };
const goals: Record<VoiceGoalId, VoiceGoal> = {
  mute: { id: 'mute', label: 'Mute microphone', app: 'facetime' },
  unmute: { id: 'unmute', label: 'Unmute microphone', app: 'facetime' },
  'camera-off': { id: 'camera-off', label: 'Turn camera off', app: 'facetime' },
  'camera-on': { id: 'camera-on', label: 'Turn camera on', app: 'facetime' },
  'zoom-in': { id: 'zoom-in', label: 'Make text larger', app: 'safari' },
};
const element = (label: string, extra: Partial<ObservedElement> = {}): ObservedElement => ({ id: label, label, role: 'AXButton', enabled: true, rect: { x: 200, y: 400, width: 40, height: 40 }, ...extra });
const end = element('End', { rect: { x: 800, y: 400, width: 40, height: 40 } });
const media = (kind: 'microphone' | 'camera', value = '0', extra: Partial<ObservedElement> = {}): ObservedElement => element(kind === 'microphone' ? 'Microphone' : 'Camera', {
  role: 'AXCheckBox', subrole: 'AXSwitch', nativeIdentifier: kind === 'microphone' ? 'toggleMicMenuButton' : 'toggleVideoButton', value, ...extra,
});
const ft = (elements: ObservedElement[], extra: Partial<Observation> = {}): Observation => ({
  trusted: true, screenCapture: true, frontmostBundleId: 'com.apple.FaceTime', frontmostName: 'FaceTime',
  observedBundleId: 'com.apple.FaceTime', source: 'accessibility', timestamp: Date.now(), window: windowRect,
  windowId: '42:88', controlVisibility: { microphone: 'visible', camera: 'visible', end: 'visible' }, elements: [...elements, end], ...extra,
});
const view = element('View', { role: 'AXMenuBarItem', rect: { x: 200, y: 0, width: 50, height: 24 } });
const zoom = element('Zoom In', { role: 'AXMenuItem', rect: { x: 200, y: 220, width: 160, height: 24 } });
const safari = (elements: ObservedElement[], extra: Partial<Observation> = {}): Observation => ({
  trusted: true, screenCapture: true, frontmostBundleId: 'com.apple.Safari', frontmostName: 'Safari',
  source: 'accessibility', timestamp: Date.now(), window: windowRect, windowId: '12:16', elements, ...extra,
});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(id: VoiceGoalId, initial: Observation) {
  let current = initial; let stamp = Date.now(); let rawTimestamp = false;
  const states: LiveState[] = [];
  const engine = new LiveEngine(async () => ({ ...current, timestamp: rawTimestamp ? current.timestamp : ++stamp }), state => states.push(state), 100000);
  engine.startGoal(goals[id]);
  return { engine, states, set: (next: Observation) => { current = next; rawTimestamp = false; },
    tick: async (next: Observation, preserveTimestamp = false) => { current = next; rawTimestamp = preserveTimestamp; await engine.poll(); } };
}

test('all FaceTime voice goals guide one real switch and only explicit Complete finishes', async t => {
  for (const id of ['mute', 'unmute', 'camera-off', 'camera-on'] as const) {
    const kind = id.startsWith('camera') ? 'camera' : 'microphone';
    const h = harness(id, ft([media(kind)])); t.after(() => h.engine.stop()); await settle();
    assert.deepEqual(h.engine.getState().goal, goals[id]);
    assert.equal(h.engine.getState().completionMode, 'manual');
    assert.equal(h.engine.getState().canComplete, true);
    assert.deepEqual(h.engine.getState().target, media(kind).rect);
    assert.equal(h.engine.getState().title, goals[id].label);
    assert.match(h.engine.getState().message, /change its setting/);
    for (const value of ['1', '0', '1']) {
      await h.tick(ft([media(kind, value)]));
      assert.equal(h.engine.getState().status, 'guiding');
      assert.equal(h.engine.getState().stepIndex, 0);
      assert.equal(h.engine.getState().verification, null);
      assert.doesNotMatch(h.engine.getState().title, /again/);
    }
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    h.engine.completeGoal();
    assert.equal(h.engine.getState().status, 'complete');
    assert.equal(h.engine.getState().verification, 'self-confirmed');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, false);
    await h.tick(ft([media(kind)])); assert.equal(h.engine.getState().status, 'complete');
  }
});

test('legacy action labels respect requested direction and already-desired states require no extra click', async t => {
  for (const [id, action, opposite] of [
    ['mute', 'Mute', 'Unmute'], ['unmute', 'Unmute', 'Mute'],
    ['camera-off', 'Turn Camera Off', 'Turn Camera On'], ['camera-on', 'Turn Camera On', 'Turn Camera Off'],
  ] as const) {
    const h = harness(id, ft([element(action)])); t.after(() => h.engine.stop()); await settle();
    assert.deepEqual(h.engine.getState().target, element(action).rect);
    assert.equal(h.engine.getState().canComplete, true);
    await h.tick(ft([element(opposite)]));
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, true);
    assert.match(h.engine.getState().message, /No click needed/);
    assert.notEqual(h.engine.getState().status, 'complete');
    const already = harness(id, ft([element(opposite)])); t.after(() => already.engine.stop()); await settle();
    assert.equal(already.engine.getState().target, null);
    assert.equal(already.engine.getState().canComplete, true);
    already.engine.completeGoal(); assert.equal(already.engine.getState().verification, 'self-confirmed');
  }
});

test('missing, ambiguous, disabled, malformed or unknown switches cannot enable completion or fake coordinates', async t => {
  for (const elements of [
    [], [media('microphone', '2')], [media('microphone', '0', { value: undefined })],
    [media('microphone', '0', { enabled: false })], [media('microphone', '0', { subrole: undefined })],
    [media('microphone'), media('microphone', '1')],
    [media('microphone', '0', { rect: { x: 20, y: 400, width: 40, height: 40 } })],
    [media('microphone', '0', { rect: { x: 200, y: 400, width: NaN, height: 40 } })],
    [element('Mute'), element('Unmute')], [element('Mute', { role: 'AXStaticText' })],
  ]) {
    const h = harness('mute', ft(elements)); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, false);
    h.engine.completeGoal(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('goal mode keeps real permission, app, call identity, visibility and timestamp gates', async t => {
  for (const extra of [
    { trusted: false }, { source: 'ocr' as const }, { source: 'none' as const },
    { window: null }, { windowId: undefined }, { observedBundleId: undefined },
    { observedBundleId: 'com.apple.Safari' }, { controlVisibility: undefined },
    { frontmostBundleId: 'com.apple.Safari', observedBundleId: undefined },
    { controlVisibility: { microphone: 'covered', camera: 'visible', end: 'visible' } as const },
    { controlVisibility: { microphone: 'missing', camera: 'visible', end: 'visible' } as const },
  ]) {
    const h = harness('mute', ft([media('microphone')], extra)); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null, JSON.stringify(extra));
    assert.equal(h.engine.getState().canComplete, false, JSON.stringify(extra));
  }
  const h = harness('mute', ft([])); t.after(() => h.engine.stop()); await settle();
  await h.tick(ft([media('microphone')], { timestamp: Date.now() - 6000 }), true);
  assert.equal(h.engine.getState().canComplete, false);
  assert.equal(h.engine.getState().target, null);
});

test('toolbar loss after seeing a goal target preserves explicit completion without reusing old bounds', async t => {
  for (const sample of [
    ft([]), ft([], { window: null }),
    ft([media('microphone')], { controlVisibility: { microphone: 'covered', camera: 'visible', end: 'visible' } }),
    ft([], { frontmostBundleId: 'app.helpos.desktop', observedBundleId: undefined }),
  ]) {
    const h = harness('mute', ft([media('microphone')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, true);
    assert.equal(h.engine.getState().verification, null);
    h.engine.completeGoal(); assert.equal(h.engine.getState().verification, 'self-confirmed');
  }
});

test('permission loss and explicit Pause disable Complete until recovery, without losing the goal', async t => {
  const h = harness('unmute', ft([media('microphone')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(ft([], { trusted: false }));
  assert.equal(h.engine.getState().status, 'permission'); assert.equal(h.engine.getState().canComplete, false);
  h.engine.completeGoal(); assert.notEqual(h.engine.getState().status, 'complete');
  h.engine.retry();
  assert.equal(h.engine.getState().canComplete, false, 'Retry cannot treat previously seen controls as a new permission grant');
  await settle(); assert.equal(h.engine.getState().status, 'permission');
  await h.tick(ft([media('microphone')])); assert.equal(h.engine.getState().canComplete, true);
  h.engine.pause(); assert.equal(h.engine.getState().canComplete, false);
  h.engine.completeGoal(); assert.equal(h.engine.getState().status, 'paused');
  h.engine.resume(); await settle();
  assert.equal(h.engine.getState().goal?.id, 'unmute'); assert.equal(h.engine.getState().canComplete, true);
});

test('Safari completion requires observed Zoom In, supports repeat zoom and never auto-completes', async t => {
  const h = harness('zoom-in', safari([view])); t.after(() => h.engine.stop()); await settle();
  assert.deepEqual(h.engine.getState().target, view.rect); assert.equal(h.engine.getState().canComplete, false);
  h.engine.completeGoal(); assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(safari([view, { ...zoom, enabled: false }])); assert.equal(h.engine.getState().canComplete, false);
  await h.tick(safari([view, zoom]));
  assert.deepEqual(h.engine.getState().target, zoom.rect); assert.equal(h.engine.getState().canComplete, true);
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(safari([view]));
  assert.deepEqual(h.engine.getState().target, view.rect); assert.equal(h.engine.getState().canComplete, true);
  await h.tick(safari([view, zoom])); assert.equal(h.engine.getState().verification, null);
  await h.tick(safari([], { frontmostBundleId: 'app.helpos.desktop', window: null }));
  assert.equal(h.engine.getState().target, null); assert.equal(h.engine.getState().canComplete, true);
  h.engine.completeGoal(); assert.equal(h.engine.getState().verification, 'self-confirmed');
});

test('wrong Safari roles and ambiguous Zoom In labels do not enable Complete', async t => {
  for (const controls of [[view, { ...zoom, role: 'AXStaticText' }], [view, zoom, { ...zoom, rect: { ...zoom.rect, y: 400 } }]]) {
    const h = harness('zoom-in', safari(controls)); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().canComplete, false);
    assert.deepEqual(h.engine.getState().target, view.rect);
  }
});

test('Safari zoom goal recovers through Accessibility instead of showing an OCR-only View loop', async t => {
  const ocrView = { ...view, role: 'OCRLabel' };
  for (const role of ['OCRLabel', 'AXMenuItem']) {
    const h = harness('zoom-in', safari([ocrView, { ...zoom, role }], { trusted: false, source: 'ocr' }));
    t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().status, 'permission');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, false);
    h.engine.completeGoal(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(safari([ocrView, { ...zoom, role }], { trusted: true, source: 'ocr' }));
    assert.equal(h.engine.getState().status, 'waiting-control');
    assert.equal(h.engine.getState().title, 'Waiting for Safari controls');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canComplete, false);
    await h.tick(safari([view, zoom]));
    assert.deepEqual(h.engine.getState().target, zoom.rect);
    assert.equal(h.engine.getState().canComplete, true, 'fresh enabled AX evidence recovers without a new goal');
    assert.equal(h.engine.getState().verification, null);
  }
});

test('an unavailable Zoom In command stops the View loop and recovers without restarting the goal', async t => {
  const h = harness('zoom-in', safari([view])); t.after(() => h.engine.stop()); await settle();
  const session = h.engine.getState().sessionId;
  await h.tick(safari([view, { ...zoom, enabled: false }]));
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().title, 'Zoom In is unavailable');
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().canComplete, false);
  h.engine.completeGoal(); assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(safari([view]));
  assert.equal(h.engine.getState().title, 'Open View');
  await h.tick(safari([view, zoom]));
  assert.equal(h.engine.getState().sessionId, session);
  assert.equal(h.engine.getState().title, 'Click Zoom In');
  assert.deepEqual(h.engine.getState().target, zoom.rect);
  assert.equal(h.engine.getState().canComplete, true);
  await h.tick(safari([view, { ...zoom, enabled: false }]));
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().canComplete, true, 'Previously observed target still permits learner confirmation');
  assert.equal(h.engine.getState().verification, null);
});

test('missing or ambiguous menu evidence does not claim Zoom In is unavailable', async t => {
  const disabled = { ...zoom, enabled: false };
  for (const sample of [
    safari([view]),
    safari([view, { ...disabled, role: 'AXStaticText' }]),
    safari([view, { ...disabled, rect: { ...zoom.rect, width: NaN } }]),
    safari([view, disabled, { ...disabled, rect: { ...zoom.rect, y: 400 } }]),
    safari([view, disabled], { source: 'ocr' }),
  ]) {
    const h = harness('zoom-in', sample); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().title, sample.source === 'ocr' ? 'Waiting for Safari controls' : 'Open View');
    assert.equal(h.engine.getState().canComplete, false);
    assert.deepEqual(h.engine.getState().target, sample.source === 'ocr' ? null : view.rect);
  }
});

test('new goals and legacy starts reset manual evidence and cancel prior observations', async t => {
  const pending: Array<(sample: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000); t.after(() => engine.stop());
  const old = engine.startGoal(goals.mute);
  const current = engine.startGoal(goals['camera-off']);
  assert.notEqual(old.sessionId, current.sessionId);
  pending[0](ft([media('microphone')])); await settle();
  assert.equal(engine.getState().goal?.id, 'camera-off'); assert.equal(engine.getState().canComplete, false);
  pending[1](ft([media('camera')])); await settle(); assert.equal(engine.getState().canComplete, true);
  engine.startGoal(goals['zoom-in']); assert.equal(engine.getState().canComplete, false);
  engine.stop(); pending[2](safari([view, zoom])); await settle();
  assert.equal(engine.getState().status, 'idle'); assert.equal(engine.getState().goal, undefined);
  engine.start('facetime-mic');
  assert.equal(engine.getState().completionMode, undefined); assert.equal(engine.getState().canComplete, false);
  pending[3](ft([media('microphone')])); await settle();
  engine.completeGoal(); assert.equal(engine.getState().status, 'guiding');
});

test('goal app mismatches are rejected before replacing the active request', async t => {
  const h = harness('mute', ft([media('microphone')])); t.after(() => h.engine.stop()); await settle();
  const session = h.engine.getState().sessionId;
  assert.throws(() => h.engine.startGoal({ ...goals.mute, app: 'safari' }), /not available/);
  assert.equal(h.engine.getState().sessionId, session);
});
