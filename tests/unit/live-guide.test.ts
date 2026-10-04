import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine, findTarget, validRect } from '../../electron/features/live-guide/live-engine';
import type { Observation, ObservedElement, LiveState } from '../../src/features/live-guide/contracts';
import type { LessonId } from '../../src/features/lessons/types';

const windowRect = { x: 100, y: 80, width: 1000, height: 650 };
const element = (label: string, extra: Partial<ObservedElement> = {}): ObservedElement => ({ id: label, label, role: 'AXButton', enabled: true, rect: { x: 170, y: 140, width: 70, height: 30 }, ...extra });
function observation(bundle: string, elements: ObservedElement[], extra: Partial<Observation> = {}): Observation {
  return { trusted: true, screenCapture: true, frontmostBundleId: bundle, frontmostName: 'Test application', timestamp: Date.now(), source: 'accessibility', window: windowRect, elements, ...extra };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(id: LessonId, initial: Observation) {
  let current = initial; let stamp = Date.now(); let calls = 0;
  const states: LiveState[] = [];
  const engine = new LiveEngine(async () => { ++calls; return { ...current, timestamp: ++stamp }; }, state => states.push(state), 100000);
  engine.start(id);
  return { engine, states, calls: () => calls, set: (next: Observation) => { current = next; }, tick: async (next: Observation) => { current = next; await engine.poll(); } };
}
const mute = (label = 'Mute') => element(label);
const end = () => element('End Call', { rect: { x: 300, y: 140, width: 40, height: 40 } });
const view = () => element('View', { role: 'AXMenuBarItem', rect: { x: 200, y: 0, width: 45, height: 24 } });
const zoom = () => element('Zoom In', { role: 'AXMenuItem', rect: { x: 200, y: 120, width: 150, height: 24 } });

test('target matching rejects ambiguity, disabled targets, malformed bounds and Mute/Unmute confusion', () => {
  const base = observation('com.apple.FaceTime', [mute('Unmute')]);
  assert.equal(findTarget(base, ['Mute']), null);
  assert.equal(findTarget({ ...base, elements: [mute(), element('Mute', { rect: { x: 500, y: 200, width: 70, height: 30 } })] }, ['Mute']), null);
  assert.equal(findTarget({ ...base, elements: [element('Mute', { enabled: false })] }, ['Mute']), null);
  assert.equal(validRect({ x: NaN, y: 0, width: 5, height: 5 }), false);
  assert.equal(validRect({ x: 0, y: 0, width: -50, height: 5 }), false);
});

test('mute/unmute advances only on newly observed opposite control in the current call', async () => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  await settle(); assert.equal(h.engine.getState().stepIndex, 0);
  await h.tick(observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation('com.apple.FaceTime', [mute(), end()]));
  assert.equal(h.engine.getState().status, 'complete');
  assert.equal(h.engine.getState().verification, 'observed'); h.engine.stop();
});

test('static AX checkbox value changes never invent an unvalidated on/off meaning', async () => {
  const toggle = (value: string) => element('Mute', { role: 'AXCheckBox', value });
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [toggle('0'), end()]));
  await settle(); await h.tick(observation('com.apple.FaceTime', [toggle('1'), end()]));
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().status, 'waiting-control');
  await h.tick(observation('com.apple.FaceTime', [toggle('0'), end()]));
  assert.notEqual(h.engine.getState().status, 'complete'); h.engine.stop();
});

test('FaceTime static text cannot impersonate call controls', async () => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [element('Mute', { role: 'AXStaticText' }), element('End Call', { role: 'AXStaticText' })]));
  await settle(); assert.equal(h.engine.getState().target, null); assert.notEqual(h.engine.getState().status, 'guiding'); h.engine.stop();
});

test('unexpected application hides highlight in the first publication and never completes', async () => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  await settle(); const previous = h.states.length;
  await h.tick(observation('com.apple.Safari', [mute('Unmute'), end()]));
  assert.equal(h.engine.getState().status, 'waiting-app');
  assert.ok(h.states.slice(previous).every(state => state.target === null)); h.engine.stop();
});

test('a moved or resized window cannot supply completion evidence for the old target', async () => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  await settle(); await h.tick(observation('com.apple.FaceTime', [mute('Unmute'), end()], { window: { ...windowRect, x: 300 } }));
  assert.equal(h.engine.getState().stepIndex, 0); assert.notEqual(h.engine.getState().status, 'complete'); h.engine.stop();
});

test('a different native window identity cannot complete at the same coordinates', async () => {
  const first = { ...observation('com.apple.FaceTime', [mute(), end()]), windowId: '20:100' };
  const second = { ...observation('com.apple.FaceTime', [mute('Unmute'), end()]), windowId: '20:200' };
  const h = harness('facetime-mic', first);
  await settle(); await h.tick(second);
  assert.equal(h.engine.getState().stepIndex, 0); assert.notEqual(h.engine.getState().status, 'complete'); h.engine.stop();
});

test('call disappearance, minimization and a new-call window never imply call ended', async () => {
  const h = harness('facetime-end', observation('com.apple.FaceTime', [mute(), end()]));
  await settle(); await h.tick(observation('com.apple.FaceTime', [], { window: null }));
  assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation('com.apple.FaceTime', [element('New FaceTime')]));
  assert.notEqual(h.engine.getState().status, 'complete'); assert.equal(h.engine.getState().canConfirm, false); h.engine.stop();
});

test('positive call-ended evidence after an armed target can complete', async () => {
  const h = harness('facetime-end', observation('com.apple.FaceTime', [mute(), end()]));
  await settle(); await h.tick(observation('com.apple.FaceTime', [element('Call Ended')]));
  assert.equal(h.engine.getState().status, 'complete'); h.engine.stop();
});

test('Safari menu closure asks for user confirmation and never claims zoom was observed', async () => {
  const identity = { windowId: 'safari:1' };
  const h = harness('safari-zoom', observation('com.apple.Safari', [view()], identity));
  await settle(); h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation('com.apple.Safari', [view(), zoom()], identity));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation('com.apple.Safari', [view()], identity));
  assert.equal(h.engine.getState().canConfirm, true);
  assert.notEqual(h.engine.getState().status, 'complete');
  h.engine.confirm(); assert.equal(h.engine.getState().verification, 'self-confirmed'); h.engine.stop();
});

test('live instructions preserve observed Korean labels and explain them in English', async () => {
  const koreanView = { ...view(), label: '보기' };
  const h = harness('safari-zoom', observation('com.apple.Safari', [koreanView]));
  await settle(); assert.match(h.engine.getState().message, /보기/); assert.match(h.engine.getState().message, /View/); assert.doesNotMatch(h.engine.getState().message, /\(보기\)/);
  h.engine.stop();
});

test('Finder finishes after selected Downloads, not simply seeing its sidebar label', async () => {
  const downloads = element('Downloads', { role: 'AXStaticText' });
  const h = harness('finder-downloads', observation('com.apple.finder', [downloads]));
  await settle(); assert.equal(h.engine.getState().status, 'guiding');
  await h.tick(observation('com.apple.finder', [{ ...downloads, selected: true }]));
  assert.equal(h.engine.getState().status, 'complete'); h.engine.stop();
});

test('FaceTime requires accessibility and rejects OCR-only icon interpretations', async () => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()], { trusted: false, source: 'ocr' }));
  await settle(); assert.equal(h.engine.getState().status, 'permission'); assert.equal(h.engine.getState().target, null); h.engine.stop();
});

test('pause cancels observation and rejects a result that arrives late', async () => {
  let resolve!: (value: Observation) => void; let calls = 0;
  const engine = new LiveEngine(async () => { ++calls; return new Promise<Observation>(done => { resolve = done; }); }, () => {}, 5);
  engine.start('facetime-mic'); engine.pause();
  resolve(observation('com.apple.FaceTime', [mute(), end()])); await settle();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1); assert.equal(engine.getState().status, 'paused'); assert.equal(engine.getState().target, null); engine.stop();
});

test('old-session results cannot replace a new lesson or restore a stopped overlay', async () => {
  const pending: Array<(value: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000);
  engine.start('facetime-mic'); engine.start('finder-downloads');
  pending[0](observation('com.apple.FaceTime', [mute(), end()])); await settle();
  assert.equal(engine.getState().lessonId, 'finder-downloads'); assert.equal(engine.getState().target, null);
  engine.stop(); pending[1](observation('com.apple.finder', [element('Downloads')])); await settle();
  assert.equal(engine.getState().status, 'idle'); assert.equal(engine.getState().target, null);
});


test('an explicitly observed FaceTime call remains guided when HelpOS takes focus', async t => {
  const context = { observedBundleId: 'com.apple.FaceTime', windowId: '20:100' };
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()], context));
  t.after(() => h.engine.stop());
  await settle();
  const sessionId = h.engine.getState().sessionId;
  await h.tick(observation('app.helpos.desktop', [mute(), end()], context));
  assert.equal(h.engine.getState().status, 'guiding');
  assert.deepEqual(h.engine.getState().target, mute().rect);
  assert.equal(h.engine.getState().sessionId, sessionId);
  assert.deepEqual(h.engine.getState().contextWindow, windowRect);
  await h.tick(observation('app.helpos.desktop', [mute('Unmute'), end()], context));
  assert.equal(h.engine.getState().stepIndex, 1);
});

test('background FaceTime requires explicit matching observed identity and trusted AX evidence', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  t.after(() => h.engine.stop());
  await settle();
  for (const sample of [
    observation('app.helpos.desktop', [mute(), end()]),
    observation('app.helpos.desktop', [mute(), end()], { observedBundleId: 'com.apple.Safari' }),
    observation('com.apple.FaceTime', [mute(), end()], { observedBundleId: 'com.apple.Safari' }),
  ]) {
    const previous = h.states.length;
    await h.tick(sample);
    assert.equal(h.engine.getState().status, 'waiting-app');
    assert.equal(h.engine.getState().contextWindow, undefined);
    assert.ok(h.states.slice(previous).every(state => state.target === null));
  }
  await h.tick(observation('app.helpos.desktop', [mute(), end()], { observedBundleId: 'com.apple.FaceTime', trusted: false, source: 'ocr' }));
  assert.equal(h.engine.getState().status, 'permission');
  assert.equal(h.engine.getState().target, null);
  await h.tick(observation('app.helpos.desktop', [mute(), end()], { observedBundleId: 'com.apple.FaceTime', window: null }));
  assert.equal(h.engine.getState().status, 'waiting-app');
  assert.equal(h.engine.getState().target, null);
});

test('Safari and Finder stay foreground-only even with matching observed identities', async t => {
  for (const [id, bundle, controls] of [
    ['safari-zoom', 'com.apple.Safari', [view()]],
    ['finder-downloads', 'com.apple.finder', [element('Downloads', { role: 'AXStaticText' })]],
  ] as const) {
    const h = harness(id, observation('app.helpos.desktop', [...controls], { observedBundleId: bundle }));
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().status, 'waiting-app');
    assert.equal(h.engine.getState().target, null);
  }
});

test('a covered FaceTime target cannot advance or preserve an armed click', async t => {
  const context = { observedBundleId: 'com.apple.FaceTime', windowId: '20:100' };
  const h = harness('facetime-mic', observation('app.helpos.desktop', [mute(), end()], context));
  t.after(() => h.engine.stop());
  await settle();
  const previous = h.states.length;
  await h.tick(observation('app.helpos.desktop', [mute('Unmute'), end()], { ...context, occluded: true, controlVisibility: { microphone: 'covered', camera: 'missing', end: 'visible' } }));
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().title, 'The microphone button is covered.');
  assert.deepEqual(h.engine.getState().contextWindow, windowRect);
  assert.equal(h.engine.getState().message, 'Move the covering window to see it.');
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.ok(h.states.slice(previous).every(state => state.target === null));
  await h.tick(observation('app.helpos.desktop', [mute('Unmute'), end()], { ...context, occluded: false }));
  assert.equal(h.engine.getState().stepIndex, 0);
  await h.tick(observation('app.helpos.desktop', [mute(), end()], context));
  await h.tick(observation('app.helpos.desktop', [mute('Unmute'), end()], context));
  assert.equal(h.engine.getState().stepIndex, 1);
});

test('a clear FaceTime target can guide when the confirmed call has another control covered', async t => {
  const h = harness('facetime-mic', observation('app.helpos.desktop', [mute()], { observedBundleId: 'com.apple.FaceTime', occluded: true }));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().status, 'guiding');
  assert.deepEqual(h.engine.getState().target, mute().rect);
  assert.equal(h.engine.getState().stepIndex, 0);
});

test('covered or background call-ended evidence cannot complete a FaceTime lesson', async t => {
  for (const [foreground, occluded] of [['com.apple.FaceTime', true], ['app.helpos.desktop', false]] as const) {
    const h = harness('facetime-end', observation('com.apple.FaceTime', [mute(), end()]));
    t.after(() => h.engine.stop());
    await settle();
    await h.tick(observation(foreground, [element('Call Ended')], { observedBundleId: 'com.apple.FaceTime', occluded }));
    assert.notEqual(h.engine.getState().status, 'complete');
    assert.equal(h.engine.getState().target, null);
  }
});

test('background FaceTime still rejects completion evidence from a replacement window', async t => {
  const h = harness('facetime-mic', observation('app.helpos.desktop', [mute(), end()], { observedBundleId: 'com.apple.FaceTime', windowId: '20:100' }));
  t.after(() => h.engine.stop());
  await settle();
  await h.tick(observation('app.helpos.desktop', [mute('Unmute'), end()], { observedBundleId: 'com.apple.FaceTime', windowId: '20:200' }));
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().target, null);
});

test('live microphone and camera instructions name visible controls instead of AX action labels', async t => {
  for (const [id, first, second, expected] of [
    ['facetime-mic', '음소거', '음소거 해제', 'Click the highlighted microphone button.'],
    ['facetime-camera', 'Turn Camera Off', 'Turn Camera On', 'Click the highlighted camera button.'],
  ] as const) {
    const h = harness(id, observation('com.apple.FaceTime', [element(first), end()]));
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().message, expected);
    await h.tick(observation('com.apple.FaceTime', [element(second), end()]));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.equal(h.engine.getState().message, expected);
  }
});

test('switching FaceTime lessons cancels the old session and ignores its late observation', async t => {
  const pending: Array<{ resolve: (value: Observation) => void; signal: AbortSignal }> = [];
  const engine = new LiveEngine((_bundle, signal) => new Promise(resolve => pending.push({ resolve, signal })), () => {}, 100000);
  t.after(() => engine.stop());
  const first = engine.start('facetime-mic');
  const next = engine.switchLesson('facetime-camera');
  assert.notEqual(next.sessionId, first.sessionId);
  assert.equal(next.stepIndex, 0);
  assert.equal(next.currentAction, 'camera-off');
  assert.equal(next.target, null);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  await settle();
  assert.equal(engine.getState().lessonId, 'facetime-camera');
  assert.equal(engine.getState().status, 'observing');
  assert.equal(engine.getState().target, null);
  pending[1].resolve(observation('app.helpos.desktop', [element('Turn Camera Off'), end()], { observedBundleId: 'com.apple.FaceTime' }));
  await settle();
  assert.equal(engine.getState().status, 'guiding');
  assert.equal(engine.getState().message, 'Click the highlighted camera button.');
});

test('a completed FaceTime lesson can switch to a new lesson with fresh call validation', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  t.after(() => h.engine.stop());
  await settle();
  await h.tick(observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  await h.tick(observation('com.apple.FaceTime', [mute(), end()]));
  const completed = h.engine.getState();
  assert.equal(completed.status, 'complete');
  h.set(observation('com.apple.FaceTime', [], { window: null }));
  const next = h.engine.switchLesson('facetime-camera');
  assert.notEqual(next.sessionId, completed.sessionId);
  assert.equal(next.verification, null);
  assert.equal(next.status, 'observing');
  assert.equal(next.target, null);
  await settle();
  assert.equal(h.engine.getState().status, 'waiting-app');
  assert.equal(h.engine.getState().stepIndex, 0);
});

test('FaceTime lesson switching rejects idle and unrelated source or destination lessons', async t => {
  const engine = new LiveEngine(async () => observation('com.apple.FaceTime', [mute(), end()]), () => {}, 100000);
  t.after(() => engine.stop());
  assert.throws(() => engine.switchLesson('facetime-camera'));
  const safari = engine.start('safari-zoom');
  assert.throws(() => engine.switchLesson('facetime-mic'));
  assert.equal(engine.getState().sessionId, safari.sessionId);
  const facetime = engine.start('facetime-mic');
  assert.throws(() => engine.switchLesson('finder-downloads'));
  assert.equal(engine.getState().sessionId, facetime.sessionId);
  engine.stop();
  assert.throws(() => engine.switchLesson('facetime-camera'));
});


test('fresh media lessons adapt to an explicit opposite action and require both new transitions', async t => {
  for (const [id, initial, next, firstTitle, secondTitle] of [
    ['facetime-mic', 'Unmute', 'Mute', 'Unmute your microphone', 'Mute your microphone'],
    ['facetime-camera', 'Turn Camera On', 'Turn Camera Off', 'Turn your camera on', 'Turn your camera off'],
  ] as const) {
    const context = { observedBundleId: 'com.apple.FaceTime', windowId: '20:100' };
    const h = harness(id, observation('app.helpos.desktop', [element(initial), end()], context));
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().status, 'guiding');
    assert.equal(h.engine.getState().title, firstTitle);
    assert.equal(h.engine.getState().currentAction, id === 'facetime-mic' ? 'mic-on' : 'camera-on');
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.equal(h.engine.getState().verification, null);
    assert.ok(h.states.every(state => state.status !== 'complete'));
    await h.tick(observation('app.helpos.desktop', [element(initial), end()], context));
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation('app.helpos.desktop', [element(next), end()], context));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.equal(h.engine.getState().title, secondTitle);
    assert.equal(h.engine.getState().currentAction, id === 'facetime-mic' ? 'mic-off' : 'camera-off');
    assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation('app.helpos.desktop', [element(next), end()], context));
    assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation('app.helpos.desktop', [element(initial), end()], context));
    assert.equal(h.engine.getState().status, 'complete');
    assert.equal(h.engine.getState().verification, 'observed');
  }
});

test('initial media direction does not infer state from occlusion, static text, ambiguous controls or checkbox values', async t => {
  for (const sample of [
    observation('com.apple.FaceTime', [mute('Unmute'), end()], { occluded: true }),
    observation('com.apple.FaceTime', [element('Unmute', { role: 'AXStaticText' }), end()]),
    observation('com.apple.FaceTime', [mute('Unmute'), element('Unmute', { rect: { x: 500, y: 200, width: 70, height: 30 } }), end()]),
    observation('com.apple.FaceTime', [element('Mute', { role: 'AXCheckBox', value: '1' }), end()]),
  ]) {
    const h = harness('facetime-mic', sample);
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.notEqual(h.engine.getState().title, 'Unmute your microphone');
    assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('pause and window replacement cannot reorder an unarmed media lesson', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [end()], { windowId: '20:100' }));
  t.after(() => h.engine.stop());
  await settle();
  h.engine.pause();
  h.set(observation('com.apple.FaceTime', [mute('Unmute'), end()], { windowId: '20:100' }));
  h.engine.resume();
  await settle();
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.notEqual(h.engine.getState().title, 'Unmute your microphone');
  assert.equal(h.engine.getState().target, null);
  const replacement = harness('facetime-camera', observation('com.apple.FaceTime', [end()], { windowId: '20:100' }));
  t.after(() => replacement.engine.stop());
  await settle();
  await replacement.tick(observation('com.apple.FaceTime', [element('Turn Camera On'), end()], { windowId: '20:200' }));
  assert.equal(replacement.engine.getState().stepIndex, 0);
  assert.notEqual(replacement.engine.getState().title, 'Turn your camera on');
  assert.equal(replacement.engine.getState().target, null);
});

test('a media lesson keeps its chosen direction after pause and resets direction on a fresh switch', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  t.after(() => h.engine.stop());
  await settle();
  h.engine.pause();
  h.set(observation('com.apple.FaceTime', [mute(), end()]));
  h.engine.resume();
  await settle();
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().target, null);
  const oldSession = h.engine.getState().sessionId;
  h.engine.switchLesson('facetime-mic');
  await settle();
  assert.notEqual(h.engine.getState().sessionId, oldSession);
  assert.equal(h.engine.getState().title, 'Mute your microphone');
  assert.equal(h.engine.getState().status, 'guiding');
  assert.equal(h.engine.getState().stepIndex, 0);
});


test('a visible camera can adapt and finish when a different FaceTime control is covered', async t => {
  const context: Partial<Observation> = { observedBundleId: 'com.apple.FaceTime', windowId: '20:100', occluded: true, controlVisibility: { microphone: 'covered', camera: 'visible', end: 'covered' } };
  const h = harness('facetime-camera', observation('app.helpos.desktop', [element('Turn Camera On')], context));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().status, 'guiding');
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().currentAction, 'camera-on');
  await h.tick(observation('app.helpos.desktop', [element('Turn Camera Off')], context));
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.equal(h.engine.getState().currentAction, 'camera-off');
  assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation('app.helpos.desktop', [element('Turn Camera On')], context));
  assert.equal(h.engine.getState().status, 'complete');
  assert.equal(h.engine.getState().verification, 'observed');
});

test('only selected-control visibility can claim the camera button is covered', async t => {
  const context: Partial<Observation> = { observedBundleId: 'com.apple.FaceTime', occluded: true };
  const h = harness('facetime-camera', observation('app.helpos.desktop', [element('Turn Camera On')], context));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().title, 'Show call buttons');
  assert.equal(h.engine.getState().message, 'Move pointer over FaceTime');
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().stepIndex, 0);
  await h.tick(observation('app.helpos.desktop', [], { ...context, controlVisibility: { microphone: 'visible', camera: 'covered', end: 'visible' } }));
  assert.equal(h.engine.getState().title, 'The camera button is covered.');
  assert.equal(h.engine.getState().target, null);
  await h.tick(observation('app.helpos.desktop', [], { ...context, controlVisibility: { microphone: 'covered', camera: 'missing', end: 'missing' } }));
  assert.equal(h.engine.getState().title, 'Show call buttons');
  assert.equal(h.engine.getState().message, 'Move pointer over FaceTime');
});

test('missing End or a partial toolbar never claims that a FaceTime call is absent', async t => {
  for (const sample of [
    observation('com.apple.FaceTime', []),
    observation('com.apple.FaceTime', [element('Turn Camera Off')]),
    observation('app.helpos.desktop', [], { observedBundleId: 'com.apple.FaceTime', controlVisibility: { microphone: 'visible', camera: 'missing', end: 'missing' } }),
  ]) {
    const h = harness('facetime-camera', sample);
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().status, 'waiting-control');
    assert.equal(h.engine.getState().title, 'Show call buttons');
    assert.equal(h.engine.getState().message, 'Move pointer over FaceTime');
    assert.equal(h.engine.getState().target, null);
    assert.notEqual(h.engine.getState().verification, 'observed');
  }
});

test('positive foreground call-ended evidence remains valid with per-control missing visibility', async t => {
  const h = harness('facetime-end', observation('com.apple.FaceTime', [end()], { observedBundleId: 'com.apple.FaceTime', controlVisibility: { microphone: 'visible', camera: 'visible', end: 'visible' } }));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().currentAction, 'end-call');
  await h.tick(observation('com.apple.FaceTime', [element('Call Ended', { role: 'AXStaticText' })], { controlVisibility: { microphone: 'missing', camera: 'missing', end: 'missing' } }));
  assert.equal(h.engine.getState().status, 'complete');
  assert.equal(h.engine.getState().verification, 'observed');
});


test('granted FaceTime access with missing AX evidence waits neutrally and drops old action evidence', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().status, 'guiding');
  const previous = h.states.length;
  await h.tick(observation('com.apple.FaceTime', [], { source: 'none', window: null, trusted: true, screenCapture: false }));
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().title, 'Show call buttons');
  assert.equal(h.engine.getState().message, 'Move pointer over FaceTime');
  assert.equal(h.engine.getState().permission.accessibility, true);
  assert.equal(h.engine.getState().contextWindow, undefined);
  assert.ok(h.states.slice(previous).every(state => state.target === null && state.status !== 'permission'));
  await h.tick(observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().target, null);
  await h.tick(observation('com.apple.FaceTime', [mute(), end()]));
  await h.tick(observation('com.apple.FaceTime', [mute('Unmute'), end()]));
  assert.equal(h.engine.getState().stepIndex, 1);
});

test('granted AX permission does not authorize OCR-only FaceTime targets or require another grant', async t => {
  const h = harness('facetime-camera', observation('com.apple.FaceTime', [element('Turn Camera Off'), end()], { source: 'ocr', trusted: true }));
  t.after(() => h.engine.stop());
  await settle();
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().permission.accessibility, true);
  assert.equal(h.engine.getState().title, 'Show call buttons');
  assert.equal(h.engine.getState().verification, null);
});

test('missing access shows recovery before foreground detection for every supported lesson', async t => {
  for (const id of ['facetime-mic', 'safari-zoom', 'finder-downloads'] as const) {
    const h = harness(id, observation('app.helpos.desktop', [], { trusted: false, screenCapture: false, source: 'none', window: null }));
    t.after(() => h.engine.stop());
    await settle();
    assert.equal(h.engine.getState().status, 'permission');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().contextWindow, undefined);
  }
});

test('FaceTime access loss drops the old target and recovers without requiring foreground', async t => {
  const context = { observedBundleId: 'com.apple.FaceTime', windowId: '20:100' };
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()], context));
  t.after(() => h.engine.stop());
  await settle();
  const previous = h.states.length;
  await h.tick(observation('app.helpos.desktop', [], { trusted: false, source: 'none', window: null }));
  assert.equal(h.engine.getState().status, 'permission');
  assert.ok(h.states.slice(previous).every(state => state.target === null));
  await h.tick(observation('app.helpos.desktop', [mute(), end()], context));
  assert.equal(h.engine.getState().status, 'guiding');
  assert.deepEqual(h.engine.getState().target, mute().rect);
  assert.equal(h.engine.getState().stepIndex, 0);
});

test('stale access and focus samples cannot rewrite permissions or supply click evidence', async t => {
  let current = observation('com.apple.FaceTime', [mute(), end()]);
  const stamp = current.timestamp;
  const engine = new LiveEngine(async () => current, () => {}, 100000);
  t.after(() => engine.stop());
  engine.start('facetime-mic'); await settle();
  for (const timestamp of [stamp, stamp - 6000, stamp + 10000]) {
    current = observation('app.helpos.desktop', [], { timestamp, trusted: false, screenCapture: false, source: 'none', window: null });
    await engine.poll();
    assert.equal(engine.getState().status, 'observing');
    assert.equal(engine.getState().target, null);
    assert.equal(engine.getState().permission.accessibility, true);
  }
  current = observation('com.apple.FaceTime', [mute('Unmute'), end()], { timestamp: stamp + 1 });
  await engine.poll();
  assert.equal(engine.getState().stepIndex, 0);
  assert.equal(engine.getState().verification, null);
});


test('returning to the selected app recovers a permission-paused guide using fresh real evidence', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [], { trusted: false, screenCapture: false, source: 'none' }));
  t.after(() => h.engine.stop()); await settle();
  const session = h.engine.getState().sessionId;
  h.engine.pause('permission');
  assert.equal(h.engine.canRecoverPermissionFor('com.apple.Safari'), false);
  assert.equal(h.engine.recoverPermissionFor('com.apple.Safari'), false);
  h.set(observation('com.apple.FaceTime', [mute('Unmute'), end()], { screenCapture: false }));
  assert.equal(h.engine.recoverPermissionFor('com.apple.FaceTime'), true);
  assert.equal(h.engine.getState().target, null);
  await settle();
  assert.equal(h.engine.getState().status, 'guiding');
  assert.equal(h.engine.getState().sessionId, session);
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().currentAction, 'mic-on');
  assert.equal(h.engine.getState().permission.accessibility, true);
  assert.equal(h.engine.getState().permission.screenCapture, false);
});

test('app return cannot override explicit Pause even when Settings is opened afterward', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [mute(), end()]));
  t.after(() => h.engine.stop()); await settle();
  h.engine.pause(); h.engine.pause('permission'); const reads = h.calls();
  assert.equal(h.engine.recoverPermissionFor('com.apple.FaceTime'), false);
  await settle(); assert.equal(h.calls(), reads); assert.equal(h.engine.getState().status, 'paused');
});

test('recovery never fabricates a grant or resurrects a closed guide', async t => {
  const h = harness('facetime-mic', observation('com.apple.FaceTime', [], { trusted: false, screenCapture: false, source: 'none' }));
  t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.recoverPermissionFor('com.apple.FaceTime'), true); await settle();
  assert.equal(h.engine.getState().status, 'permission'); assert.equal(h.engine.getState().target, null);
  h.engine.stop(); assert.equal(h.engine.recoverPermissionFor('com.apple.FaceTime'), false);
});


test('scheduled observation acquires revealed FaceTime controls without user retry', { timeout: 3000 }, async t => {
  let stamp = Date.now(); let reads = 0; let reveal = false;
  let waiting!: () => void; let guided!: () => void;
  const firstWait = new Promise<void>(resolve => { waiting = resolve; });
  const firstGuide = new Promise<void>(resolve => { guided = resolve; });
  const engine = new LiveEngine(async () => {
    reads++;
    return observation('com.apple.FaceTime', reveal ? [mute(), end()] : [], { timestamp: ++stamp });
  }, state => {
    if (state.status === 'waiting-control') waiting();
    if (state.status === 'guiding') guided();
  }, 10);
  t.after(() => engine.stop());
  engine.start('facetime-mic');
  await firstWait;
  const session = engine.getState().sessionId;
  assert.equal(engine.getState().target, null);
  reveal = true;
  await Promise.race([firstGuide, new Promise<never>((_, reject) => {
    const timeout = setTimeout(() => reject(new Error('Automatic observation did not recover')), 2000);
    t.after(() => clearTimeout(timeout));
  })]);
  assert.ok(reads >= 2);
  assert.equal(engine.getState().sessionId, session);
  assert.equal(engine.getState().stepIndex, 0);
  assert.deepEqual(engine.getState().target, mute().rect);
  assert.equal(engine.getState().verification, null);
});
