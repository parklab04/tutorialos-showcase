import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AppHelpController, type AppInspection } from '../../electron/features/app-help/controller';
import { createAppHelpService } from '../../electron/features/app-help/service';
import { createStartupSettings, type LoginSettings } from '../../electron/features/startup/startup';
import type { CallHelpState } from '../../src/features/call-help/contracts';

const off: LoginSettings = { openAtLogin: false, status: 'not-registered' };
const on: LoginSettings = { openAtLogin: true, status: 'enabled' };
const inspection: AppInspection = { frontmostBundleId: 'com.apple.Safari', window: { x: -1000, y: 30, width: 900, height: 650 }, timestamp: Date.now() };
function harness(initial: LoginSettings | Error = off) {
  let current = initial;
  let available = true;
  let reads = 0;
  let effect: 'confirm' | 'ignore' | 'throw' = 'confirm';
  let writeHook: (enabled: boolean) => void = () => {};
  let inspect: () => Promise<AppInspection> = async () => ({ ...inspection, timestamp: Date.now() });
  const writes: boolean[] = [];
  const published: CallHelpState[] = [];
  const controller = new AppHelpController({ inspect: () => inspect(), canOffer: () => true, publish: () => {} });
  const registration = createStartupSettings({
    available: () => available,
    read: () => { ++reads; if (current instanceof Error) throw current; return current; },
    write: enabled => {
      writes.push(enabled); writeHook(enabled);
      if (effect === 'throw') throw new Error('OS registration rejected');
      if (effect === 'confirm') current = enabled ? on : off;
    },
  });
  const service = createAppHelpService(controller, registration, state => published.push(state));
  return {
    controller, service, writes, published, reads: () => reads,
    observe: (value: LoginSettings | Error) => { current = value; },
    available: (value: boolean) => { available = value; },
    effect: (value: typeof effect) => { effect = value; },
    beforeWrite: (value: typeof writeHook) => { writeHook = value; },
    defer: () => { let resolve!: (value: AppInspection) => void; inspect = () => new Promise(r => { resolve = r; }); return () => resolve({ ...inspection, timestamp: Date.now() }); },
    event: () => ({ bundleId: 'com.apple.Safari', activationId: randomUUID(), timestamp: Date.now() - 100 }),
  };
}

// Every OS operation and foreground observation is injected; no registration occurs.
test('service construction and repeated refresh stay read-only and default off', () => {
  const h = harness();
  assert.equal(h.reads(), 0); assert.deepEqual(h.writes, []);
  assert.deepEqual(h.service.refresh(), { enabled: false, status: 'off', suggestion: null });
  h.service.refresh(); h.service.refresh();
  assert.equal(h.reads(), 3); assert.deepEqual(h.writes, []);
});

test('pending, missing service and read failure never claim automatic help is enabled', () => {
  const cases: Array<[LoginSettings | Error, string]> = [
    [{ openAtLogin: true, status: 'requires-approval' }, 'requires-approval'],
    [{ openAtLogin: false, status: 'requires-approval' }, 'requires-approval'],
    [{ openAtLogin: false, status: 'not-found' }, 'unavailable'],
    [new Error('OS state unreadable'), 'unavailable'],
  ];
  for (const [state, status] of cases) {
    const h = harness(state);
    assert.deepEqual(h.service.refresh(), { enabled: false, status, suggestion: null });
    assert.deepEqual(h.writes, []);
  }
});

test('an unavailable platform neither reads nor writes the OS service', () => {
  const h = harness(); h.available(false);
  assert.deepEqual(h.service.refresh(), { enabled: false, status: 'unavailable', suggestion: null });
  for (const enabled of [true, false]) assert.throws(() => h.service.set(enabled), /installed Mac app/);
  assert.equal(h.reads(), 0); assert.deepEqual(h.writes, []);
  assert.equal(h.published.at(-1)?.status, 'unavailable');
});

test('positive OS readback enables the controller without a write', () => {
  const h = harness(on);
  assert.deepEqual(h.service.refresh(), { enabled: true, status: 'watching', suggestion: null });
  assert.deepEqual(h.writes, []);
});

test('external disable clears an existing offer and cannot restore a cached preference', async () => {
  const h = harness(on); h.service.refresh();
  await h.controller.acceptActivation(h.event());
  assert.equal(h.controller.getState().suggestion?.app, 'safari');
  h.observe(off);
  assert.deepEqual(h.service.refresh(), { enabled: false, status: 'off', suggestion: null });
  assert.equal(h.controller.getAnchor(), null); assert.deepEqual(h.writes, []);
  h.service.refresh(); assert.deepEqual(h.writes, []);
});

test('off invalidates pending observation before unregistering the watcher', async () => {
  const h = harness(on); h.service.refresh(); const resolve = h.defer();
  const pending = h.controller.acceptActivation(h.event());
  h.beforeWrite(enabled => {
    assert.equal(enabled, false);
    assert.equal(h.controller.getState().enabled, false);
    assert.equal(h.controller.getState().suggestion, null);
  });
  assert.equal(h.service.set(false).status, 'off');
  resolve(); await pending;
  assert.deepEqual(h.controller.getState(), { enabled: false, status: 'off', suggestion: null });
  assert.deepEqual(h.writes, [false]);
});

test('explicit enable and disable publish only OS-confirmed results', () => {
  const h = harness(); h.service.refresh();
  h.beforeWrite(enabled => { if (enabled) assert.equal(h.controller.getState().enabled, false); });
  assert.equal(h.service.set(true).enabled, true);
  assert.equal(h.service.set(false).enabled, false);
  assert.deepEqual(h.writes, [true, false]);
  assert.deepEqual(h.published.map(state => [state.enabled, state.status]), [[true, 'watching'], [false, 'off']]);
});

test('an approval-pending enable remains disabled until a later read confirms approval', () => {
  const h = harness(); h.effect('ignore');
  h.beforeWrite(() => h.observe({ openAtLogin: false, status: 'requires-approval' }));
  assert.deepEqual(h.service.set(true), { enabled: false, status: 'requires-approval', suggestion: null });
  h.observe(on); assert.equal(h.service.refresh().enabled, true);
  assert.deepEqual(h.writes, [true]);
});

test('a pending request can be explicitly cancelled and confirmed off', () => {
  const h = harness({ openAtLogin: false, status: 'requires-approval' }); h.service.refresh();
  assert.deepEqual(h.service.set(false), { enabled: false, status: 'off', suggestion: null });
  assert.deepEqual(h.writes, [false]);
});

for (const enabled of [true, false]) {
  test(`${enabled ? 'enable' : 'disable'} rejection surfaces the error and publishes actual OS state`, () => {
    const h = harness(enabled ? off : on); h.service.refresh(); h.effect('throw');
    assert.throws(() => h.service.set(enabled), /OS registration rejected/);
    assert.equal(h.published.at(-1)?.enabled, !enabled);
    assert.equal(h.published.at(-1)?.status, enabled ? 'off' : 'watching');
    assert.deepEqual(h.writes, [enabled]);
  });
  test(`ineffective ${enabled ? 'enable' : 'disable'} cannot claim a successful change`, () => {
    const h = harness(enabled ? off : on); h.service.refresh(); h.effect('ignore');
    assert.throws(() => h.service.set(enabled), /did not confirm the change/);
    assert.equal(h.published.at(-1)?.enabled, !enabled);
    assert.deepEqual(h.writes, [enabled]);
  });
}

test('failed unregister still cancels old pending work even if OS readback remains enabled', async () => {
  const h = harness(on); h.service.refresh(); const resolve = h.defer();
  const pending = h.controller.acceptActivation(h.event()); h.effect('throw');
  h.beforeWrite(() => assert.equal(h.controller.getState().enabled, false));
  assert.throws(() => h.service.set(false), /OS registration rejected/);
  assert.equal(h.controller.getState().enabled, true);
  resolve(); await pending;
  assert.equal(h.controller.getState().suggestion, null);
});
