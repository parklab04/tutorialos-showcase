import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupSettings, type LoginSettings } from '../../electron/features/startup/startup';
import { isBackgroundLaunch } from '../../electron/features/startup/launch';

function harness(initial: LoginSettings = { openAtLogin: false, status: 'not-registered' }) {
  let current: LoginSettings | Error = initial;
  let available = true;
  const events: Array<string | boolean> = [];
  const startup = createStartupSettings({
    available: () => available,
    read: () => { events.push('read'); if (current instanceof Error) throw current; return current; },
    write: enabled => { events.push(enabled); },
  });
  return {
    startup, events,
    observe(value: LoginSettings | Error) { current = value; },
    available(value: boolean) { available = value; },
  };
}

// Every OS dependency is injected. These tests never register a real login item.
test('startup construction and repeated reads never register a login item', () => {
  const h = harness();
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.startup.get(), { available: true, enabled: false, status: 'off' });
  h.startup.get();
  assert.deepEqual(h.events, ['read', 'read']);
});

test('an external OS disable is reflected without restoring a cached preference', () => {
  const h = harness({ openAtLogin: true, status: 'enabled' });
  assert.equal(h.startup.get().enabled, true);
  h.observe({ openAtLogin: false, status: 'not-registered' });
  assert.deepEqual(h.startup.get(), { available: true, enabled: false, status: 'off' });
  assert.deepEqual(h.events, ['read', 'read']);
});

test('pending approval never claims that automatic startup is enabled', () => {
  for (const openAtLogin of [true, false]) {
    const h = harness({ openAtLogin, status: 'requires-approval' });
    assert.deepEqual(h.startup.get(), { available: true, enabled: false, status: 'requires-approval' });
    assert.deepEqual(h.startup.set(true), { available: true, enabled: false, status: 'requires-approval' });
    assert.deepEqual(h.events, ['read', true, 'read']);
  }
});

test('enabling reports success only after positive OS readback', () => {
  const events: Array<string | boolean> = [];
  let state: LoginSettings = { openAtLogin: false, status: 'not-registered' };
  const startup = createStartupSettings({
    available: () => true,
    read: () => { events.push('read'); return state; },
    write: enabled => { events.push(enabled); state = { openAtLogin: true, status: 'enabled' }; },
  });
  assert.deepEqual(startup.set(true), { available: true, enabled: true, status: 'enabled' });
  assert.deepEqual(events, [true, 'read']);
});

test('a silently ineffective registration is rejected', () => {
  const h = harness();
  assert.throws(() => h.startup.set(true), /did not confirm the change/);
  assert.deepEqual(h.events, [true, 'read']);
  assert.equal(h.startup.get().enabled, false);
});

test('conflicting readback fields cannot claim enabled startup', () => {
  for (const state of [
    { openAtLogin: false, status: 'enabled' },
    { openAtLogin: true, status: 'not-registered' },
  ] as const) {
    const h = harness(state);
    assert.equal(h.startup.get().enabled, false);
    assert.throws(() => h.startup.set(true), /did not confirm the change/);
  }
});

test('an unavailable platform neither reads nor mutates OS login items', () => {
  const h = harness();
  h.available(false);
  assert.deepEqual(h.startup.get(), { available: false, enabled: false, status: 'unavailable' });
  for (const enabled of [true, false]) assert.throws(() => h.startup.set(enabled), /installed Mac app/);
  assert.deepEqual(h.events, []);
});

test('a missing service is unavailable and cannot confirm either change', () => {
  for (const enabled of [true, false]) {
    const h = harness({ openAtLogin: false, status: 'not-found' });
    assert.deepEqual(h.startup.get(), { available: true, enabled: false, status: 'unavailable' });
    assert.throws(() => h.startup.set(enabled), /did not confirm the change/);
  }
});

test('read failure is unavailable rather than a false enabled or off result', () => {
  const h = harness();
  h.observe(new Error('OS settings cannot be read'));
  assert.deepEqual(h.startup.get(), { available: true, enabled: false, status: 'unavailable' });
  for (const enabled of [true, false]) assert.throws(() => h.startup.set(enabled), /did not confirm the change/);
});

test('native write rejection surfaces without claiming success or reading stale state', () => {
  const failure = new Error('Registration denied');
  let reads = 0;
  const startup = createStartupSettings({
    available: () => true,
    read: () => { reads++; return { openAtLogin: true, status: 'enabled' }; },
    write: () => { throw failure; },
  });
  assert.throws(() => startup.set(true), error => error === failure);
  assert.equal(reads, 0);
});

test('disabling is confirmed from fresh OS readback', () => {
  const events: Array<string | boolean> = [];
  let state: LoginSettings = { openAtLogin: true, status: 'enabled' };
  const startup = createStartupSettings({
    available: () => true,
    read: () => { events.push('read'); return state; },
    write: enabled => { events.push(enabled); state = { openAtLogin: false, status: 'not-registered' }; },
  });
  assert.equal(startup.get().enabled, true);
  assert.deepEqual(startup.set(false), { available: true, enabled: false, status: 'off' });
  assert.deepEqual(events, ['read', false, 'read']);
});

test('ineffective disable and lingering approval both reject confirmation', () => {
  for (const status of ['enabled', 'requires-approval'] as const) {
    const h = harness({ openAtLogin: true, status });
    assert.throws(() => h.startup.set(false), /did not confirm the change/);
    assert.deepEqual(h.events, [false, 'read']);
  }
});

test('manual launch shows home while a real login indicator selects background launch', () => {
  assert.equal(isBackgroundLaunch(['HelpOS'], false), false);
  assert.equal(isBackgroundLaunch(['HelpOS'], true), true);
});

test('the explicit background flag supports quiet manual launches', () => {
  for (const login of [true, false]) assert.equal(isBackgroundLaunch(['HelpOS', '--background'], login), true);
  assert.equal(isBackgroundLaunch(['HelpOS', '--background=false'], false), false);
});

test('explicit preview takes precedence over both login and background requests', () => {
  for (const login of [true, false]) {
    assert.equal(isBackgroundLaunch(['HelpOS', '--preview-call-help'], login), false);
    assert.equal(isBackgroundLaunch(['HelpOS', '--background', '--preview-call-help'], login), false);
  }
});
