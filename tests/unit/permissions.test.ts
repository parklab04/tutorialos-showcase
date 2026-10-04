import test from 'node:test';
import assert from 'node:assert/strict';
import { createPermissionRequester } from '../../electron/features/permissions/permissions';
import type { PermissionKind } from '../../src/features/permissions/contracts';

function harness(reads: Array<boolean | Error>) {
  const events: string[] = [];
  const request = createPermissionRequester({
    readPermission: async kind => {
      events.push(`read:${kind}`);
      const result = reads.shift();
      if (result instanceof Error) throw result;
      assert.notEqual(result, undefined, 'Unexpected extra probe');
      return result!;
    },
    requestNative: async kind => { events.push(`request:${kind}`); },
    openSettings: async kind => { events.push(`settings:${kind}`); },
  });
  return { request, events };
}

test('permission coordinator does nothing until explicitly called', () => {
  const h = harness([]);
  assert.deepEqual(h.events, []);
});

test('already granted permissions do not prompt or open Settings', async () => {
  for (const kind of ['screen', 'accessibility'] as const) {
    const h = harness([true]);
    assert.deepEqual(await h.request(kind), { granted: true, settingsOpened: false });
    assert.deepEqual(h.events, [`read:${kind}`]);
  }
});

test('a positive follow-up probe confirms newly granted access', async () => {
  const h = harness([false, true]);
  assert.deepEqual(await h.request('screen'), { granted: true, settingsOpened: false });
  assert.deepEqual(h.events, ['read:screen', 'request:screen', 'read:screen']);
});

test('resolved native request is not proof of consent; opens the requested Settings pane', async () => {
  const h = harness([false, false]);
  assert.deepEqual(await h.request('accessibility'), { granted: false, settingsOpened: true });
  assert.deepEqual(h.events, ['read:accessibility', 'request:accessibility', 'read:accessibility', 'settings:accessibility']);
});

test('native rejection still rechecks consent and opens Settings when denied', async () => {
  const events: string[] = [];
  const request = createPermissionRequester({
    readPermission: async kind => { events.push(`read:${kind}`); return false; },
    requestNative: async kind => { events.push(`request:${kind}`); throw new Error('Denied'); },
    openSettings: async kind => { events.push(`settings:${kind}`); },
  });
  assert.deepEqual(await request('screen'), { granted: false, settingsOpened: true });
  assert.deepEqual(events, ['read:screen', 'request:screen', 'read:screen', 'settings:screen']);
});

test('consent granted despite a native rejection is confirmed by the probe', async () => {
  let probes = 0;
  const request = createPermissionRequester({
    readPermission: async () => ++probes === 2,
    requestNative: async () => { throw new Error('Capture failed'); },
    openSettings: async () => { assert.fail('Settings should not open after confirmed consent'); },
  });
  assert.deepEqual(await request('screen'), { granted: true, settingsOpened: false });
});

test('initial probe failure surfaces without requesting or claiming permission', async () => {
  const failure = new Error('Probe failed');
  const h = harness([failure]);
  await assert.rejects(h.request('screen'), error => error === failure);
  assert.deepEqual(h.events, ['read:screen']);
});

test('follow-up probe failure surfaces without opening Settings or claiming consent', async () => {
  const failure = new Error('Probe failed');
  const h = harness([false, failure]);
  await assert.rejects(h.request('screen'), error => error === failure);
  assert.deepEqual(h.events, ['read:screen', 'request:screen', 'read:screen']);
});

test('Settings failure surfaces and a later request can retry', async () => {
  const failure = new Error('Settings unavailable');
  let attempts = 0;
  const request = createPermissionRequester({
    readPermission: async () => false,
    requestNative: async () => {},
    openSettings: async () => { if (++attempts === 1) throw failure; },
  });
  await assert.rejects(request('screen'), error => error === failure);
  assert.deepEqual(await request('screen'), { granted: false, settingsOpened: true });
  assert.equal(attempts, 2);
});

test('repeated pending requests share one promise and native request', async () => {
  let release!: (value: boolean) => void;
  const firstProbe = new Promise<boolean>(resolve => { release = resolve; });
  let probes = 0; let prompts = 0; let settings = 0;
  const request = createPermissionRequester({
    readPermission: async () => ++probes === 1 ? firstProbe : false,
    requestNative: async () => { prompts++; },
    openSettings: async () => { settings++; },
  });
  const first = request('screen');
  const repeated = request('screen');
  assert.equal(first, repeated);
  release(false);
  assert.deepEqual(await first, { granted: false, settingsOpened: true });
  assert.equal(prompts, 1); assert.equal(settings, 1); assert.equal(probes, 2);
  await request('screen');
  assert.equal(prompts, 2); assert.equal(settings, 2);
});

test('different permission kinds are serialized so OS requests cannot overlap', async () => {
  let release!: () => void;
  const firstDialog = new Promise<void>(resolve => { release = resolve; });
  const events: string[] = [];
  const request = createPermissionRequester({
    readPermission: async kind => { events.push(`read:${kind}`); return false; },
    requestNative: async kind => { events.push(`request:${kind}`); if (kind === 'screen') await firstDialog; },
    openSettings: async kind => { events.push(`settings:${kind}`); },
  });
  const screen = request('screen');
  const accessibility = request('accessibility');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['read:screen', 'request:screen']);
  release();
  await Promise.all([screen, accessibility]);
  assert.deepEqual(events, ['read:screen', 'request:screen', 'read:screen', 'settings:screen', 'read:accessibility', 'request:accessibility', 'read:accessibility', 'settings:accessibility']);
});

test('a failed request does not block another permission kind in the queue', async () => {
  const failure = new Error('Screen probe failed');
  const probes: PermissionKind[] = [];
  const request = createPermissionRequester({
    readPermission: async kind => { probes.push(kind); if (kind === 'screen') throw failure; return true; },
    requestNative: async () => { assert.fail('Neither path should prompt'); },
    openSettings: async () => { assert.fail('Neither path should open Settings'); },
  });
  const screen = request('screen');
  const accessibility = request('accessibility');
  await assert.rejects(screen, error => error === failure);
  assert.deepEqual(await accessibility, { granted: true, settingsOpened: false });
  assert.deepEqual(probes, ['screen', 'accessibility']);
});
