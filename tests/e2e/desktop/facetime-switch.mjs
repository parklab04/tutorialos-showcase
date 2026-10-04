import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { assertCoachPresentation, assertGuidanceHidden, chooseFaceTimeGuide } from './companion-checks.mjs';

// Isolated HelpOS windows only. Native allocations are decoded normally, then
// exact fixture JSON passes through the production parser, engine, and IPC.
// Switch values below simulate observations; no FaceTime input is generated.
const profile = await mkdtemp('/private/tmp/helpos-facetime-switch-');
await writeFile(profile + '/call-help.json', JSON.stringify({ enabled: false }));
await mkdir('test-results', { recursive: true });
const executablePath = process.argv[2];
const resultFile = `test-results/facetime-switch-${executablePath ? 'packaged' : 'development'}-results.json`;
const application = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + profile] } : { args: ['.', '--user-data-dir=' + profile] }), cwd: process.cwd(), timeout: 30000 });
const results = [];
let home;
const until = async (check, reason) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + reason);
};
const record = message => { results.push(message); console.log('PASS', message); };
const live = () => home.evaluate(() => window.helpOS.getLiveState());
const patch = value => application.evaluate((_electron, value) => Object.assign(globalThis.__switchTest, value), value);
const stateIs = async (status, step, action) => {
  await until(async () => {
    const state = await live();
    return state.status === status && (step === undefined || state.stepIndex === step) && (action === undefined || state.currentAction === action);
  }, `${status} step ${step} action ${action}`);
  return live();
};
async function pageForRoute(hash) {
  let page;
  await until(() => {
    page = application.windows().find(candidate => !candidate.isClosed() && candidate.url().endsWith('/index.html' + hash));
    return !!page;
  }, 'native page ' + hash);
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  return page;
}
async function assertHighlight(overlay, expected) {
  await until(() => application.evaluate(({ BrowserWindow }) => ['#coach', '#overlay'].every(hash => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith(hash) && window.isVisible()))), 'visible coach and spotlight windows');
  await until(async () => overlay.evaluate(async expected => {
    const state = await window.helpOS.getLiveState();
    const hole = document.querySelector('.native-target');
    if (state.status !== 'guiding' || !state.overlayOrigin || !hole) return false;
    return JSON.stringify(state.target) === JSON.stringify(expected) &&
      Math.abs(parseFloat(hole.style.width) - expected.width - 12) < 1 &&
      Math.abs(parseFloat(hole.style.height) - expected.height - 12) < 1 &&
      Math.abs(parseFloat(hole.style.left) + state.overlayOrigin.x + 6 - expected.x) < 1 &&
      Math.abs(parseFloat(hole.style.top) + state.overlayOrigin.y + 6 - expected.y) < 1;
  }, expected), 'spotlight hole at exact fixture control bounds');
  await assertCoachPresentation({ application, coach: await pageForRoute('#coach'), overlay, until, target: expected });
}
async function assertNoHighlight(overlay) {
  assert.equal((await live()).target, null);
  // A waiting-state companion may remain visible, but never a stale target.
  await until(() => overlay.locator('.native-target').count().then(count => count === 0), 'no stale spotlight target');
}
async function assertPanelFits(page) {
  // Do not resize or scroll the native window to make the assertion pass.
  await until(() => page.evaluate(() => {
    const visible = [...document.querySelectorAll('button,h1,h2,p,.live-control-tab > span')].filter(element => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
    const containers = [...document.querySelectorAll('.native-coach,.live-coach-content,.native-coach-body')];
    return document.body.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1 &&
      containers.every(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1 && !['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) &&
      visible.every(element => { const box = element.getBoundingClientRect(); return box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1; });
  }), 'readable native coach without clipping or internal scrolling');
}
async function assertNeutralCopy(coach, heading) {
  await coach.getByRole('heading', { name: heading, exact: true }).waitFor();
  const text = await coach.locator('.live-action').innerText();
  assert.doesNotMatch(text, /\b(muted|unmuted|mute|unmute|camera on|camera off|turned off|turned on)\b/i);
}

try {
  home = await application.firstWindow();
  await home.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
  await application.evaluate(({ app, screen, globalShortcut, systemPreferences, desktopCapturer, shell }) => {
    const requireFromApp = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
    const koffi = requireFromApp('koffi');
    const originalDecode = koffi.decode;
    const originalLoad = koffi.load;
    const nativePath = requireFromApp('node:path').join(app.getAppPath(), 'native', 'libhelpos-observer.dylib');
    if (!app.isPackaged) koffi.load = function (filename, ...args) {
      return originalLoad.call(koffi, String(filename).endsWith('libhelpos-observer.dylib') ? nativePath : filename, ...args);
    };
    const area = screen.getPrimaryDisplay().workArea;
    const window = { x: area.x + 70, y: area.y + 70, width: Math.min(860, area.width - 140), height: Math.min(540, area.height - 140) };
    globalThis.__switchTest = {
      accessibility: true, micValue: '0', cameraValue: '1', covered: null, missing: null, invalidIdentifier: false,
      window, windowId: 'switch-fixture:44',
      micRect: { x: window.x + 180, y: window.y + window.height - 90, width: 54, height: 54 },
      cameraRect: { x: window.x + 260, y: window.y + window.height - 90, width: 54, height: 54 },
      observationDecodes: 0, callDecodes: 0, contextDecodes: 0, lastTimestamp: 0,
      permissionPrompts: 0, registrationWrites: 0, settingsOpens: 0, captures: 0,
    };
    app.getLoginItemSettings = () => ({ openAtLogin: false, status: 'not-registered' });
    app.setLoginItemSettings = () => { globalThis.__switchTest.registrationWrites++; throw new Error('Watcher writes are forbidden in this test'); };
    const shortcuts = new Set();
    globalShortcut.register = key => { shortcuts.add(key); return true; };
    globalShortcut.unregister = key => { shortcuts.delete(key); };
    globalShortcut.unregisterAll = () => shortcuts.clear();
    globalShortcut.isRegistered = key => shortcuts.has(key);
    systemPreferences.isTrustedAccessibilityClient = prompt => {
      if (prompt) { globalThis.__switchTest.permissionPrompts++; throw new Error('Permission prompts are forbidden in this test'); }
      return globalThis.__switchTest.accessibility;
    };
    systemPreferences.getMediaAccessStatus = () => 'granted';
    desktopCapturer.getSources = async () => { globalThis.__switchTest.captures++; throw new Error('Capture requests are forbidden in this test'); };
    shell.openExternal = async () => { globalThis.__switchTest.settingsOpens++; throw new Error('Opening Settings is forbidden in this test'); };
    shell.showItemInFolder = () => { globalThis.__switchTest.settingsOpens++; throw new Error('Opening Finder is forbidden in this test'); };
    koffi.decode = function (pointer, type, ...args) {
      const decoded = originalDecode.call(koffi, pointer, type, ...args);
      if (type !== 'char' || typeof decoded !== 'string') return decoded;
      let actual;
      try { actual = JSON.parse(decoded); } catch { return decoded; }
      if (!actual || typeof actual !== 'object') return decoded;
      const t = globalThis.__switchTest;
      const timestamp = Math.max(Date.now(), t.lastTimestamp + 1); t.lastTimestamp = timestamp;
      if (Object.hasOwn(actual, 'callId') && Object.hasOwn(actual, 'accessibility')) {
        t.callDecodes++;
        return JSON.stringify({ accessibility: t.accessibility, state: 'inactive', callId: null, window: null, timestamp });
      }
      if (Object.hasOwn(actual, 'pid') && Object.hasOwn(actual, 'frontmostBundleId') && !Object.hasOwn(actual, 'trusted')) {
        t.contextDecodes++;
        return JSON.stringify({ frontmostBundleId: 'com.apple.FaceTime', pid: 123, window: t.window, timestamp });
      }
      if (!Object.hasOwn(actual, 'trusted') || !Object.hasOwn(actual, 'screenCapture')) return decoded;
      t.observationDecodes++;
      const elements = [
        { id: 'observed-mic', nativeIdentifier: t.invalidIdentifier ? 'untrusted-switch' : 'toggleMicMenuButton', role: 'AXCheckBox', subrole: 'AXSwitch', label: 'Microphone', value: t.micValue, enabled: true, rect: t.micRect },
        { id: 'observed-camera', nativeIdentifier: 'toggleVideoButton', role: 'AXCheckBox', subrole: 'AXSwitch', label: 'Camera', value: t.cameraValue, enabled: true, rect: t.cameraRect },
        { id: 'observed-end', role: 'AXButton', label: 'End', enabled: true, rect: { x: t.window.x + 340, y: t.micRect.y, width: 54, height: 54 } },
      ].filter(element => element.id !== `observed-${t.missing}` && element.id !== `observed-${t.covered}`);
      return JSON.stringify({ trusted: t.accessibility, screenCapture: false, source: 'accessibility',
        frontmostBundleId: 'app.helpos.desktop', frontmostName: 'HelpOS', observedBundleId: 'com.apple.FaceTime',
        window: t.window, windowId: t.windowId, timestamp, occluded: !!t.covered,
        controlVisibility: { microphone: t.covered === 'mic' ? 'covered' : t.missing === 'mic' ? 'missing' : 'visible', camera: t.covered === 'camera' ? 'covered' : t.missing === 'camera' ? 'missing' : 'visible', end: 'visible' }, elements });
    };
  });
  const fixture = await application.evaluate(() => globalThis.__switchTest);
  await home.evaluate(() => window.helpOS.startLive('facetime-mic'));
  const initial = await stateIs('guiding', 0, 'mic-toggle');
  const coach = await pageForRoute('#coach');
  const overlay = await pageForRoute('#overlay');
  await assertHighlight(overlay, fixture.micRect);
  await assertCoachPresentation({ application, coach, overlay, until, target: fixture.micRect, passive: true });
  await assertNeutralCopy(coach, 'Click microphone');
  assert.equal(await coach.getByRole('tab', { name: 'Camera guide', exact: true }).isVisible(), false, 'Legacy guide tabs stay behind the Guides disclosure');
  assert.equal(initial.canConfirm, false);
  await assertPanelFits(coach);
  await coach.screenshot({ path: 'test-results/facetime-switch-mic-default.png' });
  record('Exact Microphone AXCheckBox/AXSwitch identifier and string value survive production parsing and render a neutral native spotlight');

  const beforeRepeat = await application.evaluate(() => globalThis.__switchTest.observationDecodes);
  await until(() => application.evaluate((_electron, before) => globalThis.__switchTest.observationDecodes >= before + 2, beforeRepeat), 'two fresh unchanged switch observations');
  assert.equal((await live()).stepIndex, 0);
  assert.equal((await live()).status, 'guiding');
  record('Repeated unchanged native observations cannot count as a learner toggle');

  await patch({ micValue: '1' });
  await stateIs('guiding', 1, 'mic-toggle-again');
  await assertNeutralCopy(coach, 'Click it again');
  await assertHighlight(overlay, fixture.micRect);
  await patch({ micValue: '0' });
  const micComplete = await stateIs('complete');
  assert.equal(micComplete.verification, 'observed');
  assert.match(micComplete.why, /microphone switch/);
  assert.doesNotMatch(micComplete.why, /\b(mute|unmute|muted|unmuted)\b/i);
  await assertNeutralCopy(coach, 'Done');
  await assertNoHighlight(overlay);
  record('Microphone requires two fresh binary flips; completion confirms changes without claiming mute polarity');

  await chooseFaceTimeGuide(coach, 'Camera guide');
  await stateIs('guiding', 0, 'camera-toggle');
  await assertNeutralCopy(coach, 'Click camera');
  await assertHighlight(overlay, fixture.cameraRect);
  await patch({ cameraValue: '0' });
  await stateIs('guiding', 1, 'camera-toggle-again');
  await assertNeutralCopy(coach, 'Click it again');
  await patch({ cameraValue: '1' });
  const cameraComplete = await stateIs('complete');
  assert.equal(cameraComplete.verification, 'observed');
  assert.match(cameraComplete.why, /camera switch/);
  await assertNoHighlight(overlay);
  record('The Camera tab uses its exact native switch and completes two flips from the opposite initial value without assuming on/off');

  await chooseFaceTimeGuide(coach, 'Microphone guide');
  await stateIs('guiding', 0, 'mic-toggle');
  const recoverySession = (await live()).sessionId;
  await patch({ missing: 'mic' });
  await stateIs('waiting-control', 0);
  await assertNoHighlight(overlay);
  assert.equal(await coach.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
  await patch({ missing: null });
  await stateIs('guiding', 0, 'mic-toggle');
  assert.equal((await live()).sessionId, recoverySession);
  await assertHighlight(overlay, fixture.micRect);
  record('A missing switch clears the actual spotlight and recovers automatically in the same session without advancing');

  await patch({ micValue: '1' });
  await stateIs('guiding', 1, 'mic-toggle-again');
  await patch({ covered: 'mic', micValue: '0' });
  await stateIs('waiting-control', 1);
  await assertNoHighlight(overlay);
  await coach.getByRole('heading', { name: 'Move a window', exact: true }).waitFor();
  await patch({ covered: null });
  await stateIs('guiding', 1, 'mic-toggle-again');
  await assertHighlight(overlay, fixture.micRect);
  assert.equal((await live()).verification, null);
  await patch({ micValue: '1' });
  await stateIs('complete');
  record('Covered controls remove the spotlight; a value change across the hidden gap is not completion evidence');

  await patch({ invalidIdentifier: true });
  await home.evaluate(() => window.helpOS.startLive('facetime-mic'));
  await stateIs('error');
  await assertNoHighlight(overlay);
  await assertCoachPresentation({ application, coach, overlay, until, mode: 'recovery' });
  await coach.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await patch({ invalidIdentifier: false });
  await coach.evaluate(() => window.helpOS.retryLive());
  await stateIs('guiding', 0, 'mic-toggle');
  await assertHighlight(overlay, fixture.micRect);
  record('Production JSON validation rejects an unsupported native identifier and retry can restore a valid switch');

  await coach.evaluate(() => { localStorage.setItem('helpos:text-scale', '2'); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' })); });
  await until(() => coach.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 32), 'largest guide text');
  await assertPanelFits(coach);
  await assertHighlight(overlay, fixture.micRect);
  await coach.screenshot({ path: 'test-results/facetime-switch-mic-200.png' });
  await chooseFaceTimeGuide(coach, 'Camera guide');
  await stateIs('guiding', 0, 'camera-toggle');
  await assertPanelFits(coach);
  await assertHighlight(overlay, fixture.cameraRect);
  await coach.screenshot({ path: 'test-results/facetime-switch-camera-200.png' });
  record('Both neutral switch coaches remain readable at largest text with native sizing, visible targets, and no internal scrolling');

  await coach.getByRole('button', { name: 'Pause', exact: true }).click();
  await stateIs('paused');
  await assertNoHighlight(overlay);
  await coach.getByRole('button', { name: 'Close help', exact: true }).click();
  await stateIs('idle');
  await assertGuidanceHidden({ application, overlay, until });
  const diagnostics = await application.evaluate(() => globalThis.__switchTest);
  assert.ok(diagnostics.observationDecodes >= 15);
  for (const name of ['permissionPrompts', 'registrationWrites', 'settingsOpens', 'captures']) assert.equal(diagnostics[name], 0, name);
  record('Pause and Close help remove the spotlight; no permission, watcher, capture, or external-app action occurred');
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results, diagnostics: { observationDecodes: diagnostics.observationDecodes, callDecodes: diagnostics.callDecodes, contextDecodes: diagnostics.contextDecodes, permissionPrompts: 0, registrationWrites: 0, settingsOpens: 0, captures: 0 }, evidence: 'Real Electron preload/IPC, production JSON parsing and engine, native HelpOS coach/overlay windows, and spotlight rendering. Exact FaceTime switch fixtures replace JSON after read-only native allocation decoding. No actual FaceTime controls were clicked or calls controlled; this does not prove real native FaceTime recognition.' }, null, 2));
  console.log(`PASS ${results.length} isolated FaceTime switch desktop checks`);
} catch (error) {
  const state = home ? await live().catch(() => null) : null;
  const diagnostics = await application.evaluate(() => globalThis.__switchTest ?? null).catch(() => null);
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results, failure: String(error), state, diagnostics }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await application.close(); }
