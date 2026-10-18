import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveEngine } from '../../electron/features/live-guide/live-engine';
import { lessons } from '../../src/features/lessons/catalog';
import { guidePointerMode, type LiveState, type Observation, type ObservedElement } from '../../src/features/live-guide/contracts';
import type { LessonId } from '../../src/features/lessons/types';

const finder = 'com.apple.finder';
const windowRect = { x: 400, y: 160, width: 1000, height: 650 };
const anchor = (extra: Partial<ObservedElement> = {}): ObservedElement => ({ id: 'file', label: 'File', role: 'AXMenuBarItem', enabled: true, rect: { x: 160, y: 0, width: 50, height: 24 }, ...extra });
const command = (label = 'New Folder', extra: Partial<ObservedElement> = {}): ObservedElement => ({ id: label, label, role: 'AXMenuItem', scope: 'finder-file-menu', enabled: true, rect: { x: 160, y: 75, width: 260, height: 24 }, ...extra });
const sample = (elements: ObservedElement[] = [anchor()], extra: Partial<Observation> = {}): Observation => ({ trusted: true, screenCapture: true, frontmostBundleId: finder, frontmostName: 'Finder', observedBundleId: finder, timestamp: Date.now(), source: 'accessibility', window: windowRect, windowId: 'finder:1', finderMenuContext: 'closed', elements, ...extra });
const openFile = (elements = [anchor(), command()], extra: Partial<Observation> = {}) => sample(elements, { finderMenuContext: 'file', ...extra });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const finderLessons = [
  { id: 'finder-new-folder', label: 'New Folder', action: 'new-folder', unavailable: 'New Folder is unavailable' },
  { id: 'finder-rename', label: 'Rename', action: 'rename-item', unavailable: 'Choose an item to rename' },
  { id: 'finder-quick-look', label: 'Quick Look', action: 'quick-look', unavailable: 'Choose an item to preview' },
] as const;
function harness(id: LessonId, initial = sample()) {
  let current = initial; let stamp = Date.now(); let rawStamp: number | undefined; let failure: Error | null = null;
  const states: LiveState[] = [];
  const engine = new LiveEngine(async () => {
    if (failure) throw failure;
    stamp = Math.max(stamp + 1, Date.now());
    return { ...current, timestamp: rawStamp ?? stamp };
  }, state => states.push(state), 100000);
  engine.start(id);
  return {
    engine, states,
    set: (next: Observation) => { current = next; rawStamp = undefined; },
    tick: async (next: Observation, timestamp?: number) => { current = next; rawStamp = timestamp; await engine.poll(); },
    fail: async () => { failure = new Error('Observer unavailable'); await engine.poll(); failure = null; },
  };
}

test('each Finder File guide points to observed menu geometry and finishes only on learner confirmation', async t => {
  for (const { id, label, action } of finderLessons) {
    const h = harness(id); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().status, 'guiding');
    assert.equal(h.engine.getState().currentAction, 'open-file-menu');
    assert.deepEqual(h.engine.getState().target, anchor().rect, 'menu bar is outside the Finder document');
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(openFile([anchor(), command(label)]));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.equal(h.engine.getState().currentAction, action);
    assert.deepEqual(h.engine.getState().target, command(label).rect);
    assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    await h.tick(sample());
    const confirmation = lessons.find(lesson => lesson.id === id)!.confirmation!;
    assert.equal(h.engine.getState().canConfirm, true);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().title, confirmation.title);
    assert.equal(h.engine.getState().message, confirmation.instruction);
    assert.equal(guidePointerMode(h.engine.getState()), null);
    await h.tick(sample());
    assert.equal(h.engine.getState().verification, null, 'menu closure could be Escape, not an action');
    h.engine.confirm();
    assert.equal(h.engine.getState().status, 'complete');
    assert.equal(h.engine.getState().verification, 'self-confirmed');
  }
});

test('starting on an already open File command works, but closed File alone never completes', async t => {
  for (const { id, label } of finderLessons) {
    const h = harness(id, openFile([command(label)])); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.deepEqual(h.engine.getState().target, command(label).rect);
    assert.equal(h.engine.getState().verification, null);
    h.set(sample()); h.engine.start(id); await settle();
    await h.tick(sample());
    assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('Finder File and final commands accept the curated Korean aliases', async t => {
  for (const [id, label] of [['finder-new-folder', '새로운 폴더'], ['finder-new-folder', '새 폴더'], ['finder-rename', '이름 변경'], ['finder-quick-look', '훑어보기']] as const) {
    const file = anchor({ label: '파일' });
    const h = harness(id, sample([file])); t.after(() => h.engine.stop()); await settle();
    assert.deepEqual(h.engine.getState().target, file.rect);
    await h.tick(openFile([file, command(label)]));
    assert.equal(h.engine.getState().stepIndex, 1);
    assert.deepEqual(h.engine.getState().target, command(label).rect);
    await h.tick(sample([file])); assert.equal(h.engine.getState().canConfirm, true);
  }
});

test('disabled Finder commands give useful next steps and recover on a newly enabled command', async t => {
  for (const { id, label, unavailable } of finderLessons) {
    const h = harness(id, openFile([anchor(), command(label)])); t.after(() => h.engine.stop()); await settle();
    await h.tick(openFile([anchor(), command(label, { enabled: false })]));
    assert.equal(h.engine.getState().title, unavailable);
    assert.match(h.engine.getState().message, id === 'finder-new-folder' ? /folder you can change/ : /Select a file or folder/);
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
    assert.equal(guidePointerMode(h.engine.getState()), null, 'unavailable actions must not appear to search');
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(openFile([anchor(), command(label)]));
    assert.equal(h.engine.getState().status, 'guiding');
    assert.deepEqual(h.engine.getState().target, command(label).rect);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, true);
  }
});

test('missing, unscoped, wrong-role, malformed and ambiguous finals cannot contribute confirmation history', async t => {
  const valid = command();
  const invalidCases = [
    [], [command('New Folder', { scope: undefined })], [command('New Folder', { scope: 'bookmark-sheet' })],
    ...['AXButton', 'AXStaticText', 'AXMenuBarItem', 'OCRLabel'].map(role => [command('New Folder', { role })]),
    [command('New Folder', { enabled: undefined as unknown as boolean })],
    [command('New Folder', { rect: { ...valid.rect, width: 1700 } })],
    [command('New Folder', { rect: { ...valid.rect, x: Number.NaN } })],
    [valid, { ...valid, id: 'duplicate' }], [valid, { ...valid, id: 'conflicting', enabled: false }],
    [valid, { ...valid, id: 'elsewhere', rect: { ...valid.rect, x: 700 } }],
  ];
  for (const candidates of invalidCases) {
    const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
    await h.tick(openFile([anchor(), ...candidates]));
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().title, 'Finding menu item');
    assert.equal(h.engine.getState().message, 'Keep the File menu open.');
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('a same-name sidebar item cannot impersonate the File menu anchor', async t => {
  for (const elements of [
    [anchor({ role: 'AXStaticText' })], [anchor({ role: 'AXButton' })], [anchor({ role: 'OCRLabel' })],
    [anchor({ enabled: false })], [anchor(), anchor({ id: 'duplicate' })],
    [anchor({ rect: { x: 420, y: 190, width: 120, height: 90 } })], [],
  ]) {
    const h = harness('finder-new-folder', sample(elements)); t.after(() => h.engine.stop()); await settle();
    assert.equal(h.engine.getState().target, null);
    await h.tick(openFile());
    await h.tick(sample(elements));
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('other, unknown or missing menu context cannot guide final commands or preserve old evidence', async t => {
  for (const finderMenuContext of ['other', 'unknown', undefined] as const) {
    const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample([anchor(), command()], { finderMenuContext }));
    assert.equal(h.engine.getState().stepIndex, 0);
    assert.deepEqual(h.engine.getState().target, anchor().rect);
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('closed-menu metadata with visible menu items is contradictory and cannot unlock Complete', async t => {
  const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
  await h.tick(sample([anchor(), command('Undo', { scope: undefined })]));
  assert.equal(h.engine.getState().canConfirm, false);
  await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
});

test('changed, moved, resized or missing Finder identity discards prior final evidence', async t => {
  for (const context of [
    { windowId: 'finder:2' }, { windowId: undefined }, { windowId: '' }, { windowId: ' ' },
    { window: null }, { window: { ...windowRect, x: 500 } }, { window: { ...windowRect, width: 900 } },
    { frontmostBundleId: 'app.helpos.desktop' }, { observedBundleId: 'com.apple.Safari' },
  ]) {
    const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample([anchor()], context));
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('a missing Finder window identity cannot guide even a correctly scoped final command', async t => {
  const h = harness('finder-rename', openFile([anchor(), command('Rename')], { windowId: undefined })); t.after(() => h.engine.stop()); await settle();
  assert.equal(h.engine.getState().title, 'Open a Finder window');
  assert.equal(h.engine.getState().contextWindow, undefined);
  assert.equal(h.engine.getState().target, null);
  assert.equal(h.engine.getState().canConfirm, false);
});

test('Finder File guides require Accessibility and invalidate history on permission or usable-source loss', async t => {
  for (const context of [{ trusted: false }, { source: 'ocr' as const }, { source: 'none' as const }]) {
    for (const { id, label } of finderLessons) {
      const h = harness(id, openFile([anchor(), command(label)])); t.after(() => h.engine.stop()); await settle();
      await h.tick(openFile([anchor(), command(label)], context));
      assert.equal(h.engine.getState().status, context.trusted === false ? 'permission' : 'waiting-control');
      assert.equal(h.engine.getState().target, null);
      assert.equal(h.engine.getState().canConfirm, false);
      if (context.trusted !== false) assert.equal(h.engine.getState().title, 'Waiting for Finder controls');
      await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
    }
  }
});

test('stale, nonmonotonic and future observations cannot preserve Finder action evidence', async t => {
  for (const timestamp of [Date.now() - 5000, 1, Date.now() + 10000]) {
    const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample(), timestamp);
    assert.equal(h.engine.getState().status, 'observing');
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
  }
});

test('observer errors and pause/retry/new-session boundaries discard Finder confirmation history', async t => {
  for (const boundary of ['error', 'pause', 'retry', 'new-session', 'stop'] as const) {
    const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, true);
    if (boundary === 'error') await h.fail();
    if (boundary === 'pause') { h.engine.pause(); h.engine.confirm(); assert.equal(h.engine.getState().status, 'paused'); h.engine.resume(); await settle(); }
    if (boundary === 'retry') { h.engine.retry(); await settle(); }
    if (boundary === 'new-session') { h.engine.start('finder-new-folder'); await settle(); }
    if (boundary === 'stop') { h.engine.stop(); h.engine.confirm(); assert.equal(h.engine.getState().status, 'idle'); h.engine.start('finder-new-folder'); await settle(); }
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false);
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
  }
});

test('a stalled Finder read expires both final-target evidence and pending learner confirmation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 100000 });
  for (const awaitingConfirmation of [false, true]) {
    const h = harness('finder-new-folder', openFile()); await settle();
    if (awaitingConfirmation) { await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, true); }
    t.mock.timers.tick(1600); await settle();
    assert.equal(h.engine.getState().status, 'observing');
    assert.equal(h.engine.getState().target, null);
    assert.equal(h.engine.getState().canConfirm, false);
    await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, false, 'fresh closed File cannot revive expired Finder history');
    h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
    h.engine.stop();
  }
});

test('confirmation synchronously rechecks freshness even if the expiry callback has not run', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 200000 });
  const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
  await h.tick(sample()); assert.equal(h.engine.getState().canConfirm, true);
  t.mock.timers.setTime(202000);
  h.engine.confirm();
  assert.equal(h.engine.getState().canConfirm, false);
  assert.notEqual(h.engine.getState().status, 'complete');
});

test('a fresh closed-menu read after an observation gap cannot cancel a delayed history expiry', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 300000 });
  const h = harness('finder-new-folder', openFile()); t.after(() => h.engine.stop()); await settle();
  t.mock.timers.setTime(302000);
  await h.tick(sample());
  assert.equal(h.engine.getState().canConfirm, false, 'the overdue timer may not have executed during an event-loop stall');
  h.engine.confirm(); assert.notEqual(h.engine.getState().status, 'complete');
});

test('Finder Downloads continues to use the sidebar and its existing observed selection result', async t => {
  const downloads = command('Downloads', { role: 'AXRow', scope: undefined, rect: { x: 420, y: 240, width: 130, height: 30 } });
  const h = harness('finder-downloads', sample([downloads], { finderMenuContext: undefined })); t.after(() => h.engine.stop()); await settle();
  assert.deepEqual(h.engine.getState().target, downloads.rect);
  await h.tick(sample([{ ...downloads, selected: true }], { finderMenuContext: undefined }));
  assert.equal(h.engine.getState().status, 'complete');
  assert.equal(h.engine.getState().verification, 'observed');
});
