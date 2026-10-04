import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppHelpController, type AppInspection } from '../../electron/features/app-help/controller';
import type { CallObservation } from '../../electron/features/call-help/call-help';

const window = { x: 100, y: 100, width: 800, height: 600 };
const settle = () => new Promise(resolve => setImmediate(resolve));
const until = async (condition: () => boolean) => {
  for (let n = 0; n < 100; n++) { if (condition()) return; await new Promise(r => setTimeout(r, 2)); }
  assert.fail('Expected the next read-only call observation');
};
function setup() {
  const reads: Array<(sample: CallObservation) => void> = [];
  let stamp = Date.now() - 1000;
  let foreground = 'com.apple.FaceTime';
  let allowed = true;
  let inspections = 0;
  let inspect: (() => Promise<AppInspection>) | undefined;
  const controller = new AppHelpController({
    callInterval: 1,
    observeCall: () => new Promise(resolve => reads.push(resolve)),
    canOffer: () => allowed,
    inspect: async () => { inspections++; return inspect ? inspect() : { frontmostBundleId: foreground, timestamp: Date.now(), window }; },
    publish: () => {},
  });
  return {
    controller, reads, inspections: () => inspections,
    start: () => controller.setEnabled(true),
    busy: (value: boolean) => { allowed = !value; },
    activation: (bundleId = 'com.apple.FaceTime') => { foreground = bundleId; return controller.acceptActivation({ bundleId, activationId: randomUUID(), timestamp: ++stamp }); },
    deferInspection: () => { let release!: (value: AppInspection) => void; inspect = () => new Promise(resolve => { release = resolve; }); return () => release({ frontmostBundleId: foreground, timestamp: Date.now(), window }); },
    sample: async (state: CallObservation['state'], accessibility = true) => {
      await until(() => reads.length > 0);
      reads.shift()!({ state, accessibility, timestamp: ++stamp, callId: state === 'active' ? '42:7' : null, window: state === 'active' ? window : null });
      await settle();
    },
  };
}

test('On receives a real-call offer without any app activation; Off does not even observe', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  await settle(); assert.equal(s.reads.length, 0);
  s.start(); await s.sample('active');
  assert.equal(s.controller.getState().suggestion, null);
  await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.source, 'detected');
  assert.equal(s.controller.getState().suggestion?.app, 'facetime');
  assert.equal(s.inspections(), 0);
  assert.deepEqual(s.controller.getAnchor(), window);
});

test('same call stays dismissed, then another call offers without leaving FaceTime', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.sample('active'); await s.sample('active');
  const first = s.controller.getState().suggestion!.id;
  s.controller.dismiss();
  await s.sample('unknown'); await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion, null);
  for (let n = 0; n < 3; n++) await s.sample('inactive');
  await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.source, 'detected');
  assert.notEqual(s.controller.getState().suggestion?.id, first);
  assert.equal(s.inspections(), 0);
});

test('closing an app offer during an observed call cannot immediately produce a second popup', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.activation();
  const first = s.controller.getState().suggestion!.id;
  await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.id, first);
  s.controller.dismiss(); await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion, null);
});

test('an app offer dismissed before a call does not suppress that later call', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.activation(); await s.sample('inactive');
  s.controller.dismiss(); await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.source, 'detected');
});

test('returning to FaceTime preserves its visible detected offer; Safari can replace it', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.sample('active'); await s.sample('active');
  const first = s.controller.getState().suggestion!.id;
  await s.activation(); assert.equal(s.controller.getState().suggestion?.id, first);
  await s.activation('com.apple.Safari');
  assert.equal(s.controller.getState().suggestion?.app, 'safari');
  await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.app, 'safari');
});

test('a late positive call sample cannot override an in-flight Safari visit', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.sample('active');
  const release = s.deferInspection();
  const pending = s.activation('com.apple.Safari');
  await s.sample('active'); assert.equal(s.controller.getState().suggestion, null);
  release(); await pending;
  assert.equal(s.controller.getState().suggestion?.app, 'safari');
});

test('Off cancels a pending call read and never registers anything implicitly', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.sample('active');
  await until(() => s.reads.length > 0);
  s.controller.setEnabled(false); await s.sample('active');
  assert.deepEqual(s.controller.getState(), { enabled: false, status: 'off', suggestion: null });
});

test('manual guidance consumes the observed call without creating a deferred popup', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.busy(true); s.start(); await s.sample('active');
  s.controller.dismiss(); await s.sample('active');
  s.busy(false); await s.sample('active');
  assert.equal(s.controller.getState().suggestion, null);
});

test('permission absence never pretends a call exists and a preview stays explicit', async t => {
  const s = setup(); t.after(() => s.controller.dispose());
  s.start(); await s.sample('unknown', false); await s.sample('unknown', false);
  assert.equal(s.controller.getState().suggestion, null);
  s.controller.preview('safari'); const id = s.controller.getState().suggestion!.id;
  await s.sample('active'); await s.sample('active');
  assert.equal(s.controller.getState().suggestion?.source, 'preview');
  assert.equal(s.controller.getState().suggestion?.id, id);
  s.controller.dismiss(); await s.sample('active');
  assert.equal(s.controller.getState().suggestion, null);
});
