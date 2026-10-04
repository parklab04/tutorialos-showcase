import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { assertCoachPresentation, assertGuidanceHidden } from './companion-checks.mjs';

const profile = await mkdtemp('/private/tmp/helpos-safari-desktop-');
await writeFile(profile + '/call-help.json', JSON.stringify({ enabled: false }));
await mkdir('test-results', { recursive: true });
const executablePath = process.argv[2];
const resultFile = `test-results/safari-desktop-${executablePath ? 'packaged' : 'development'}-results.json`;
const application = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + profile] } : { args: ['.', '--user-data-dir=' + profile] }), cwd: process.cwd(), timeout: 30000 });
const results = [];
let home;
const until = async (check, reason = 'Safari fixture state') => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + reason);
};
const live = () => home.evaluate(() => window.helpOS.getLiveState());
async function pageForRoute(hash) {
  let page;
  await until(() => {
    page = application.windows().find(candidate => !candidate.isClosed() && candidate.url().endsWith('/index.html' + hash));
    return !!page;
  }, 'loaded native ' + hash + ' page');
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  return page;
}
const patch = value => application.evaluate((_electron, value) => Object.assign(globalThis.__safariTest, value), value);
const setElements = elements => patch({ elements });
const stateIs = async (status, step) => {
  await until(async () => { const state = await live(); return state.status === status && (step === undefined || state.stepIndex === step); }, status + ' step ' + step);
  return live();
};
async function assertHighlight(overlay, expected) {
  await until(async () => {
    const actual = await overlay.evaluate(() => window.helpOS.getLiveState());
    return actual.status === 'guiding' && JSON.stringify(actual.target) === JSON.stringify(expected);
  }, 'overlay target update');
  await until(() => application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return ['#coach', '#overlay'].every(hash => windows.some(window => window.webContents.getURL().endsWith(hash) && window.isVisible()));
  }), 'visible coach and spotlight');
  await until(async () => overlay.evaluate(expected => {
    const hole = document.querySelector('.native-target');
    if (!hole) return false;
    return Math.abs(parseFloat(hole.style.width) - expected.width - 12) < 1 &&
      Math.abs(parseFloat(hole.style.height) - expected.height - 12) < 1;
  }, expected), 'rendered spotlight dimensions');
  const geometry = await overlay.evaluate(async () => {
    const state = await window.helpOS.getLiveState();
    const hole = document.querySelector('.native-target');
    return { origin: state.overlayOrigin, x: parseFloat(hole.style.left), y: parseFloat(hole.style.top) };
  });
  assert.ok(geometry.origin);
  assert.ok(Math.abs(geometry.x + geometry.origin.x + 6 - expected.x) < 1);
  assert.ok(Math.abs(geometry.y + geometry.origin.y + 6 - expected.y) < 1);
  await assertCoachPresentation({ application, coach: await pageForRoute('#coach'), overlay, until, target: expected });
}

try {
  home = await application.firstWindow();
  await home.getByRole('heading', { name: 'What would you like to do?' }).waitFor();
  await application.evaluate(({ app, screen, globalShortcut, systemPreferences, desktopCapturer, shell }) => {
    const requireFromApp = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
    const koffi = requireFromApp('koffi');
    const originalDecode = koffi.decode;
    const originalLoad = koffi.load;
    const nativePath = requireFromApp('node:path').join(app.getAppPath(), 'native', 'libhelpos-observer.dylib');
    if (!app.isPackaged) koffi.load = function (filename, ...args) {
      return originalLoad.call(koffi, String(filename).endsWith('libhelpos-observer.dylib') ? nativePath : filename, ...args);
    };
    const display = screen.getPrimaryDisplay();
    const area = display.workArea;
    globalThis.__safariTest = {
      accessibility: true, source: 'accessibility', bundle: 'com.apple.Safari', elements: [],
      window: { x: area.x + 70, y: area.y + 70, width: Math.min(860, area.width - 140), height: Math.min(560, area.height - 140) },
      anchorY: display.bounds.y + 4, baseX: area.x + 200, windowId: '123:44',
      observationDecodes: 0, callDecodes: 0, contextDecodes: 0, lastTimestamp: 0,
      permissionPrompts: 0, registrationWrites: 0, settingsOpens: 0, captures: 0,
      cursor: { x: area.x + 390, y: area.y + 210 }, cursorReads: 0,
    };
    screen.getCursorScreenPoint = () => { globalThis.__safariTest.cursorReads++; return globalThis.__safariTest.cursor; };
    app.getLoginItemSettings = () => ({ openAtLogin: false, status: 'not-registered' });
    app.setLoginItemSettings = () => { globalThis.__safariTest.registrationWrites++; throw new Error('Watcher writes are forbidden in this test'); };
    const shortcuts = new Set();
    globalShortcut.register = key => { shortcuts.add(key); return true; };
    globalShortcut.unregister = key => { shortcuts.delete(key); };
    globalShortcut.unregisterAll = () => shortcuts.clear();
    globalShortcut.isRegistered = key => shortcuts.has(key);
    systemPreferences.isTrustedAccessibilityClient = prompt => {
      if (prompt) { globalThis.__safariTest.permissionPrompts++; throw new Error('Permission prompts are forbidden in this test'); }
      return globalThis.__safariTest.accessibility;
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    desktopCapturer.getSources = async () => { globalThis.__safariTest.captures++; throw new Error('Capture requests are forbidden in this test'); };
    shell.openExternal = async () => { globalThis.__safariTest.settingsOpens++; throw new Error('Opening Settings is forbidden in this test'); };
    // Decode/free the real native allocation normally. Inject JSON only at the
    // observation boundary, so preload, IPC, Zod, engine and windows stay real.
    koffi.decode = function (pointer, type, ...args) {
      const decoded = originalDecode.call(koffi, pointer, type, ...args);
      if (type !== 'char' || typeof decoded !== 'string') return decoded;
      let actual;
      try { actual = JSON.parse(decoded); } catch { return decoded; }
      if (!actual || typeof actual !== 'object') return decoded;
      const t = globalThis.__safariTest;
      const timestamp = Math.max(Date.now(), t.lastTimestamp + 1); t.lastTimestamp = timestamp;
      if (Object.hasOwn(actual, 'callId') && Object.hasOwn(actual, 'accessibility')) {
        t.callDecodes++;
        return JSON.stringify({ accessibility: t.accessibility, state: 'inactive', callId: null, window: null, timestamp });
      }
      if (Object.hasOwn(actual, 'pid') && Object.hasOwn(actual, 'frontmostBundleId') && !Object.hasOwn(actual, 'trusted')) {
        t.contextDecodes++;
        return JSON.stringify({ frontmostBundleId: t.bundle, pid: 123, window: t.window, timestamp });
      }
      if (!Object.hasOwn(actual, 'trusted') || !Object.hasOwn(actual, 'screenCapture')) return decoded;
      t.observationDecodes++;
      return JSON.stringify({ trusted: t.accessibility, screenCapture: true, frontmostBundleId: t.bundle, frontmostName: 'Safari',
        source: t.source, window: t.window, windowId: t.windowId, timestamp, elements: t.elements });
    };
  });
  const fixture = await application.evaluate(() => globalThis.__safariTest);
  const anchor = (label, offset = 0) => ({ id: label, label, role: 'AXMenuBarItem', enabled: true, rect: { x: fixture.baseX + offset, y: fixture.anchorY, width: 85, height: 24 } });
  const command = label => ({ id: label, label, role: 'AXMenuItem', enabled: true, rect: { x: fixture.baseX, y: fixture.window.y + 110, width: 260, height: 30 } });
  const add = { id: 'scoped-add', label: 'Add', role: 'AXButton', enabled: true, scope: 'bookmark-sheet', rect: { x: fixture.window.x + fixture.window.width - 150, y: fixture.window.y + 240, width: 90, height: 32 } };

  await setElements([anchor('View')]);
  await assert.rejects(home.evaluate(() => window.helpOS.startLive('safari-made-up')));
  for (const id of ['safari-zoom', 'safari-reader', 'safari-bookmark', 'safari-reopen-tab']) {
    await patch({ accessibility: false });
    await home.evaluate(id => window.helpOS.startLive(id), id);
    const denied = await stateIs('permission');
    assert.equal(denied.lessonId, id); assert.equal(denied.target, null);
    assert.equal(denied.permission.screenCapture, true);
    const recoveryCoach = await pageForRoute('#coach');
    await assertCoachPresentation({ application, coach: recoveryCoach, until, mode: 'recovery' });
    await recoveryCoach.getByRole('button', { name: 'Open Mac Settings', exact: true }).waitFor();
    await home.evaluate(() => window.helpOS.stopLive());
  }
  results.push('All four Safari lesson IDs pass real home preload/IPC; screen permission alone cannot start their AX-only guides');
  await patch({ accessibility: true });

  await setElements([anchor('View')]);
  await home.evaluate(() => window.helpOS.startLive('safari-reader'));
  await stateIs('guiding', 0);
  const coach = await pageForRoute('#coach');
  const overlay = await pageForRoute('#overlay');
  await assertHighlight(overlay, anchor('View').rect);
  await assertCoachPresentation({ application, coach, overlay, until, target: anchor('View').rect, passive: true });
  await overlay.locator('.pointer-companion[data-mode="pointing"][data-visible="true"]').waitFor();
  assert.equal(await overlay.locator('.tutorial-scrim').count(), 0, 'Live pointer guidance must not dim the screen');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isFocusable()), false);
  const pointerBounds = await overlay.locator('.companion-pointer').boundingBox();
  const coachBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds());
  const feedBefore = await overlay.evaluate(() => window.helpOS.getGuidePointer());
  assert.equal(feedBefore.sessionId, (await live()).sessionId);
  await patch({ cursor: { x: fixture.window.x + 250, y: fixture.window.y + 240 } });
  await until(async () => (await overlay.evaluate(() => window.helpOS.getGuidePointer()))?.cursor.x === fixture.window.x + 250, 'read-only cursor feed');
  assert.deepEqual(await overlay.locator('.companion-pointer').boundingBox(), pointerBounds, 'Pointing companion stays anchored while the learner moves');
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds()), coachBounds, 'Actionable bubble remains anchored while the learner moves');
  results.push('A single compact actionable coach stays clear of the target; its pointer overlay is nonfocusable and contains no duplicate text or controls');
  await setElements([]);
  await stateIs('waiting-control', 0);
  await overlay.locator('.pointer-companion[data-mode="following"]').waitFor({ state: 'attached' });
  assert.equal(await overlay.locator('.native-target').count(), 0, 'Searching never preserves the old target ring');
  assert.equal(await overlay.locator('.companion-bubble').count(), 0);
  await assertCoachPresentation({ application, coach, overlay, until });
  const searchingBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds());
  await patch({ cursor: { x: fixture.window.x + 330, y: fixture.window.y + 290 } });
  await until(async () => (await overlay.evaluate(() => window.helpOS.getGuidePointer()))?.cursor.x === fixture.window.x + 330, 'searching pointer feed follows cursor');
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds()), searchingBounds, 'Searching does not move actionable buttons away from the learner');
  await coach.evaluate(() => window.helpOS.pauseLive());
  await stateIs('paused', 0);
  assert.equal(await overlay.evaluate(() => window.helpOS.getGuidePointer()), null);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isVisible()), false);
  const readsAfterPause = await application.evaluate(() => globalThis.__safariTest.cursorReads);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(await application.evaluate(() => globalThis.__safariTest.cursorReads), readsAfterPause, 'Pause stops native pointer sampling');
  await setElements([anchor('View')]);
  await coach.evaluate(() => window.helpOS.resumeLive());
  await stateIs('guiding', 0);
  await assertHighlight(overlay, anchor('View').rect);
  results.push('Missing controls switch to cursor following without a target claim; Pause hides the companion and stops sampling, Resume reacquires');
  await setElements([anchor('View'), command('Show Reader')]);
  await stateIs('guiding', 1);
  await assertHighlight(overlay, command('Show Reader').rect);
  await coach.getByRole('heading', { name: 'Click Show Reader', exact: true }).waitFor();
  await setElements([anchor('View')]);
  await until(async () => (await live()).canConfirm === true, 'Reader confirmation');
  await coach.getByRole('button', { name: 'Yes, Reader is open', exact: true }).waitFor();
  assert.equal((await live()).status, 'waiting-control');
  await coach.getByRole('button', { name: 'Yes, Reader is open', exact: true }).click();
  assert.equal((await live()).verification, 'self-confirmed');
  results.push('Reader moves actual native spotlight View → Show Reader, then waits for explicit confirmation');

  await setElements([anchor('Bookmarks', 100)]);
  await home.evaluate(() => window.helpOS.startLive('safari-bookmark'));
  await stateIs('guiding', 0);
  await assertHighlight(overlay, anchor('Bookmarks', 100).rect);
  await setElements([anchor('Bookmarks', 100), command('Add Bookmark…')]);
  await stateIs('guiding', 1);
  await assertHighlight(overlay, command('Add Bookmark…').rect);
  const { scope: _, ...unscopedAdd } = add;
  await setElements([anchor('Bookmarks', 100), unscopedAdd]);
  await stateIs('waiting-control', 1);
  assert.equal((await live()).canConfirm, false);
  await setElements([anchor('Bookmarks', 100), add]);
  await stateIs('guiding', 2);
  await assertHighlight(overlay, add.rect);
  await coach.getByRole('heading', { name: 'Click Add', exact: true }).waitFor();
  results.push('Bookmark requires scope preserved through native JSON and production Zod before real coach/overlay marks Add; unscoped Add is rejected');
  await setElements([anchor('Bookmarks', 100)]);
  await until(async () => (await live()).canConfirm === true, 'bookmark confirmation');
  await coach.getByRole('button', { name: 'Yes, it is saved', exact: true }).waitFor();
  assert.equal((await live()).verification, null);
  await coach.getByRole('button', { name: 'Yes, it is saved', exact: true }).click();
  assert.equal((await live()).verification, 'self-confirmed');
  results.push('A disappeared bookmark sheet never claims a save automatically; the learner confirms it');

  await setElements([anchor('History', 40)]);
  await home.evaluate(() => window.helpOS.startLive('safari-reopen-tab'));
  await stateIs('guiding', 0);
  await setElements([anchor('History', 40), command('Reopen Last Closed Tab')]);
  await stateIs('guiding', 1);
  await assertHighlight(overlay, command('Reopen Last Closed Tab').rect);
  await coach.getByRole('heading', { name: 'Reopen the tab', exact: true }).waitFor();
  await setElements([anchor('History', 40)]);
  await until(async () => (await live()).canConfirm === true, 'reopen-tab confirmation');
  await coach.getByRole('button', { name: 'Yes, it is back', exact: true }).waitFor();
  await coach.getByRole('button', { name: 'Yes, it is back', exact: true }).click();
  assert.equal((await live()).verification, 'self-confirmed');
  results.push('Reopen-tab IPC guide marks the History command and uses its own outcome confirmation');

  await setElements([anchor('View')]);
  await home.evaluate(() => window.helpOS.startLive('safari-zoom'));
  await stateIs('guiding', 0);
  await assertHighlight(overlay, anchor('View').rect);
  const zoomSession = (await live()).sessionId;
  await setElements([anchor('View'), { ...command('Zoom In'), enabled: false }]);
  await stateIs('waiting-control', 0);
  await coach.getByRole('heading', { name: 'Zoom In is unavailable', exact: true }).waitFor();
  await coach.getByText('Try another webpage, then open View.', { exact: true }).waitFor();
  assert.equal(await coach.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
  assert.equal((await live()).target, null);
  assert.equal((await live()).canConfirm, false);
  await until(() => application.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isVisible()), 'disabled zoom spotlight removal');
  await setElements([anchor('View'), command('Zoom In')]);
  await stateIs('guiding', 1);
  assert.equal((await live()).sessionId, zoomSession);
  await assertHighlight(overlay, command('Zoom In').rect);
  await coach.getByRole('heading', { name: 'Click Zoom In', exact: true }).waitFor();
  for (const scale of [1, 2]) {
    await coach.evaluate(value => {
      localStorage.setItem('helpos:text-scale', String(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: String(value) }));
    }, scale);
    await coach.waitForFunction(value => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - value * 16) < .1, scale);
    await coach.getByRole('group', { name: 'Zoom in: Command and Plus', exact: true }).waitFor();
    await coach.getByRole('group', { name: 'Zoom out: Command and Minus', exact: true }).waitFor();
    await until(() => coach.evaluate(() => {
      const note = document.querySelector('.live-shortcut-note');
      const content = document.querySelector('.live-coach-content');
      const body = document.querySelector('.native-coach-body');
      return note && content && body && content.getBoundingClientRect().bottom <= innerHeight &&
        document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1 &&
        body.scrollHeight <= body.clientHeight + 1 && note.getBoundingClientRect().right <= innerWidth;
    }), `keyboard alternatives fit native coach at ${scale * 100}%`);
    assert.equal((await live()).verification, null);
    assert.equal((await live()).canConfirm, false);
    await assertCoachPresentation({ application, coach, overlay, until, target: command('Zoom In').rect });
    await coach.screenshot({ path: `test-results/shortcuts-native-zoom-${scale * 100}.png` });
  }
  await coach.evaluate(() => {
    localStorage.setItem('helpos:text-scale', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '1' }));
  });
  results.push('Zoom keyboard alternatives fit the real native coach at 100% and 200% without enabling confirmation or claiming a result');
  results.push('Legacy Zoom In shows unavailable copy and removes dimming, then advances directly to the enabled command without retry or a new session');
  await setElements([anchor('View'), { ...command('Zoom In'), enabled: false }]);
  await stateIs('waiting-control', 1);
  await setElements([anchor('View')]);
  await until(async () => (await live()).title === 'Open View', 'menu closed after disabled zoom');
  assert.equal((await live()).canConfirm, false);
  await setElements([anchor('View'), command('Zoom In')]);
  await stateIs('guiding', 1);
  await setElements([anchor('View')]);
  await until(async () => (await live()).canConfirm === true, 'zoom learner confirmation');
  assert.equal((await live()).verification, null);
  await coach.getByRole('button', { name: 'Yes, it is larger', exact: true }).click();
  assert.equal((await live()).verification, 'self-confirmed');
  results.push('Disabled zoom clears earlier completion evidence; a freshly observed enabled command and later menu closure permit learner confirmation only');

  await patch({ elements: [anchor('Bookmarks', 100), { ...add, scope: 'arbitrary-dialog' }] });
  await home.evaluate(() => window.helpOS.startLive('safari-bookmark'));
  await stateIs('error');
  assert.equal((await live()).target, null);
  await until(() => application.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isVisible()), 'invalid-scope spotlight removal');
  results.push('An unsupported native scope is rejected by production parsing and cannot keep a spotlight visible');

  await patch({ elements: [anchor('View')], source: 'ocr' });
  for (const id of ['safari-zoom', 'safari-reader']) {
    await home.evaluate(id => window.helpOS.startLive(id), id);
    await stateIs('waiting-control');
    assert.equal((await live()).target, null);
    await coach.getByRole('heading', { name: 'Waiting for Safari controls', exact: true }).waitFor();
    assert.equal(await coach.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
  }
  await patch({ source: 'accessibility' });
  await stateIs('guiding', 0);
  await assertHighlight(overlay, anchor('View').rect);
  results.push('OCR cannot substitute for Safari AX guides; valid AX fixture recovery updates the native guide automatically');
  await coach.evaluate(() => window.helpOS.pauseLive());
  assert.equal((await live()).status, 'paused');
  await until(() => application.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isVisible()), 'paused spotlight removal');
  await coach.getByRole('button', { name: 'Close help', exact: true }).click();
  assert.equal((await live()).status, 'idle');
  await assertGuidanceHidden({ application, overlay, until });
  results.push('Pause and Close help remove the native spotlight through real coach IPC');

  const diagnostics = await application.evaluate(() => globalThis.__safariTest);
  assert.ok(diagnostics.observationDecodes >= 15);
  assert.equal(diagnostics.permissionPrompts, 0);
  assert.equal(diagnostics.registrationWrites, 0);
  assert.equal(diagnostics.settingsOpens, 0);
  assert.equal(diagnostics.captures, 0);
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results,
    diagnostics: { observationDecodes: diagnostics.observationDecodes, callDecodes: diagnostics.callDecodes, contextDecodes: diagnostics.contextDecodes, permissionPrompts: 0, registrationWrites: 0, settingsOpens: 0, captures: 0 },
    evidence: 'Isolated HelpOS profile with injected observations after real native pointer decoding. Production JSON parsing, preload/IPC, engine, native windows and spotlight rendering are exercised. No actual Safari controls, calls, permission changes or watcher registrations. This does not prove real Safari AX recognition.' }, null, 2));
  console.log(`PASS ${results.length} Safari desktop fixture checks`);
} catch (error) {
  const state = await live().catch(() => null);
  const diagnostics = await application.evaluate(() => globalThis.__safariTest ?? null).catch(() => null);
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results, failure: String(error), state, diagnostics }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await application.close(); }
