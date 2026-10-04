import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceController, voiceErrorMessage, type SpeechSnapshot } from '../../electron/features/voice-guide/controller';
const snap = (phase: SpeechSnapshot['phase'], transcript = '', error: string | null = null): SpeechSnapshot => ({ phase, transcript, error });
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function fixture() {
  let next = snap('listening'); let shows = 0; let guides = 0; let cancellations = 0;
  const controller = new VoiceController({
    native: { start: async () => next, stop: async () => next, poll: async () => next,
      cancel: async () => { cancellations++; return snap('cancelled'); } },
    interval: 2, publish: () => {}, show: () => { shows++; }, hide: () => {}, beforeInput: () => {},
    guide: async () => { guides++; },
  });
  return { controller, set: (value: SpeechSnapshot) => { next = value; }, counts: () => ({ shows, guides, cancellations }) };
}
test('speech only starts a reviewed goal after explicit Show me; repeated requests work', async () => {
  const f = fixture();
  try {
    await f.controller.start(); assert.equal(f.controller.getState().phase, 'listening');
    f.set(snap('final', 'Mute my microphone')); await tick();
    assert.equal(f.controller.getState().phase, 'review'); assert.equal(f.counts().guides, 0);
    await f.controller.useGoal(); assert.equal(f.counts().guides, 1); assert.equal(f.controller.getState().phase, 'idle');
    await f.controller.submit('Turn my microphone on'); await f.controller.useGoal();
    assert.equal(f.counts().guides, 2);
  } finally { f.controller.dispose(); }
});
test('Cancel discards an outstanding native Start before its response can reopen listening', async () => {
  let finish!: (state: SpeechSnapshot) => void;
  const controller = new VoiceController({ native: {
    start: () => new Promise(resolve => { finish = resolve; }), stop: async () => snap('final'),
    poll: async () => snap('final', 'Mute my microphone'), cancel: async () => snap('cancelled'),
  }, publish: () => {}, show: () => {}, hide: () => {}, beforeInput: () => {}, guide: async () => { throw new Error('Must not guide'); } });
  const pending = controller.start(); await tick(); controller.cancel(); finish(snap('listening'));
  await pending; await tick(); assert.equal(controller.getState().phase, 'idle'); assert.equal(controller.getState().transcript, '');
  controller.dispose();
});
test('typed fallback invalidates speech and unsupported input cannot start a goal', async () => {
  const f = fixture();
  try {
    await f.controller.start(); await f.controller.submit('Make the page larger');
    assert.equal(f.controller.getState().goal?.id, 'zoom-in');
    f.set(snap('final', 'Mute my microphone')); await tick();
    assert.equal(f.controller.getState().goal?.id, 'zoom-in');
    await f.controller.submit('Delete my files'); await f.controller.useGoal();
    assert.equal(f.counts().guides, 0); assert.equal(f.controller.getState().phase, 'error');
  } finally { f.controller.dispose(); }
});
test('permission errors give readable recovery copy without exposing native codes', async () => {
  const f = fixture();
  try {
    f.set(snap('error', '', 'microphone-denied')); await f.controller.start();
    assert.match(f.controller.getState().message, /Mac Settings.*Microphone/);
    assert.doesNotMatch(f.controller.getState().message, /microphone-denied/);
    assert.match(voiceErrorMessage('untrusted error content'), /Try again/);
  } finally { f.controller.dispose(); }
});

test('cancelling while the target app opens invalidates a deferred guide launch', async () => {
  let release!: () => void;
  let entered!: () => void;
  const opening = new Promise<void>(resolve => { entered = resolve; });
  let guides = 0;
  const controller = new VoiceController({ native: {
    start: async () => snap('listening'), stop: async () => snap('final'),
    poll: async () => snap('listening'), cancel: async () => snap('cancelled'),
  }, publish: () => {}, show: () => {}, hide: () => {}, beforeInput: () => {},
  guide: async (_goal, isCurrent) => {
    entered();
    await new Promise<void>(resolve => { release = resolve; });
    if (isCurrent()) guides++;
  } });
  await controller.submit('Mute my microphone');
  const pending = controller.useGoal();
  await opening;
  controller.cancel(); release(); await pending;
  assert.equal(guides, 0);
  assert.equal(controller.getState().phase, 'idle');
  controller.dispose();
});

test('an older goal settling cannot unlock duplicate submission of its replacement', async () => {
  const openings: Array<{ release(): void; isCurrent(): boolean }> = [];
  const controller = new VoiceController({ native: {
    start: async () => snap('listening'), stop: async () => snap('final'),
    poll: async () => snap('listening'), cancel: async () => snap('cancelled'),
  }, publish: () => {}, show: () => {}, hide: () => {}, beforeInput: () => {},
  guide: (_goal, isCurrent) => new Promise<void>(release => { openings.push({ release, isCurrent }); }) });
  let first: Promise<void> | undefined; let replacement: Promise<void> | undefined; let duplicate: Promise<void> | undefined;
  try {
    await controller.submit('Mute my microphone');
    first = controller.useGoal(); await tick();
    controller.open();
    await controller.submit('Turn my camera off');
    replacement = controller.useGoal(); await tick();
    assert.equal(openings.length, 2);
    assert.equal(openings[0].isCurrent(), false);
    openings[0].release(); await first;
    duplicate = controller.useGoal(); await tick();
    assert.equal(openings.length, 2, 'the newer request must retain exclusive ownership until it settles');
    assert.equal(openings[1].isCurrent(), true);
    openings[1].release(); await replacement; await duplicate;
    assert.equal(controller.getState().phase, 'idle');
  } finally {
    for (const opening of openings) opening.release();
    await Promise.all([first, replacement, duplicate]);
    controller.dispose();
  }
});

test('a fresh recording can replace a pending goal without waiting for its old app-open callback', async () => {
  const releases: Array<() => void> = [];
  const controller = new VoiceController({ native: {
    start: async () => snap('final', 'Turn my camera off'), stop: async () => snap('final'),
    poll: async () => snap('listening'), cancel: async () => snap('cancelled'),
  }, publish: () => {}, show: () => {}, hide: () => {}, beforeInput: () => {},
  guide: () => new Promise<void>(resolve => { releases.push(resolve); }) });
  let first: Promise<void> | undefined; let second: Promise<void> | undefined;
  try {
    await controller.submit('Mute my microphone'); first = controller.useGoal(); await tick();
    await controller.start();
    assert.equal(controller.getState().goal?.id, 'camera-off');
    second = controller.useGoal(); await tick();
    assert.equal(releases.length, 2, 'the new explicit recording owns a separate reviewed request');
  } finally {
    for (const release of releases) release();
    await Promise.all([first, second]); controller.dispose();
  }
});

test('a failed app-open releases submission ownership so a reviewed retry can run', async () => {
  let attempts = 0;
  const controller = new VoiceController({ native: {
    start: async () => snap('listening'), stop: async () => snap('final'),
    poll: async () => snap('listening'), cancel: async () => snap('cancelled'),
  }, publish: () => {}, show: () => {}, hide: () => {}, beforeInput: () => {},
  guide: async () => { if (++attempts === 1) throw new Error('App open failed'); } });
  try {
    await controller.submit('Mute my microphone'); await controller.useGoal();
    assert.equal(controller.getState().phase, 'error');
    await controller.submit('Mute my microphone'); await controller.useGoal();
    assert.equal(attempts, 2);
    assert.equal(controller.getState().phase, 'idle');
  } finally { controller.dispose(); }
});
