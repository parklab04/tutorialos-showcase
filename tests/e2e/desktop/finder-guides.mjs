import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { assertCoachPresentation, assertGuidanceHidden } from './companion-checks.mjs';

const profile = await mkdtemp('/private/tmp/helpos-finder-desktop-');
await writeFile(profile + '/call-help.json', JSON.stringify({ enabled: false }));
await mkdir('test-results', { recursive: true });
const executablePath = process.argv[2];
const resultFile = `test-results/finder-desktop-${executablePath ? 'packaged' : 'development'}-results.json`;
const application = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + profile] } : { args: ['.', '--user-data-dir=' + profile] }), cwd: process.cwd(), timeout: 30000 });
const results = [];
let home;
const until = async (check, reason = 'Finder fixture state') => {
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
const patch = value => application.evaluate((_electron, value) => Object.assign(globalThis.__finderTest, value), value);
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
    globalThis.__finderTest = {
      accessibility: true, source: 'accessibility', bundle: 'com.apple.finder', elements: [], finderMenuContext: 'closed',
      window: { x: area.x + 70, y: area.y + 70, width: Math.min(860, area.width - 140), height: Math.min(560, area.height - 140) },
      anchorY: display.bounds.y + 4, baseX: area.x + 200, windowId: '123:44',
      observationDecodes: 0, callDecodes: 0, contextDecodes: 0, lastTimestamp: 0,
      permissionPrompts: 0, registrationWrites: 0, settingsOpens: 0, captures: 0,
      cursor: { x: area.x + 390, y: area.y + 210 }, cursorReads: 0,
    };
    screen.getCursorScreenPoint = () => { globalThis.__finderTest.cursorReads++; return globalThis.__finderTest.cursor; };
    app.getLoginItemSettings = () => ({ openAtLogin: false, status: 'not-registered' });
    app.setLoginItemSettings = () => { globalThis.__finderTest.registrationWrites++; throw new Error('Watcher writes are forbidden in this test'); };
    const shortcuts = new Set();
    globalShortcut.register = key => { shortcuts.add(key); return true; };
    globalShortcut.unregister = key => { shortcuts.delete(key); };
    globalShortcut.unregisterAll = () => shortcuts.clear();
    globalShortcut.isRegistered = key => shortcuts.has(key);
    systemPreferences.isTrustedAccessibilityClient = prompt => {
      if (prompt) { globalThis.__finderTest.permissionPrompts++; throw new Error('Permission prompts are forbidden in this test'); }
      return globalThis.__finderTest.accessibility;
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    desktopCapturer.getSources = async () => { globalThis.__finderTest.captures++; throw new Error('Capture requests are forbidden in this test'); };
    shell.openExternal = async () => { globalThis.__finderTest.settingsOpens++; throw new Error('Opening Settings is forbidden in this test'); };
    // Decode/free the real native allocation normally. Inject JSON only at the
    // observation boundary, so preload, IPC, Zod, engine and windows stay real.
    koffi.decode = function (pointer, type, ...args) {
      const decoded = originalDecode.call(koffi, pointer, type, ...args);
      if (type !== 'char' || typeof decoded !== 'string') return decoded;
      let actual;
      try { actual = JSON.parse(decoded); } catch { return decoded; }
      if (!actual || typeof actual !== 'object') return decoded;
      const t = globalThis.__finderTest;
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
      return JSON.stringify({ trusted: t.accessibility, screenCapture: true, frontmostBundleId: t.bundle, frontmostName: 'Finder',
        source: t.source, window: t.window, windowId: t.windowId, finderMenuContext: t.finderMenuContext, timestamp, elements: t.elements });
    };
  });
  const fixture = await application.evaluate(() => globalThis.__finderTest);
  const anchor = { id: 'file', label: 'File', role: 'AXMenuBarItem', enabled: true,
    rect: { x: fixture.baseX, y: fixture.anchorY, width: 50, height: 24 } };
  const command = (label, extra = {}) => ({ id: label, label, role: 'AXMenuItem', enabled: true,
    scope: 'finder-file-menu', rect: { x: fixture.baseX, y: fixture.window.y + 110, width: 260, height: 30 }, ...extra });
  const guides = [
    ['finder-new-folder', 'New Folder', 'Name your folder'],
    ['finder-rename', 'Rename', 'Rename your file'],
    ['finder-quick-look', 'Quick Look', 'Preview open?'],
  ];
  await assert.rejects(home.evaluate(() => window.helpOS.startLive('finder-made-up')));
  for (const [id] of guides) {
    await patch({ accessibility: false, elements: [anchor] });
    await home.evaluate(id => window.helpOS.startLive(id), id);
    await stateIs('permission');
    assert.equal((await live()).target, null);
    await home.evaluate(() => window.helpOS.stopLive());
  }
  results.push('All three new IDs cross real preload/IPC; screen permission alone cannot start these AX-only guides');
  await patch({ accessibility: true });
  let coach; let overlay;
  for (const [id, label, confirmation] of guides) {
    await patch({ finderMenuContext: 'closed', elements: [anchor], windowId: '123:44' });
    await home.evaluate(id => window.helpOS.startLive(id), id);
    await stateIs('guiding', 0);
    coach = await pageForRoute('#coach'); overlay = await pageForRoute('#overlay');
    await assertHighlight(overlay, anchor.rect);
    await coach.getByRole('heading', { name: 'Click File', exact: true }).waitFor();
    await coach.evaluate(() => window.helpOS.confirmLive());
    assert.notEqual((await live()).verification, 'self-confirmed');
    await patch({ finderMenuContext: 'file', elements: [anchor, command(label)] });
    await stateIs('guiding', 1);
    await assertHighlight(overlay, command(label).rect);
    await coach.getByRole('heading', { name: 'Click ' + label, exact: true }).waitFor();
    assert.equal((await live()).canConfirm, false);
    // Another open menu must not look like successful File-command activation.
    await patch({ finderMenuContext: 'other', elements: [anchor] });
    await until(async () => !(await live()).target || (await live()).currentAction === 'open-file-menu', 'wrong menu recovery');
    assert.equal((await live()).canConfirm, false);
    await patch({ finderMenuContext: 'closed' });
    await until(async () => (await live()).currentAction === 'open-file-menu', 'File prerequisite restored');
    assert.equal((await live()).canConfirm, false);
    await patch({ finderMenuContext: 'file', elements: [anchor, command(label)] });
    await stateIs('guiding', 1);
    await patch({ finderMenuContext: 'closed', elements: [anchor] });
    await until(async () => (await live()).canConfirm === true, 'learner confirmation');
    assert.equal((await live()).verification, null);
    assert.equal((await live()).target, null);
    await coach.getByRole('heading', { name: confirmation, exact: true }).waitFor();
    await assertCoachPresentation({ application, coach, overlay, until });
    await coach.getByRole('button', { name: 'Complete', exact: true }).click();
    await until(async () => (await live()).verification === 'self-confirmed', 'user-owned completion');
    await home.evaluate(() => window.helpOS.stopLive());
    results.push(id + ': File → observed command → learner confirmation; wrong menu and premature confirmation rejected');
  }
  await patch({ finderMenuContext: 'file', elements: [anchor, command('Rename', { enabled: false })] });
  await home.evaluate(() => window.helpOS.startLive('finder-rename'));
  await stateIs('waiting-control');
  assert.equal((await live()).target, null);
  await coach.getByRole('heading', { name: 'Choose an item to rename', exact: true }).waitFor();
  await until(async () => (await overlay.evaluate(() => window.helpOS.getGuidePointer())) === null, 'unavailable action hides companion');
  await setElements([anchor, command('Rename', { scope: undefined })]);
  await until(async () => (await live()).title === 'Finding menu item', 'unscoped item rejected');
  assert.equal((await live()).target, null);
  await setElements([anchor, command('Rename')]);
  await stateIs('guiding', 1);
  await patch({ windowId: '123:45', finderMenuContext: 'closed', elements: [anchor] });
  await until(async () => (await live()).currentAction === 'open-file-menu', 'new window clears confirmation');
  assert.equal((await live()).canConfirm, false);
  results.push('Disabled and unscoped commands never highlight; a new Finder window clears prior completion evidence');
  await patch({ finderMenuContext: 'file', elements: [anchor, command('New Folder')] });
  await home.evaluate(() => window.helpOS.startLive('finder-new-folder'));
  await stateIs('guiding', 1);
  for (const scale of [1, 2]) {
    await coach.evaluate(value => {
      localStorage.setItem('helpos:text-scale', String(value));
      window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: String(value) }));
    }, scale);
    await coach.waitForFunction(value => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - value * 16) < .1, scale);
    await coach.getByRole('group', { name: 'New folder: Shift and Command and N', exact: true }).waitFor();
    await assertCoachPresentation({ application, coach, overlay, until, target: command('New Folder').rect });
  }
  results.push('New-folder instruction and shortcut fit actual Electron coach at100% and200%, clear of target with no scrolling');
  await coach.evaluate(() => window.helpOS.pauseLive());
  await stateIs('paused');
  await coach.getByRole('button', { name: 'Close help', exact: true }).click();
  await assertGuidanceHidden({ application, overlay, until });
  const diagnostics = await application.evaluate(() => globalThis.__finderTest);
  for (const key of ['permissionPrompts', 'registrationWrites', 'settingsOpens', 'captures']) assert.equal(diagnostics[key], 0);
  await writeFile(resultFile, JSON.stringify({ results, evidence: 'Injected native observations in isolated Electron profile. Production parser, IPC, engine, windows and rendering exercised; no real Finder file operation, grant, capture or watcher change. Actual Finder AX recognition remains a separate check.' }, null, 2));
  console.log(`PASS ${results.length} Finder desktop fixture checks`);
} catch (error) {
  await writeFile(resultFile, JSON.stringify({ results, failure: String(error), state: await live().catch(() => null) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await application.close(); }
