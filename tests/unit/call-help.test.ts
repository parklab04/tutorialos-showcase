import test from 'node:test';
import assert from 'node:assert/strict';
import { CallHelpMonitor, type CallObservation } from '../../electron/features/call-help/call-help';
import type { CallHelpState } from '../../src/features/call-help/contracts';

const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function setup() {
  let tick = Date.now() - 1000;
  let observation: Partial<CallObservation> = { state: 'active' };
  let permitted = true;
  let fault: 'stale' | 'error' | 'permission' | null = null;
  const events: CallHelpState[] = [];
  const monitor = new CallHelpMonitor({
    interval: 100000,
    canOffer: () => permitted,
    observe: async () => {
      if (fault === 'error') throw new Error('Observer temporarily unavailable');
      return { accessibility: fault !== 'permission', state: 'active', callId: '123:4', window: { x: -1200, y: 10, width: 1000, height: 700 }, ...observation, timestamp: fault === 'stale' ? Date.now() - 10000 : ++tick };
    },
    publish: state => events.push(state),
  });
  return { monitor, events, fault: (value: typeof fault) => { fault = value; }, set: (value: Partial<CallObservation>) => { observation = value; }, busy: (value: boolean) => { permitted = !value; }, start: async () => { monitor.setEnabled(true); await nextTurn(); }, poll: () => monitor.poll() };
}

test('two positive observations offer help without starting a tutorial', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); assert.equal(s.monitor.getState().suggestion, null);
  await s.poll(); assert.equal(s.monitor.getState().suggestion?.source, 'detected');
  assert.deepEqual(s.monitor.getAnchor(), { x: -1200, y: 10, width: 1000, height: 700 });
});

test('dismiss stays dismissed through hidden controls, window changes and off/on', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll(); s.monitor.dismiss();
  s.set({ state: 'unknown' }); await s.poll();
  s.set({ state: 'active', callId: '123:5' }); await s.poll(); await s.poll();
  s.monitor.setEnabled(false); await s.start(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

test('three definite inactive observations rearm a later call', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll(); s.monitor.dismiss();
  s.set({ state: 'inactive' }); await s.poll(); await s.poll();
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
  s.set({ state: 'inactive' }); await s.poll(); await s.poll(); await s.poll();
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.source, 'detected');
});

test('missing permission suppresses a real offer and never prompts', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.set({ accessibility: false }); await s.start(); await s.poll();
  assert.equal(s.monitor.getState().status, 'permission'); assert.equal(s.monitor.getState().suggestion, null);
  s.set({ accessibility: true }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.source, 'detected');
  s.set({ accessibility: false }); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

test('late results after disabling cannot reopen the offer', async t => {
  let resolve!: (value: CallObservation) => void;
  const monitor = new CallHelpMonitor({ observe: () => new Promise(r => { resolve = r; }), canOffer: () => true, publish: () => {} });
  t.after(() => monitor.dispose());
  monitor.setEnabled(true); monitor.setEnabled(false);
  resolve({ accessibility: true, state: 'active', callId: '1', window: null, timestamp: Date.now() });
  await nextTurn(); assert.deepEqual(monitor.getState(), { enabled: false, status: 'off', suggestion: null });
});

test('manual guides suppress offers until idle', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.busy(true); await s.start(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
  s.busy(false); await s.poll(); assert.equal(s.monitor.getState().suggestion?.source, 'detected');
});

test('preview works while off and does not claim a call or use the call dismissal', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.monitor.preview(); assert.equal(s.monitor.getState().enabled, false);
  assert.equal(s.monitor.getState().suggestion?.source, 'preview');
  s.monitor.dismiss(); await s.start(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.source, 'detected');
});

test('preview remains available without accessibility', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.set({ accessibility: false }); await s.start(); s.monitor.preview(); await s.poll();
  assert.equal(s.monitor.getState().status, 'permission');
  assert.equal(s.monitor.getState().suggestion?.source, 'preview');
  s.monitor.setEnabled(false); assert.equal(s.monitor.getState().suggestion, null);
});

test('stale observations cannot cause an offer', async t => {
  const monitor = new CallHelpMonitor({ interval: 100000, observe: async () => ({ accessibility: true, state: 'active', callId: '1', window: null, timestamp: Date.now() - 10000 }), canOffer: () => true, publish: () => {} });
  t.after(() => monitor.dispose()); monitor.setEnabled(true); await nextTurn(); await monitor.poll();
  assert.equal(monitor.getState().status, 'unavailable'); assert.equal(monitor.getState().suggestion, null);
});

test('unknown observations do not clear the once-per-call dismissal', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll(); s.monitor.dismiss();
  s.set({ state: 'unknown' }); await s.poll(); await s.poll(); await s.poll();
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

for (const fault of ['stale', 'error', 'permission'] as const) {
  test(`${fault} hides a detected offer and requires two fresh active samples to offer again`, async t => {
    const s = setup(); t.after(() => s.monitor.dispose());
    await s.start(); await s.poll();
    const firstId = s.monitor.getState().suggestion?.id;
    assert.ok(firstId);
    s.fault(fault); await s.poll();
    assert.equal(s.monitor.getState().suggestion, null);
    assert.equal(s.monitor.getState().status, fault === 'permission' ? 'permission' : 'unavailable');
    s.fault(null); await s.poll();
    assert.equal(s.monitor.getState().suggestion, null, 'One fresh sample cannot recover an offer');
    await s.poll();
    assert.equal(s.monitor.getState().suggestion?.source, 'detected');
    assert.notEqual(s.monitor.getState().suggestion?.id, firstId);
  });

  test(`${fault} cannot rearm an explicitly dismissed or consumed offer`, async t => {
    const s = setup(); t.after(() => s.monitor.dispose());
    await s.start(); await s.poll(); s.monitor.dismiss();
    s.busy(true); s.fault(fault); await s.poll();
    s.fault(null); await s.poll(); await s.poll();
    s.busy(false); await s.poll(); await s.poll();
    assert.equal(s.monitor.getState().suggestion, null, 'Finishing a manual guide does not undo consumption');
  });

  test(`${fault} preserves a preview and does not rearm the detected offer it replaced`, async t => {
    const s = setup(); t.after(() => s.monitor.dispose());
    await s.start(); await s.poll(); s.monitor.preview();
    const previewId = s.monitor.getState().suggestion?.id;
    s.fault(fault); await s.poll();
    assert.equal(s.monitor.getState().suggestion?.source, 'preview');
    assert.equal(s.monitor.getState().suggestion?.id, previewId);
    s.monitor.dismiss(); s.fault(null); await s.poll(); await s.poll();
    assert.equal(s.monitor.getState().suggestion, null);
  });
}

test('off/on hiding an offer cannot be undone by an unavailable observation', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll();
  s.monitor.setEnabled(false); s.fault('error'); await s.start();
  s.fault(null); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

test('unknown controls preserve an existing offer without creating a replacement', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll();
  const firstId = s.monitor.getState().suggestion?.id;
  s.set({ state: 'unknown' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.id, firstId);
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.id, firstId);
});


test('repeated enable preserves an in-flight poll and its active debounce', async t => {
  const requests: Array<{ signal: AbortSignal; resolve: (value: CallObservation) => void }> = [];
  const monitor = new CallHelpMonitor({ interval: 100000, observe: signal => new Promise(resolve => requests.push({ signal, resolve })), canOffer: () => true, publish: () => {} });
  t.after(() => monitor.dispose());
  let stamp = Date.now();
  const active = (): CallObservation => ({ accessibility: true, state: 'active', callId: '123:4', window: null, timestamp: ++stamp });
  monitor.setEnabled(true); monitor.setEnabled(true);
  assert.equal(requests.length, 1); assert.equal(requests[0].signal.aborted, false);
  requests[0].resolve(active()); await nextTurn();
  monitor.setEnabled(true); assert.equal(requests.length, 1);
  const next = monitor.poll(); requests[1].resolve(active()); await next;
  const id = monitor.getState().suggestion?.id; assert.ok(id);
  monitor.setEnabled(true);
  assert.equal(monitor.getState().suggestion?.id, id); assert.equal(requests.length, 2);
});

test('consuming positive context suppresses a call that could not offer while another guide was open', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.busy(true); await s.start(); s.monitor.consumeActiveCall();
  s.busy(false); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

test('consuming an observed call removes its detected offer without replacing it', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  await s.start(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.source, 'detected');
  s.monitor.consumeActiveCall(); assert.equal(s.monitor.getState().suggestion, null);
  await s.poll(); await s.poll(); assert.equal(s.monitor.getState().suggestion, null);
});

test('lobby or unknown context cannot consume a future call', async t => {
  for (const state of ['inactive', 'unknown'] as const) {
    const s = setup(); t.after(() => s.monitor.dispose());
    s.set({ state }); await s.start(); s.monitor.consumeActiveCall();
    s.set({ state: 'active' }); await s.poll(); await s.poll();
    assert.equal(s.monitor.getState().suggestion?.source, 'detected');
  }
});

for (const fault of ['stale', 'error', 'permission'] as const) {
  test(`positive call context remains consumable after ${fault}`, async t => {
    const s = setup(); t.after(() => s.monitor.dispose());
    s.busy(true); await s.start();
    s.fault(fault); await s.poll(); s.monitor.consumeActiveCall();
    s.fault(null); s.busy(false); await s.poll(); await s.poll();
    assert.equal(s.monitor.getState().suggestion, null);
  });
}

test('unknown preserves positive context until three definite inactive samples', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.busy(true); await s.start(); s.set({ state: 'unknown' }); await s.poll();
  s.monitor.consumeActiveCall(); s.busy(false);
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
  s.set({ state: 'inactive' }); await s.poll(); await s.poll(); await s.poll();
  s.monitor.consumeActiveCall();
  s.set({ state: 'active' }); await s.poll(); await s.poll();
  assert.equal(s.monitor.getState().suggestion?.source, 'detected');
});

test('consumption preserves preview and survives off/on', async t => {
  const s = setup(); t.after(() => s.monitor.dispose());
  s.busy(true); await s.start(); s.monitor.preview();
  const id = s.monitor.getState().suggestion?.id; s.monitor.consumeActiveCall();
  assert.equal(s.monitor.getState().suggestion?.id, id);
  s.monitor.setEnabled(false); s.busy(false); await s.start(); await s.poll();
  assert.equal(s.monitor.getState().suggestion, null);
});

test('cancelled active samples cannot create consumable context', async t => {
  const requests: Array<{ resolve: (value: CallObservation) => void }> = [];
  const monitor = new CallHelpMonitor({ interval: 100000, observe: () => new Promise(resolve => requests.push({ resolve })), canOffer: () => true, publish: () => {} });
  t.after(() => monitor.dispose());
  let stamp = Date.now();
  const active = (): CallObservation => ({ accessibility: true, state: 'active', callId: '123:4', window: null, timestamp: ++stamp });
  monitor.setEnabled(true); monitor.setEnabled(false);
  requests[0].resolve(active()); await nextTurn(); monitor.consumeActiveCall();
  monitor.setEnabled(true); requests[1].resolve(active()); await nextTurn();
  const next = monitor.poll(); requests[2].resolve(active()); await next;
  assert.equal(monitor.getState().suggestion?.source, 'detected');
});
