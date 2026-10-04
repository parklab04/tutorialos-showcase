import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppHelpController, type AppActivation, type AppInspection } from '../../electron/features/app-help/controller';
import type { CallHelpState } from '../../src/features/call-help/contracts';

const window = { x: -1200, y: 20, width: 1100, height: 720 };
function setup() {
  let tick = Date.now() - 1000;
  let allowed = true;
  let inspection: Partial<AppInspection> = {};
  let error = false;
  let reads = 0;
  let inspect: (() => Promise<AppInspection>) | undefined;
  const events: CallHelpState[] = [];
  const controller = new AppHelpController({
    canOffer: () => allowed,
    publish: state => events.push(state),
    inspect: async () => {
      ++reads;
      if (inspect) return inspect();
      if (error) throw new Error('Temporary window read failure');
      return { frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now(), ...inspection };
    },
  });
  return {
    controller, events, reads: () => reads,
    event: (patch: Partial<AppActivation> = {}): AppActivation => ({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: ++tick, ...patch }),
    inspection: (value: Partial<AppInspection>) => { inspection = value; },
    busy: (value: boolean) => { allowed = !value; },
    error: (value: boolean) => { error = value; },
    defer: () => { let resolve!: (value: AppInspection) => void; inspect = () => new Promise(r => { resolve = r; }); return (value: Partial<AppInspection> = {}) => resolve({ frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now(), ...value }); },
  };
}

for (const [bundleId, app] of [['com.apple.FaceTime', 'facetime'], ['com.apple.Safari', 'safari'], ['com.apple.finder', 'finder']] as const) {
  test(`${app} activation presents only its app choice with the inspected window`, async () => {
    const s = setup(); s.controller.setEnabled(true); s.inspection({ frontmostBundleId: bundleId });
    const event = s.event({ bundleId }); await s.controller.acceptActivation(event);
    assert.deepEqual(s.controller.getState(), { enabled: true, status: 'watching', suggestion: { id: event.activationId, source: 'activation', app, window } });
    assert.deepEqual(s.controller.getAnchor(), window); assert.equal(s.reads(), 1);
    const state = s.controller.getState(); state.suggestion!.window!.width = 1;
    const anchor = s.controller.getAnchor()!; anchor.x = 1;
    assert.deepEqual(s.controller.getAnchor(), window);
    assert.deepEqual(s.controller.getState().suggestion?.window, window);
  });
}

test('default off ignores a wake and cannot replay it after enabling', async () => {
  const s = setup(); const event = s.event(); await s.controller.acceptActivation(event);
  assert.equal(s.reads(), 0); assert.equal(s.controller.getState().suggestion, null);
  s.controller.setEnabled(true); await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  assert.equal(s.reads(), 0);
});

test('a dismissed visit stays consumed through duplicates, off/on and HelpOS focus bounce', async () => {
  const s = setup(); s.controller.setEnabled(true); const event = s.event();
  await s.controller.acceptActivation(event); s.controller.dismiss();
  s.inspection({ frontmostBundleId: 'com.helpos.desktop' });
  await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  s.controller.setEnabled(false); s.controller.setEnabled(true);
  s.inspection({ frontmostBundleId: event.bundleId });
  await s.controller.acceptActivation({ ...event, activationId: event.activationId.toUpperCase(), timestamp: event.timestamp + 2 });
  assert.equal(s.controller.getState().suggestion, null); assert.equal(s.reads(), 1);
});

test('a new visit after genuine leave or reopening can offer again', async () => {
  const s = setup(); s.controller.setEnabled(true); const first = s.event();
  await s.controller.acceptActivation(first); s.controller.dismiss();
  const second = s.event(); await s.controller.acceptActivation(second);
  assert.equal(s.controller.getState().suggestion?.id, second.activationId);
  assert.notEqual(second.activationId, first.activationId);
});

test('a new Safari window episode can offer after dismissal while Safari stays frontmost', async () => {
  const s = setup(); s.controller.setEnabled(true);
  const bundleId = 'com.apple.Safari';
  s.inspection({ frontmostBundleId: bundleId });
  const first = s.event({ bundleId });
  await s.controller.acceptActivation(first); s.controller.dismiss();
  const reopenedWindow = { x: 220, y: 120, width: 900, height: 650 };
  s.inspection({ frontmostBundleId: bundleId, window: reopenedWindow });
  await s.controller.acceptActivation(s.event({ bundleId, activationId: first.activationId }));
  assert.equal(s.controller.getState().suggestion, null);
  assert.equal(s.reads(), 1, 'New bounds cannot replay the dismissed episode');
  const reopened = s.event({ bundleId });
  await s.controller.acceptActivation(reopened);
  assert.equal(s.reads(), 2);
  assert.deepEqual(s.controller.getState().suggestion, {
    id: reopened.activationId, source: 'activation', app: 'safari', window: reopenedWindow,
  });
  assert.deepEqual(s.controller.getAnchor(), reopenedWindow);
});

test('unsupported apps, malformed IDs and invalid times never inspect or poison later events', async () => {
  const s = setup(); s.controller.setEnabled(true);
  const invalid: Partial<AppActivation>[] = [
    { bundleId: 'com.apple.TextEdit' }, { bundleId: 'com.apple.Finder' }, { bundleId: '__proto__' },
    { activationId: 'not-a-uuid' }, { activationId: '00000000-0000-0000-0000-000000000000' },
    { timestamp: Date.now() - 16000 }, { timestamp: Date.now() + 3000 }, { timestamp: NaN }, { timestamp: Infinity },
  ];
  for (const patch of invalid) await s.controller.acceptActivation(s.event(patch));
  assert.equal(s.reads(), 0); assert.equal(s.controller.getState().suggestion, null);
  await s.controller.acceptActivation(s.event()); assert.equal(s.reads(), 1);
});

test('a new ID with an equal or older timestamp cannot replace the latest offer', async () => {
  const s = setup(); s.controller.setEnabled(true); const first = s.event();
  await s.controller.acceptActivation(first);
  await s.controller.acceptActivation(s.event({ timestamp: first.timestamp }));
  await s.controller.acceptActivation(s.event({ timestamp: first.timestamp - 1 }));
  assert.equal(s.reads(), 1); assert.equal(s.controller.getState().suggestion?.id, first.activationId);
});

test('busy guides consume events without queueing a later offer', async () => {
  const s = setup(); s.controller.setEnabled(true); s.busy(true); const event = s.event();
  await s.controller.acceptActivation(event); s.busy(false);
  await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  assert.equal(s.reads(), 0); assert.equal(s.controller.getState().suggestion, null);
});

test('preview remains available while off and drops arriving events without replacing Practice', async () => {
  const s = setup(); s.controller.preview('finder');
  assert.equal(s.controller.getState().enabled, false);
  assert.equal(s.controller.getState().suggestion?.app, 'finder');
  s.controller.setEnabled(true); s.controller.preview('safari');
  const previewId = s.controller.getState().suggestion?.id;
  const event = s.event(); await s.controller.acceptActivation(event);
  assert.equal(s.controller.getState().suggestion?.id, previewId);
  assert.equal(s.controller.getState().suggestion?.source, 'preview');
  s.controller.dismiss(); await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  assert.equal(s.controller.getState().suggestion, null); assert.equal(s.reads(), 0);
});

for (const action of ['disable', 'dismiss', 'preview', 'dispose'] as const) {
  test(`${action} cancels an in-flight inspection and prevents replay`, async () => {
    const s = setup(); s.controller.setEnabled(true); const resolve = s.defer(); const event = s.event();
    const pending = s.controller.acceptActivation(event);
    if (action === 'disable') { s.controller.setEnabled(false); s.controller.setEnabled(true); }
    else s.controller[action]();
    const expected = s.controller.getState();
    resolve(); await pending;
    assert.deepEqual(s.controller.getState(), expected);
    await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
    assert.equal(s.reads(), 1); assert.deepEqual(s.controller.getState(), expected);
  });
}

test('a duplicate during inspection does not cancel the original presentation', async () => {
  const s = setup(); s.controller.setEnabled(true); const resolve = s.defer(); const event = s.event();
  const pending = s.controller.acceptActivation(event);
  await s.controller.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  resolve(); await pending;
  assert.equal(s.reads(), 1); assert.equal(s.controller.getState().suggestion?.id, event.activationId);
});

test('a newer activation wins when an older inspection resolves later', async () => {
  const s = setup(); s.controller.setEnabled(true); const resolveFirst = s.defer();
  const first = s.controller.acceptActivation(s.event());
  const resolveSecond = s.defer(); const event = s.event({ bundleId: 'com.apple.Safari' });
  const second = s.controller.acceptActivation(event);
  resolveSecond({ frontmostBundleId: event.bundleId }); await second;
  resolveFirst(); await first;
  assert.equal(s.controller.getState().suggestion?.id, event.activationId);
  assert.equal(s.controller.getState().suggestion?.app, 'safari');
});

test('starting a guide while inspection is pending suppresses presentation', async () => {
  const s = setup(); s.controller.setEnabled(true); const resolve = s.defer();
  const pending = s.controller.acceptActivation(s.event()); s.busy(true);
  resolve(); await pending;
  assert.equal(s.controller.getState().suggestion, null); assert.equal(s.controller.getAnchor(), null);
});

test('foreground changes, stale observations and invalid windows cannot create an offer', async () => {
  const s = setup(); s.controller.setEnabled(true);
  const invalid: Partial<AppInspection>[] = [
    { frontmostBundleId: 'com.apple.Safari' }, { frontmostBundleId: 'com.helpos.desktop' },
    { timestamp: Date.now() - 16000 }, { timestamp: Date.now() + 3000 },
    { window: null }, { window: { ...window, width: 0 } }, { window: { ...window, height: -1 } },
    { window: { ...window, x: NaN } }, { window: { ...window, y: Infinity } },
  ];
  for (const observation of invalid) {
    s.inspection(observation); await s.controller.acceptActivation(s.event());
    assert.equal(s.controller.getState().suggestion, null); assert.equal(s.controller.getAnchor(), null);
  }
});

test('inspection failure is unavailable and a fresh visit can recover without permissions', async () => {
  const s = setup(); s.controller.setEnabled(true); s.error(true);
  await s.controller.acceptActivation(s.event());
  assert.equal(s.controller.getState().status, 'unavailable'); assert.equal(s.controller.getState().suggestion, null);
  s.error(false); await s.controller.acceptActivation(s.event());
  assert.equal(s.controller.getState().status, 'watching'); assert.equal(s.controller.getState().suggestion?.source, 'activation');
});

test('the oldest original event stays stale after more than 64 visits', async () => {
  const s = setup(); s.controller.setEnabled(true); const first = s.event();
  await s.controller.acceptActivation(first);
  for (let i = 0; i < 70; i++) await s.controller.acceptActivation(s.event());
  const latest = s.controller.getState().suggestion?.id;
  await s.controller.acceptActivation(first);
  assert.equal(s.reads(), 71); assert.equal(s.controller.getState().suggestion?.id, latest);
});


test('fresh matching activation recovers a setup guide without creating a second help window', async t => {
  let recovery = true; let inspections = 0; let recoveries = 0;
  const c = new AppHelpController({ canOffer: () => false, publish: () => {},
    canRecoverGuide: bundle => recovery && bundle === 'com.apple.FaceTime',
    recoverGuide: () => { recoveries++; recovery = false; return true; },
    inspect: async () => { inspections++; return { frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now() }; },
  });
  t.after(() => c.dispose()); c.setEnabled(true);
  const event = { bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() };
  await c.acceptActivation(event);
  assert.equal(inspections, 1); assert.equal(recoveries, 1); assert.equal(c.getState().suggestion, null);
  await c.acceptActivation({ ...event, timestamp: event.timestamp + 1 });
  assert.equal(recoveries, 1);
});

test('Off or stale app events cannot restart permission recovery', async t => {
  let recovered = 0; let reads = 0;
  const c = new AppHelpController({ canOffer: () => false, publish: () => {}, canRecoverGuide: () => true,
    recoverGuide: () => { recovered++; return true; },
    inspect: async () => { reads++; return { frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now() }; },
  });
  t.after(() => c.dispose());
  await c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() });
  c.setEnabled(true);
  await c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() - 16000 });
  assert.equal(reads, 0); assert.equal(recovered, 0);
});

test('Off while context is being read cancels permission-guide recovery', async t => {
  let resolve!: (value: AppInspection) => void; let recovered = 0;
  const c = new AppHelpController({ canOffer: () => false, publish: () => {}, canRecoverGuide: () => true,
    recoverGuide: () => { recovered++; return true; }, inspect: () => new Promise(r => { resolve = r; }),
  });
  t.after(() => c.dispose()); c.setEnabled(true);
  const pending = c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() });
  c.setEnabled(false); resolve({ frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now() }); await pending;
  assert.equal(recovered, 0); assert.equal(c.getState().suggestion, null);
});

test('wrong foreground or a deliberate pause prevents permission-guide recovery', async t => {
  let eligible = true; let recovered = 0; let reads = 0;
  const c = new AppHelpController({ canOffer: () => false, publish: () => {}, canRecoverGuide: () => eligible,
    recoverGuide: () => { recovered++; return true; },
    inspect: async () => { reads++; return { frontmostBundleId: 'com.google.Chrome', window, timestamp: Date.now() }; },
  });
  t.after(() => c.dispose()); c.setEnabled(true); const now = Date.now();
  await c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: now });
  eligible = false;
  await c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: now + 1 });
  assert.equal(reads, 1); assert.equal(recovered, 0);
});


for (const action of ['publication', 'close'] as const) {
  test(`a guide ${action} during inspection handles permission recovery without losing user intent`, async t => {
    let resolve!: (value: AppInspection) => void; let recovered = 0;
    const c = new AppHelpController({ canOffer: () => false, publish: () => {}, canRecoverGuide: () => true,
      recoverGuide: () => { recovered++; return true; }, inspect: () => new Promise(r => { resolve = r; }),
    });
    t.after(() => c.dispose()); c.setEnabled(true);
    const pending = c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() });
    if (action === 'publication') c.suppressForGuide(); else c.dismiss();
    resolve({ frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now() }); await pending;
    assert.equal(recovered, action === 'publication' ? 1 : 0); assert.equal(c.getState().suggestion, null);
  });
}


test('closing a guide during recovery never converts that visit into a new offer', async t => {
  let guideOpen = true; let recovered = 0; let resolve!: (value: AppInspection) => void;
  const c = new AppHelpController({ canOffer: () => !guideOpen, publish: () => {},
    canRecoverGuide: () => guideOpen, recoverGuide: () => { recovered++; return true; },
    inspect: () => new Promise(r => { resolve = r; }),
  });
  t.after(() => c.dispose()); c.setEnabled(true);
  const pending = c.acceptActivation({ bundleId: 'com.apple.FaceTime', activationId: randomUUID(), timestamp: Date.now() });
  guideOpen = false;
  resolve({ frontmostBundleId: 'com.apple.FaceTime', window, timestamp: Date.now() }); await pending;
  assert.equal(recovered, 0); assert.equal(c.getState().suggestion, null);
});
