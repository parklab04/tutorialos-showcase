import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine } from '../../electron/features/live-guide/live-engine';
import type { LiveState, Observation, ObservedElement } from '../../src/features/live-guide/contracts';
import type { LessonId } from '../../src/features/lessons/types';

const safari = 'com.apple.Safari';
const windowRect = { x: 100, y: 80, width: 1000, height: 650 };
const item = (label: string, extra: Partial<ObservedElement> = {}): ObservedElement => ({ id: label, label, role: 'AXMenuItem', enabled: true, rect: { x: 200, y: 160, width: 250, height: 24 }, ...extra });
const anchor = (label: string) => item(label, { role: 'AXMenuBarItem', rect: { x: label === 'View' ? 200 : label === 'History' ? 250 : 330, y: 0, width: 75, height: 24 } });
const reader = () => item('Show Reader');
const bookmark = () => item('Add Bookmark…');
const reopen = () => item('Reopen Last Closed Tab');
const save = (extra: Partial<ObservedElement> = {}) => item('Add', { role: 'AXButton', scope: 'bookmark-sheet', rect: { x: 620, y: 290, width: 90, height: 32 }, ...extra });
const observation = (elements: ObservedElement[], extra: Partial<Observation> = {}): Observation => ({ trusted: true, screenCapture: true, frontmostBundleId: safari, frontmostName: 'Safari', timestamp: Date.now(), source: 'accessibility', window: windowRect, windowId: 'safari:1', elements, ...extra });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function harness(id: LessonId, initial: Observation) {
  let current = initial; let stamp = Date.now();
  const states: LiveState[] = [];
  const engine = new LiveEngine(async () => ({ ...current, timestamp: ++stamp }), state => states.push(state), 100000);
  engine.start(id);
  return { engine, states, set: (next: Observation) => { current = next; }, tick: async (next: Observation) => { current = next; await engine.poll(); } };
}
const menuLessons = [
  { id: 'safari-reader', menu: 'View', command: reader },
  { id: 'safari-reopen-tab', menu: 'History', command: reopen },
] as const;

test('Reader and reopen guide the real menu, then require explicit outcome confirmation', async t => {
  for (const { id, menu, command } of menuLessons) {
    const h = harness(id, observation([anchor(menu)])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().status, 'guiding');
    assert.deepEqual(h.engine.getState().target, anchor(menu).rect);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([anchor(menu), command()]));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.deepEqual(h.engine.getState().target, command().rect);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([anchor(menu)]));
    assert.equal(h.engine.getState().canConfirm, true);
    assert.equal(h.engine.getState().verification, null);
    assert.equal(h.engine.getState().target, null);
    // Menu closure may have been Escape. It must never claim an observed result.
    await h.tick(observation([anchor(menu)]));
    assert.notEqual(h.engine.getState().status, 'complete');
    h.engine.confirm();
    assert.equal(h.engine.getState().status, 'complete');
    assert.equal(h.engine.getState().verification, 'self-confirmed');
  }
});

test('bookmark progresses menu → Add Bookmark → scoped sheet Add, never saving by itself', async t => {
  const h = harness('safari-bookmark', observation([anchor('Bookmarks')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(observation([anchor('Bookmarks'), bookmark()]));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation([anchor('Bookmarks'), save()]));
  assert.equal(h.engine.getState().stepIndex, 2);
  assert.deepEqual(h.engine.getState().target, save().rect);
  h.engine.confirm(); assert.equal(h.engine.getState().status, 'guiding');
  await h.tick(observation([anchor('Bookmarks')]));
  assert.equal(h.engine.getState().canConfirm, true);
  assert.equal(h.engine.getState().verification, null);
  h.engine.confirm(); assert.equal(h.engine.getState().verification, 'self-confirmed');
});

test('a closed bookmark menu without its observed sheet cannot claim completion', async t => {
  const h = harness('safari-bookmark', observation([anchor('Bookmarks')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(observation([anchor('Bookmarks'), bookmark()]));
  await h.tick(observation([anchor('Bookmarks')]));
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.equal(h.engine.getState().canConfirm, false);
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
});

test('a page Add button, unscoped Add, wrong-role Add and out-of-window Add cannot impersonate the bookmark sheet', async t => {
  for (const invalid of [
    save({ scope: undefined }),
    save({ role: 'AXStaticText' }),
    save({ role: 'AXMenuItem' }),
    save({ rect: { x: 1200, y: 290, width: 90, height: 32 } }),
    save({ enabled: false }),
  ]) {
    const h = harness('safari-bookmark', observation([anchor('Bookmarks')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('Bookmarks'), bookmark()]));
    await h.tick(observation([anchor('Bookmarks'), invalid]));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('every Safari lesson requires AX permission even when screen recording is granted', async t => {
  for (const id of ['safari-zoom', 'safari-reader', 'safari-bookmark', 'safari-reopen-tab'] as const) {
    const h = harness(id, observation([anchor('View'), anchor('History'), anchor('Bookmarks')], { trusted: false, source: 'ocr' })); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().status, 'permission');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('granted AX with an OCR or missing sample waits without asking for another grant', async t => {
  for (const id of ['safari-zoom', 'safari-reader'] as const) for (const source of ['ocr', 'none'] as const) {
    const h = harness(id, observation([anchor('View'), reader()], { source })); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().status, 'waiting-control');
    assert.equal(h.engine.getState().permission.accessibility, true);
    assert.equal(h.engine.getState().target, null);
  }
});

test('Safari menu anchors require menu-bar roles, and commands require menu-item roles', async t => {
  for (const role of ['AXButton', 'AXStaticText', 'OCRLabel', 'AXMenuItem']) {
    const h = harness('safari-reader', observation([{ ...anchor('View'), role }])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null);
  }
  for (const role of ['AXButton', 'AXStaticText', 'OCRLabel', 'AXMenuBarItem']) {
    const h = harness('safari-reader', observation([anchor('View')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('View'), { ...reader(), role }]));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('disabled Reader and empty History receive useful waiting copy without guessed targets', async t => {
  for (const { id, menu, command } of menuLessons) {
    const h = harness(id, observation([anchor(menu)])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor(menu), { ...command(), enabled: false }]));
    assert.equal(h.engine.getState().status, 'waiting-control');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
    assert.match(h.engine.getState().title, id === 'safari-reader' ? /Reader is not available/ : /No closed tab/);
    assert.match(h.engine.getState().message, id === 'safari-reader' ? /article/ : /spare tab/);
    assert.doesNotMatch(h.engine.getState().message, /Check again/i);
  }
});

test('Reader already enabled explains how to start without inventing a completed action', async t => {
  const h = harness('safari-reader', observation([anchor('View'), item('Hide Reader')])); t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().title, 'Reader is already on');
  assert.equal(h.engine.getState().stepIndex, 0);
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().canConfirm, false);
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
});

test('disabled or ambiguous final controls are still present and cannot trigger confirmation', async t => {
  for (const commands of [
    [{ ...reader(), enabled: false }],
    [reader(), item('Show Reader', { rect: { x: 500, y: 160, width: 250, height: 24 } })],
  ]) {
    const h = harness('safari-reader', observation([anchor('View')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('View'), reader()]));
    await h.tick(observation([anchor('View'), ...commands]));
    assert.equal(h.engine.getState().canConfirm, false);
    assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([anchor('View')]));
    assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('replacement or moved Safari windows cannot advance an old menu or offer confirmation', async t => {
  for (const context of [{ windowId: 'safari:2' }, { window: { ...windowRect, x: 300 } }, { window: { ...windowRect, width: 900 } }]) {
    const h = harness('safari-reader', observation([anchor('View')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('View'), reader()], context));
    assert.equal(h.engine.getState().stepIndex, 0);
    await h.tick(observation([anchor('View'), reader()], context));
    assert.equal(h.engine.getState().stepIndex, 1);
    await h.tick(observation([anchor('View')], { windowId: 'safari:3', window: { ...windowRect, y: 120 } }));
    assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('Safari foreground switches and missing windows discard pending action evidence', async t => {
  for (const context of [{ frontmostBundleId: 'app.helpos.desktop' }, { window: null }, { observedBundleId: 'com.apple.finder' }]) {
    const h = harness('safari-reader', observation([anchor('View')])); t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('View'), reader()]));
    await h.tick(observation([anchor('View')], context));
    assert.equal(h.engine.getState().canConfirm, false);
    assert.equal(h.engine.getState().target, null);
    await h.tick(observation([anchor('View')]));
    assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('final disappearance needs the real menu anchor, not page text with the same name', async t => {
  const h = harness('safari-reader', observation([anchor('View')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(observation([anchor('View'), reader()]));
  await h.tick(observation([item('View', { role: 'AXStaticText' })]));
  assert.equal(h.engine.getState().canConfirm, false);
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  await h.tick(observation([anchor('View')]));
  assert.equal(h.engine.getState().canConfirm, false, 'unusable fresh evidence must discard the earlier final command');
});

test('stale samples cannot supply Safari action or confirmation evidence', async t => {
  let stamp = Date.now();
  let current = observation([anchor('View')], { timestamp: stamp });
  const engine = new LiveEngine(async () => current, () => {}, 100000); t.after(() => engine.stop());
  engine.start('safari-reader'); await settle();
  current = observation([anchor('View'), reader()], { timestamp: stamp }); await engine.poll();
  assert.equal(engine.getState().stepIndex, 0);
  current = observation([anchor('View'), reader()], { timestamp: ++stamp }); await engine.poll();
  assert.equal(engine.getState().stepIndex, 0);
  current = observation([anchor('View'), reader()], { timestamp: ++stamp }); await engine.poll();
  assert.equal(engine.getState().stepIndex, 1);
  current = observation([anchor('View')], { timestamp: stamp - 6000 }); await engine.poll();
  assert.equal(engine.getState().canConfirm, false);
  current = observation([anchor('View')], { timestamp: ++stamp }); await engine.poll();
  assert.equal(engine.getState().canConfirm, false);
});

test('Pause rejects self-confirmation and does not restore unobserved final evidence on resume', async t => {
  const h = harness('safari-reopen-tab', observation([anchor('History')])); t.after(() => h.engine.stop()); await settle();
  await h.tick(observation([anchor('History'), reopen()]));
  await h.tick(observation([anchor('History')]));
  assert.equal(h.engine.getState().canConfirm, true);
  h.engine.pause(); h.engine.confirm();
  assert.equal(h.engine.getState().status, 'paused');
  h.engine.resume(); await settle();
  assert.equal(h.engine.getState().canConfirm, false);
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
});

test('observer failure discards Safari action evidence before its next sample', async t => {
  let stamp = Date.now(); let fail = false; let elements = [anchor('View')];
  const engine = new LiveEngine(async () => {
    if (fail) throw new Error('Observer unavailable');
    return observation(elements, { timestamp: ++stamp });
  }, () => {}, 100000); t.after(() => engine.stop());
  engine.start('safari-reader'); await settle();
  elements = [anchor('View'), reader()]; await engine.poll();
  assert.equal(engine.getState().stepIndex, 1);
  fail = true; await engine.poll();
  assert.equal(engine.getState().status, 'error');
  assert.equal(engine.getState().target, null);
  fail = false; elements = [anchor('View')]; await engine.poll();
  assert.equal(engine.getState().canConfirm, false);
  engine.confirm(); assert.notEqual(engine.getState().status, 'complete');
});

test('Safari zoom requests Accessibility instead of trapping an OCR-only learner on View', async t => {
  const view = { ...anchor('View'), role: 'OCRLabel' };
  const zoom = item('Zoom In', { role: 'OCRLabel' });
  const context = { trusted: false, source: 'ocr' as const };
  const h = harness('safari-zoom', observation([view], context)); t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.getState().status, 'permission');
  assert.equal(h.engine.getState().target, null);
  for (const candidate of [zoom, { ...zoom, enabled: false }, { ...zoom, role: 'AXMenuItem' }]) {
    await h.tick(observation([view, candidate], context));
    assert.equal(h.engine.getState().status, 'permission');
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
  }
  await h.tick(observation([view, zoom], { ...context, trusted: true }));
  assert.equal(h.engine.getState().status, 'waiting-control');
  assert.equal(h.engine.getState().title, 'Waiting for Safari controls');
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().canConfirm, false);
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  // Only a new enabled Accessibility command can establish final-target history.
  await h.tick(observation([anchor('View'), item('Zoom In')]));
  assert.equal(h.engine.getState().stepIndex, 1);
  await h.tick(observation([anchor('View')]));
  assert.equal(h.engine.getState().canConfirm, true);
  h.engine.confirm(); assert.equal(h.engine.getState().verification, 'self-confirmed');
});

test('legacy zoom explains a disabled command and recovers directly without reopening the guide', async t => {
  const zoom = item('Zoom In');
  const disabled = { ...zoom, enabled: false };
  for (const initiallyOpen of [false, true]) {
    const h = harness('safari-zoom', observation(initiallyOpen ? [anchor('View'), disabled] : [anchor('View')]));
    t.after(() => h.engine.stop()); await settle();
    const sessionId = h.engine.getState().sessionId;
    await h.tick(observation([anchor('View'), disabled]));
    assert.equal(h.engine.getState().status, 'waiting-control');
    assert.equal(h.engine.getState().title, 'Zoom In is unavailable');
    assert.equal(h.engine.getState().message, 'Try another webpage, then open View.');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
    // No View-only sample or manual retry is needed when the command recovers.
    await h.tick(observation([anchor('View'), zoom]));
    assert.equal(h.engine.getState().sessionId, sessionId);
    assert.equal(h.engine.getState().status, 'guiding');
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.deepEqual(h.engine.getState().target, zoom.rect);
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(observation([anchor('View')]));
    assert.equal(h.engine.getState().canConfirm, true);
    assert.equal(h.engine.getState().verification, null);
    h.engine.confirm();
    assert.equal(h.engine.getState().verification, 'self-confirmed');
  }
});

test('disabled zoom and its disappearance never reuse earlier completion evidence', async t => {
  const zoom = item('Zoom In');
  for (const previouslyEnabled of [false, true]) {
    const h = harness('safari-zoom', observation([anchor('View')]));
    t.after(() => h.engine.stop()); await settle();
    if (previouslyEnabled) await h.tick(observation([anchor('View'), zoom]));
    await h.tick(observation([anchor('View'), { ...zoom, enabled: false }]));
    await h.tick(observation([anchor('View')]));
    assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(observation([anchor('View'), zoom]));
    assert.equal(h.engine.getState().status, 'guiding');
    assert.deepEqual(h.engine.getState().target, zoom.rect);
  }
});

test('a zoom guide can start on the observed open command without inventing an earlier click', async t => {
  const zoom = item('Zoom In');
  const h = harness('safari-zoom', observation([zoom]));
  t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.equal(h.engine.getState().status, 'guiding');
  assert.deepEqual(h.engine.getState().target, zoom.rect);
  assert.equal(h.engine.getState().canConfirm, false);
  assert.equal(h.engine.getState().verification, null);
});

test('legacy zoom only describes unavailable commands from unique valid AX menu evidence', async t => {
  const disabled = item('Zoom In', { enabled: false });
  const cases: { elements: ObservedElement[]; context?: Partial<Observation> }[] = [
    { elements: [] },
    { elements: [{ ...disabled, role: 'AXStaticText' }] },
    { elements: [{ ...disabled, role: 'OCRLabel' }], context: { trusted: false, source: 'ocr' } },
    { elements: [disabled], context: { trusted: false, source: 'accessibility' } },
    { elements: [disabled], context: { source: 'ocr' } },
    { elements: [{ ...disabled, rect: { ...disabled.rect, width: 1700 } }] },
    { elements: [disabled, { ...disabled, rect: { ...disabled.rect, x: 600 } }] },
    { elements: [disabled, { ...disabled, enabled: true }] },
  ];
  for (const { elements, context } of cases) {
    const h = harness('safari-zoom', observation([anchor('View')]));
    t.after(() => h.engine.stop()); await settle();
    await h.tick(observation([anchor('View'), ...elements], context));
    assert.notEqual(h.engine.getState().title, 'Zoom In is unavailable');
    assert.equal(h.engine.getState().canConfirm, false);
    assert.equal(h.engine.getState().verification, null);
  }
});

test('zoom recovery honors pause and current Safari context before guiding the command', async t => {
  const zoom = item('Zoom In');
  const h = harness('safari-zoom', observation([anchor('View'), { ...zoom, enabled: false }]));
  t.after(() => h.engine.stop()); await settle();
  h.engine.pause();
  await h.tick(observation([anchor('View'), zoom]));
  assert.equal(h.engine.getState().status, 'paused');
  assert.equal(h.engine.getState().target, null);
  h.set(observation([anchor('View'), zoom], { frontmostBundleId: 'com.apple.finder' }));
  h.engine.resume(); await settle();
  assert.equal(h.engine.getState().status, 'waiting-app');
  assert.equal(h.engine.getState().target, null);
  await h.tick(observation([anchor('View'), zoom]));
  assert.equal(h.engine.getState().stepIndex, 1);
  assert.deepEqual(h.engine.getState().target, zoom.rect);
  assert.equal(h.engine.getState().canConfirm, false);
});
