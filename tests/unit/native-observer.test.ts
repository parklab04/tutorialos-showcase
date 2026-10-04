import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeReader, type NativeRead } from '../../electron/platform/native-observer';

test('native reader parses the worker result and rejects native errors', async () => {
  const read = createNativeReader((_command, done) => done(null, '{"trusted":true}'));
  assert.deepEqual(await read('--probe'), { trusted: true });
  for (const text of ['{"error":"observer_timeout"}', '{broken', 'x'.repeat(262145)]) {
    await assert.rejects(createNativeReader((_command, done) => done(null, text))('--probe'));
  }
});

test('pre-cancelled observations never enter native code', async () => {
  const controller = new AbortController(); controller.abort();
  let called = false;
  await assert.rejects(createNativeReader(() => { called = true; })('--probe', controller.signal), /cancelled/);
  assert.equal(called, false);
});

test('cancellation ignores a late worker result and later requests still work', async () => {
  let done: Parameters<NativeRead>[1] | undefined;
  const read = createNativeReader((_command, callback) => { done = callback; });
  const controller = new AbortController();
  const pending = read('--probe', controller.signal);
  controller.abort();
  await assert.rejects(pending, /cancelled/);
  done!(null, '{"trusted":true}');
  const next = read('--probe');
  done!(null, '{"trusted":false}');
  assert.deepEqual(await next, { trusted: false });
});

test('a stalled native worker times out and discards its late result', async () => {
  let done: Parameters<NativeRead>[1] | undefined;
  const read = createNativeReader((_command, callback) => { done = callback; }, 10);
  await assert.rejects(read('--probe'), /timed out/);
  done!(null, '{"trusted":true}');
});

test('worker and binding failures reject instead of producing screen evidence', async () => {
  await assert.rejects(createNativeReader((_command, done) => done(new Error('worker failed')))('--probe'), /worker failed/);
  await assert.rejects(createNativeReader(() => { throw new Error('binding failed'); })('--probe'), /binding failed/);
});
