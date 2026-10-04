import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine } from '../../electron/features/live-guide/live-engine';
import type { Observation } from '../../src/features/live-guide/contracts';

const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
const sample = (label = 'View'): Observation => ({
  trusted: true, screenCapture: false, source: 'accessibility',
  timestamp: Date.now(), frontmostBundleId: 'com.apple.Safari', frontmostName: 'Safari',
  window: { x: 100, y: 80, width: 900, height: 650 }, windowId: '20:100',
  elements: [{ id: label, role: label === 'View' ? 'AXMenuBarItem' : 'AXMenuItem', label,
    enabled: true, rect: { x: 200, y: label === 'View' ? 0 : 140, width: 100, height: 24 } }],
});

test('concurrent refreshes share one active read and cannot publish an older menu after a newer one', async t => {
  const pending: Array<(value: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000);
  t.after(() => engine.stop());
  engine.start('safari-zoom');
  const refresh = engine.poll();
  assert.equal(pending.length, 1, 'a second poll must not launch another read in this session');
  pending[0](sample());
  await refresh; await settle();
  assert.equal(engine.getState().status, 'guiding');
});

test('a stalled native read loses its old spotlight, then recovers from a fresh menu result', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  const pending: Array<(value: Observation) => void> = [];
  let calls = 0;
  const engine = new LiveEngine(() => {
    calls++;
    return calls === 1 ? Promise.resolve(sample()) : new Promise(resolve => pending.push(resolve));
  }, () => {}, 500);
  t.after(() => engine.stop());
  engine.start('safari-zoom'); await settle();
  assert.ok(engine.getState().target);
  t.mock.timers.tick(500); await settle();
  assert.equal(pending.length, 1);
  t.mock.timers.tick(1100); await settle();
  assert.equal(engine.getState().target, null, 'do not leave an old View outline up while native observation is stuck');
  assert.equal(engine.getState().status, 'observing');
  assert.equal(engine.getState().canConfirm, false);
  pending[0](sample('Zoom In')); await settle();
  assert.equal(engine.getState().status, 'guiding');
  assert.equal(engine.getState().currentAction, 'zoom-in');
  assert.equal(engine.getState().target?.y, 140);
});

test('an expired Safari final spotlight retains only history for fresh same-document learner confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 110000 });
  const pending: Array<(value: Observation) => void> = [];
  let calls = 0;
  const engine = new LiveEngine(() => ++calls === 1 ? Promise.resolve(sample('Zoom In')) :
    new Promise(resolve => pending.push(resolve)), () => {}, 500);
  t.after(() => engine.stop());
  engine.start('safari-zoom'); await settle();
  assert.equal(engine.getState().stepIndex, 1);
  assert.ok(engine.getState().target);
  t.mock.timers.tick(500); await settle();
  t.mock.timers.tick(1100); await settle();
  assert.equal(engine.getState().target, null);
  assert.equal(engine.getState().canConfirm, false, 'expired geometry alone cannot offer confirmation');
  engine.confirm(); assert.notEqual(engine.getState().status, 'complete');
  pending[0](sample()); await settle();
  assert.equal(engine.getState().target, null, 'historical bounds must never return as a spotlight');
  assert.equal(engine.getState().canConfirm, true, 'fresh menu closure may ask the learner about the outcome');
  assert.equal(engine.getState().verification, null, 'menu closure is not observed success');
  engine.confirm();
  assert.equal(engine.getState().verification, 'self-confirmed');
});

test('expired Safari history is invalidated by changed identity, access or unusable final-command evidence', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 120000 });
  const invalidSamples: Array<[string, () => Observation]> = [
    ['replacement window', () => ({ ...sample(), windowId: '20:200' })],
    ['missing window ID', () => ({ ...sample(), windowId: undefined })],
    ['moved window', () => ({ ...sample(), window: { ...sample().window!, x: 500 } })],
    ['missing window', () => ({ ...sample(), window: null })],
    ['lost AX access', () => ({ ...sample(), trusted: false, screenCapture: true })],
    ['OCR source', () => ({ ...sample(), source: 'ocr' })],
    ['different foreground', () => ({ ...sample(), frontmostBundleId: 'com.apple.finder' })],
    ['different observed app', () => ({ ...sample(), observedBundleId: 'com.apple.finder' })],
    ['missing menu anchor and final command', () => ({ ...sample(), elements: [] })],
    ['disabled final command', () => ({ ...sample('Zoom In'), elements: sample('Zoom In').elements.map(element => ({ ...element, enabled: false })) })],
    ['ambiguous final command', () => ({ ...sample('Zoom In'), elements: [sample('Zoom In').elements[0], { ...sample('Zoom In').elements[0], rect: { x: 500, y: 140, width: 100, height: 24 } }] })],
    ['mixed enabled and disabled final command', () => ({ ...sample('Zoom In'), elements: [sample('Zoom In').elements[0], { ...sample('Zoom In').elements[0], enabled: false }] })],
  ];
  for (const [reason, invalidSample] of invalidSamples) {
    let current = sample('Zoom In');
    const engine = new LiveEngine(async () => current, () => {}, 100000);
    t.after(() => engine.stop());
    engine.start('safari-zoom'); await settle();
    t.mock.timers.tick(1600); await settle();
    assert.equal(engine.getState().target, null);
    current = invalidSample(); await engine.poll();
    assert.equal(engine.getState().canConfirm, false, reason);
    t.mock.timers.tick(1);
    current = sample(); await engine.poll();
    assert.equal(engine.getState().canConfirm, false, `${reason} must not restore old history after returning`);
    engine.confirm(); assert.notEqual(engine.getState().status, 'complete');
    engine.stop();
  }
});

test('expiry cannot promote a menu anchor or a previous session into final-command history', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 150000 });
  let current = sample();
  const engine = new LiveEngine(async () => current, () => {}, 100000);
  t.after(() => engine.stop());
  engine.start('safari-zoom'); await settle();
  t.mock.timers.tick(1600);
  current = sample(); await engine.poll();
  assert.equal(engine.getState().canConfirm, false, 'View alone is not the requested action');
  t.mock.timers.tick(1);
  current = sample('Zoom In'); await engine.poll();
  const previousSession = engine.getState().sessionId;
  t.mock.timers.tick(1600);
  current = sample();
  engine.start('safari-zoom'); await settle();
  assert.notEqual(engine.getState().sessionId, previousSession);
  assert.equal(engine.getState().canConfirm, false);
  engine.confirm(); assert.notEqual(engine.getState().status, 'complete');
});

test('active polling includes read duration in its cadence rather than adding a full idle interval', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 200000 });
  const pending: Array<(value: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 500);
  t.after(() => engine.stop());
  engine.start('safari-zoom');
  t.mock.timers.tick(300);
  pending[0](sample()); await settle();
  t.mock.timers.tick(199); await settle();
  assert.equal(pending.length, 1);
  t.mock.timers.tick(1); await settle();
  assert.equal(pending.length, 2, 'the second read starts at 500ms, not 800ms');
});

test('pause and a new session invalidate the previous spotlight expiration and late read', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 300000 });
  const pending: Array<(value: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000);
  t.after(() => engine.stop());
  engine.start('safari-zoom'); pending[0](sample()); await settle();
  t.mock.timers.tick(1000);
  engine.pause();
  engine.start('safari-zoom'); pending[1](sample()); await settle();
  const sessionId = engine.getState().sessionId;
  t.mock.timers.tick(600); await settle();
  assert.equal(engine.getState().sessionId, sessionId);
  assert.equal(engine.getState().status, 'guiding');
  assert.ok(engine.getState().target, 'old expiration must not clear a new session target');
  engine.pause();
  t.mock.timers.tick(100000); await settle();
  assert.equal(engine.getState().status, 'paused');
  assert.equal(pending.length, 2);
});

test('a cancelled read cannot unlock another session’s pending observation', async t => {
  const pending: Array<(value: Observation) => void> = [];
  const engine = new LiveEngine(() => new Promise(resolve => pending.push(resolve)), () => {}, 100000);
  t.after(() => engine.stop());
  engine.start('safari-zoom');
  engine.start('safari-zoom');
  const sessionId = engine.getState().sessionId;
  pending[0](sample()); await settle();
  await engine.poll();
  assert.equal(pending.length, 2, 'the new session still owns its one pending read');
  assert.equal(engine.getState().target, null);
  pending[1](sample()); await settle();
  assert.equal(engine.getState().sessionId, sessionId);
  assert.ok(engine.getState().target);
});
