import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine } from '../../electron/features/live-guide/live-engine';
import type { LiveState, Observation, ObservedElement } from '../../src/features/live-guide/contracts';
import type { LessonId } from '../../src/features/lessons/types';

const windowRect = { x: 100, y: 80, width: 1000, height: 650 };
const end = (): ObservedElement => ({ id: 'end', role: 'AXButton', label: 'End', enabled: true, rect: { x: 900, y: 600, width: 40, height: 40 } });
const media = (kind: 'microphone' | 'camera', value: string | undefined = '0', extra: Partial<ObservedElement> = {}): ObservedElement => ({
  id: 'generated-observer-id', role: 'AXCheckBox', subrole: 'AXSwitch',
  nativeIdentifier: kind === 'microphone' ? 'toggleMicMenuButton' : 'toggleVideoButton',
  label: kind === 'microphone' ? 'Microphone' : 'Camera', value, enabled: true,
  rect: { x: kind === 'microphone' ? 800 : 740, y: 600, width: 40, height: 40 }, ...extra,
});
const observation = (elements: ObservedElement[], extra: Partial<Observation> = {}): Observation => ({
  trusted: true, screenCapture: true, frontmostBundleId: 'com.apple.FaceTime', frontmostName: 'FaceTime',
  observedBundleId: 'com.apple.FaceTime', source: 'accessibility', timestamp: Date.now(),
  window: windowRect, windowId: 'facetime:call-1', occluded: false,
  controlVisibility: { microphone: 'visible', camera: 'visible', end: 'visible' }, elements: [...elements, end()], ...extra,
});
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(id: LessonId, initial: Observation) {
  let current = initial; let stamp = Date.now(); let preserveTimestamp = false;
  const states: LiveState[] = [];
  const engine = new LiveEngine(async () => ({ ...current, timestamp: preserveTimestamp ? current.timestamp : ++stamp }), state => states.push(state), 100000);
  engine.start(id);
  return { engine, states,
    set: (next: Observation) => { current = next; preserveTimestamp = false; },
    tick: async (next: Observation, rawTimestamp = false) => { current = next; preserveTimestamp = rawTimestamp; await engine.poll(); },
  };
}

test('identified FaceTime switches require two fresh binary changes without assigning mute/camera polarity', async t => {
  for (const [id, kind, action] of [['facetime-mic', 'microphone', 'mic-toggle'], ['facetime-camera', 'camera', 'camera-toggle']] as const) {
    for (const initial of ['0', '1']) {
      const opposite = initial === '0' ? '1' : '0';
      const h = harness(id, observation([media(kind, initial)])); t.after(() => h.engine.stop()); await settle();
      assert.equal(h.engine.getState().currentAction, action);
      assert.equal(h.engine.getState().title, `Click ${kind}`);
      assert.equal(h.engine.getState().stepIndex, 0);
      assert.deepEqual(h.engine.getState().target, media(kind).rect);
      assert.doesNotMatch(h.engine.getState().message + h.engine.getState().why, /muted|unmuted|turn.*off|turn.*on|hearing you|see you/i);
      await h.tick(observation([media(kind, initial)]));
      assert.equal(h.engine.getState().stepIndex, 0);
      await h.tick(observation([media(kind, opposite, { id: 'new-generated-observer-id' })]));
      assert.equal(h.engine.getState().stepIndex, 1);
      assert.equal(h.engine.getState().currentAction, `${action}-again`);
      assert.equal(h.engine.getState().title, `Click ${kind} again`);
      await h.tick(observation([media(kind, opposite)]));
      assert.notEqual(h.engine.getState().status, 'complete');
      h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
      await h.tick(observation([media(kind, initial)]));
      assert.equal(h.engine.getState().status, 'complete');
      assert.equal(h.engine.getState().verification, 'observed');
      assert.equal(h.engine.getState().why, `You practiced using the FaceTime ${kind} switch.`);
    }
  }
});

test('neutral labels require exact native identifier, raw checkbox role and switch subrole', async t => {
  for (const extra of [
    { nativeIdentifier: undefined }, { nativeIdentifier: 'toggleMicMenuButtonOther' },
    { nativeIdentifier: 'toggleVideoButton' }, { role: 'AXButton' }, { role: 'AXStaticText' },
    { role: 'AXSwitch' }, { subrole: undefined }, { subrole: 'AXToggleButton' },
    { label: 'Camera' }, { label: 'Mute' }, { enabled: false },
  ]) {
    const h = harness('facetime-mic', observation([media('microphone', '0', extra as Partial<ObservedElement>)])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null, JSON.stringify(extra));
    assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([media('microphone', '1', extra as Partial<ObservedElement>)]));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.equal(h.engine.getState().verification, null);
  }
});

test('only normalized binary values can identify and advance the scoped switch', async t => {
  for (const value of [undefined, '', '2', '-1', 'mixed', 'true', 'false', '0.0', ' 1']) {
    const h = harness('facetime-mic', observation([media('microphone', '0', { value })])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null, `Unexpected binary value ${value}`);
    await h.tick(observation([media('microphone', '1')]));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.equal(h.engine.getState().verification, null);
  }
});

test('duplicate switch identifiers, including same-bounds conflicting values, are ambiguous', async t => {
  for (const duplicate of [media('microphone', '1'), media('microphone', '0'), media('microphone', '0', { rect: { x: 500, y: 400, width: 40, height: 40 } })]) {
    const h = harness('facetime-mic', observation([media('microphone', '0'), duplicate])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null);
    await h.tick(observation([media('microphone', '1')]));
    assert.equal(h.engine.getState().stepIndex, 0);
  }
});

test('neutral switch targets require a confirmed AX call identity, window bounds and visible control', async t => {
  for (const context of [
    { trusted: false }, { source: 'ocr' as const }, { source: 'none' as const },
    { observedBundleId: undefined }, { observedBundleId: 'com.apple.Safari' },
    { windowId: undefined }, { windowId: '' }, { window: null },
    { controlVisibility: undefined },
    { controlVisibility: { microphone: 'missing', camera: 'visible', end: 'visible' } as const },
    { controlVisibility: { microphone: 'covered', camera: 'visible', end: 'visible' } as const },
  ]) {
    const h = harness('facetime-mic', observation([media('microphone')], context)); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null, JSON.stringify(context));
    assert.equal(h.engine.getState().verification, null);
  }
  for (const rect of [
    { x: 10, y: 600, width: 40, height: 40 },
    { x: 800, y: 800, width: 40, height: 40 },
    { x: 800, y: 600, width: NaN, height: 40 },
  ]) {
    const h = harness('facetime-mic', observation([media('microphone', '0', { rect })])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null);
  }
});

test('covered, missing or invalid switch samples drop prior click evidence and rebaseline on recovery', async t => {
  for (const sample of [
    observation([media('microphone', '1')], { controlVisibility: { microphone: 'covered', camera: 'visible', end: 'visible' } }),
    observation([media('microphone', '1')], { controlVisibility: { microphone: 'missing', camera: 'visible', end: 'visible' } }),
    observation([]), observation([media('microphone', '2')]),
    observation([media('microphone', '1', { enabled: false })]),
  ]) {
    const h = harness('facetime-mic', observation([media('microphone', '0')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation([media('microphone', '1')]));
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation([media('microphone', '0')]));
    assert.equal(h.engine.getState().stepIndex, 1);
  }
});

test('moving a call window or switch updates the target but never counts the simultaneous value change', async t => {
  for (const [control, context] of [
    [media('microphone', '1'), { window: { ...windowRect, x: 110 } }],
    [media('microphone', '1', { rect: { x: 790, y: 590, width: 40, height: 40 } }), {}],
  ] as const) {
    const h = harness('facetime-mic', observation([media('microphone', '0')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([control], context));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.deepEqual(h.engine.getState().target, control.rect);
    await h.tick(observation([{ ...control, value: '0' }], context));
    assert.equal(h.engine.getState().stepIndex, 1);
  }
});

test('a replacement call cannot inherit the first switch change, even through a missing-window sample', async t => {
  for (const missing of [false, true]) {
    const h = harness('facetime-camera', observation([media('camera', '0')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([media('camera', '1')]));
    assert.equal(h.engine.getState().stepIndex, 1);
    if (missing) await h.tick(observation([], { window: null, windowId: undefined }));
    const context = { windowId: 'facetime:call-2' };
    await h.tick(observation([media('camera', '0')], context));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([media('camera', '1')], context));
    assert.equal(h.engine.getState().stepIndex, 1);
    await h.tick(observation([media('camera', '0')], context));
    assert.equal(h.engine.getState().status, 'complete');
  }
});

test('stale, permission-loss and wrong-context samples cannot provide a switch change', async t => {
  for (const [sample, rawTimestamp] of [
    [observation([media('microphone', '1')], { timestamp: Date.now() - 6000 }), true],
    [observation([media('microphone', '1')], { trusted: false }), false],
    [observation([media('microphone', '1')], { frontmostBundleId: 'com.apple.Safari', observedBundleId: undefined }), false],
  ] as const) {
    const h = harness('facetime-mic', observation([media('microphone', '0')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample, rawTimestamp);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation([media('microphone', '1')]));
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation([media('microphone', '0')]));
    assert.equal(h.engine.getState().stepIndex, 1);
  }
});

test('a matching background call can guide a visible switch while another control is covered', async t => {
  const context = { frontmostBundleId: 'app.helpos.desktop', occluded: true,
    controlVisibility: { microphone: 'visible', camera: 'covered', end: 'covered' } as const };
  const h = harness('facetime-mic', observation([media('microphone', '0')], context)); t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.getState().status, 'guiding');
  await h.tick(observation([media('microphone', '1')], context));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation([media('microphone', '0')], context));
  assert.equal(h.engine.getState().status, 'complete');
});

test('Pause discards changes made while paused, then requires a freshly observed change', async t => {
  const h = harness('facetime-mic', observation([media('microphone', '0')])); t.after(() => h.engine.stop()); await settle();
  h.engine.pause();
  h.set(observation([media('microphone', '1')]));
  await h.engine.poll();
  assert.equal(h.engine.getState().status, 'paused');
  h.engine.resume(); await settle();
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().currentAction, 'mic-toggle');
  await h.tick(observation([media('microphone', '0')]));
  assert.equal(h.engine.getState().stepIndex, 1);
  h.engine.pause(); h.set(observation([media('microphone', '1')])); h.engine.resume(); await settle();
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation([media('microphone', '0')]));
  assert.equal(h.engine.getState().status, 'complete');
});

test('neutral mode cannot fall back to unscoped labels after arming, and new lessons reset it', async t => {
  const h = harness('facetime-mic', observation([media('microphone', '0')])); t.after(() => h.engine.stop()); await settle();
  const legacy = (label: string): ObservedElement => ({ id: label, label, role: 'AXButton', enabled: true, rect: media('microphone').rect });
  await h.tick(observation([legacy('Unmute')]));
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().stepIndex, 0);
  h.set(observation([media('camera', '1')]));
  const previous = h.engine.getState().sessionId;
  h.engine.switchLesson('facetime-camera'); await settle();
  assert.notEqual(h.engine.getState().sessionId, previous);
  assert.equal(h.engine.getState().currentAction, 'camera-toggle');
  assert.equal(h.engine.getState().stepIndex, 0);
  h.set(observation([legacy('Mute')])); h.engine.switchLesson('facetime-mic'); await settle();
  assert.equal(h.engine.getState().currentAction, 'mic-off');
  await h.tick(observation([legacy('Unmute')]));
  assert.equal(h.engine.getState().stepIndex, 1);
});

test('an in-flight observation cannot resurrect a stopped switch lesson or cross a lesson switch', async t => {
  const pending: Array<(sample: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000); t.after(() => engine.stop());
  engine.start('facetime-mic'); engine.switchLesson('facetime-camera');
  pending[0](observation([media('microphone', '1')])); await settle();
  assert.equal(engine.getState().lessonId, 'facetime-camera');
  assert.equal(engine.getState().target, null);
  engine.stop(); pending[1](observation([media('camera', '1')])); await settle();
  assert.equal(engine.getState().status, 'idle');
  assert.equal(engine.getState().target, null);
});

test('a newly identified neutral switch cannot reuse progress from a legacy action-label control', async t => {
  const legacy = (label: string): ObservedElement => ({ id: label, label, role: 'AXButton', enabled: true, rect: media('microphone').rect });
  const h = harness('facetime-mic', observation([legacy('Mute')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(observation([legacy('Unmute')]));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation([media('microphone', '0')]));
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().currentAction, 'mic-toggle');
  await h.tick(observation([media('microphone', '1')]));
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation([media('microphone', '0')]));
  assert.equal(h.engine.getState().status, 'complete');
});
