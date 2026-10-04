import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chooseFaceTimeGuide } from './companion-checks.mjs';

const data = await mkdtemp(path.join(os.tmpdir(), 'helpos-call-help-'));
await mkdir('test-results', { recursive: true });
const executablePath = process.argv[2];
const launch = () => electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + data] } : { args: ['.', '--user-data-dir=' + data] }), cwd: process.cwd(), timeout: 30000 });
let application = await launch();
const results = [];
const until = async check => {
  const end = Date.now() + 20000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Timed out waiting for call-help state');
};
// Engine state can become guiding before the native coach loads and
// Playwright attaches its page. Await that separate presentation boundary.
async function pageForRoute(hash) {
  let page;
  await until(() => {
    page = application.windows().find(candidate => !candidate.isClosed() && candidate.url().endsWith('/index.html' + hash));
    return !!page;
  });
  await page.waitForLoadState('domcontentloaded', { timeout: 20000 });
  return page;
}
async function assertPanelFits(page) {
  // Measure actual packaged native window contents, without scrolling elements
  // into view or changing the viewport to hide a clipped layout.
  await until(async () => page.evaluate(() => {
    const body = document.body;
    const elements = [...document.querySelectorAll('button,h1,h2,p')].filter(e => e.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
    return body.scrollHeight <= innerHeight && document.documentElement.scrollHeight <= innerHeight && elements.every(e => {
      const r = e.getBoundingClientRect();
      return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    });
  }));
  // A newly scaled window first uses its fallback height, then receives its
  // content measurement. Wait for that legitimate resize before checking
  // stability; a one-off shrink is not a resize loop.
  let previous = '', stableSince = 0;
  await until(async () => {
    const layout = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, fits: document.body.scrollHeight <= innerHeight && document.documentElement.scrollHeight <= innerHeight }));
    const key = JSON.stringify(layout);
    if (!layout.fits || key !== previous) { previous = key; stableSince = Date.now(); return false; }
    return Date.now() - stableSince >= 650;
  });
}
try {
  let home = await application.firstWindow();
  await home.getByRole('heading', { name: 'What would you like to do?' }).waitFor();
  await application.evaluate(({ app, globalShortcut, systemPreferences, desktopCapturer, shell }) => {
    const packaged = app.isPackaged;
    const nativePath = process.mainModule.require('node:path').join(app.getAppPath(), 'native', 'libhelpos-observer.dylib');
    globalThis.__loginFixture = { reads: [], writes: [], enabled: false };
    const validate = options => {
      if (options?.type !== 'agentService' || options?.serviceName !== 'app.helpos.app-watcher.plist') throw new Error('Unexpected login service in isolated test');
    };
    app.getLoginItemSettings = options => {
      validate(options); globalThis.__loginFixture.reads.push({ ...options });
      return { openAtLogin: globalThis.__loginFixture.enabled, status: globalThis.__loginFixture.enabled ? 'enabled' : 'not-registered' };
    };
    app.setLoginItemSettings = options => {
      validate(options); globalThis.__loginFixture.writes.push({ ...options });
      globalThis.__loginFixture.enabled = options.openAtLogin;
    };
    if (!packaged) Object.defineProperty(app, 'isPackaged', { configurable: true, value: true });
    // This suite does not test physical keyboard shortcuts. Keep fixture windows
    // from consuming the user's keys while native popup tests run on the desktop.
    const shortcuts = new Set();
    globalShortcut.register = key => { shortcuts.add(key); return true; };
    globalShortcut.unregister = key => { shortcuts.delete(key); };
    globalShortcut.unregisterAll = () => { shortcuts.clear(); };
    globalShortcut.isRegistered = key => shortcuts.has(key);
    const koffi = process.mainModule.require(app.getAppPath() + '/node_modules/koffi');
    const originalDecode = koffi.decode;
    const originalLoad = koffi.load;
    if (!packaged) koffi.load = function (filename, ...args) {
      return originalLoad.call(koffi, String(filename).endsWith('libhelpos-observer.dylib') ? nativePath : filename, ...args);
    };
    globalThis.__callTest = { bundle: 'com.apple.FaceTime', accessibility: true, muted: false, cameraOff: false, covered: null, missing: null, count: 0, contextDecodes: 0, observationDecodes: 0, callDecodes: 0, callState: 'inactive', permissionEvents: [], disableOnCallDecode: false, disabledDuringCallDecode: false };
    // Exercise permission IPC without prompting the user or opening Settings.
    // Live observations still complete their real native read and pointer decode.
    systemPreferences.isTrustedAccessibilityClient = prompt => {
      const t = globalThis.__callTest;
      t.permissionEvents.push({ type: prompt ? 'prompt' : 'read', kind: 'accessibility' });
      return t.accessibility;
    };
    systemPreferences.getMediaAccessStatus = kind => {
      if (kind !== 'screen') throw new Error('Unexpected permission kind in isolated test');
      return 'denied';
    };
    desktopCapturer.getSources = async () => { throw new Error('Screen capture is not part of this test'); };
    shell.openExternal = async url => { globalThis.__callTest.permissionEvents.push({ type: 'settings', url }); };
    globalThis.__emitActivation = (replay = false) => {
      const t = globalThis.__callTest;
      if (!replay) { t.activationId = process.mainModule.require('node:crypto').randomUUID(); t.activationAt = Date.now(); }
      app.emit('second-instance', {}, ['--background', '--app-help', t.bundle, '--activation-id', t.activationId, '--activation-at', String(t.activationAt)]);
    };
    // Complete the real read-only native call and pointer decode first. Replace
    // only the returned observation text; production still frees its pointer.
    koffi.decode = function (pointer, type, ...args) {
      const decoded = originalDecode.call(koffi, pointer, type, ...args);
      if (type !== 'char' || typeof decoded !== 'string') return decoded;
      let actual;
      try { actual = JSON.parse(decoded); } catch { return decoded; }
      if (!actual || typeof actual !== 'object') return decoded;
      const isContext = Object.hasOwn(actual, 'pid') && Object.hasOwn(actual, 'frontmostBundleId') && !Object.hasOwn(actual, 'trusted');
      const isObservation = Object.hasOwn(actual, 'trusted') && Object.hasOwn(actual, 'screenCapture');
      const isCall = Object.hasOwn(actual, 'callId') && Object.hasOwn(actual, 'accessibility') && Object.hasOwn(actual, 'state');
      if (!isContext && !isObservation && !isCall) return decoded;
      const t = globalThis.__callTest;
      t.count++;
      if (isContext) t.contextDecodes++; else if (isCall) t.callDecodes++; else t.observationDecodes++;
      const window = { x: 100, y: 100, width: 800, height: 600 };
      // Simulate an external OS Off while a real native call read is still
      // being decoded, before its active result reaches the monitor. This
      // boundary works even when the native binding has already been cached.
      if (isCall && t.disableOnCallDecode) {
        t.disableOnCallDecode = false; t.disabledDuringCallDecode = true;
        globalThis.__loginFixture.enabled = false;
      }
      if (isCall) return JSON.stringify({ accessibility: t.accessibility, state: t.callState, callId: t.callState === 'active' ? '123:4' : null, window: t.callState === 'active' ? window : null, controls: t.callState === 'active' ? [{ kind: 'microphone', rect: { x: 300, y: 600, width: 60, height: 60 } }, { kind: 'camera', rect: { x: 380, y: 600, width: 60, height: 60 } }, { kind: 'end', rect: { x: 500, y: 600, width: 60, height: 60 } }] : [], timestamp: Date.now() });
      const payload = isContext
        ? { frontmostBundleId: t.bundle, pid: 123, window, timestamp: Date.now() }
        : { trusted: t.accessibility, screenCapture: false, frontmostBundleId: 'app.helpos.desktop', frontmostName: 'HelpOS', observedBundleId: 'com.apple.FaceTime', occluded: !!t.covered, controlVisibility: { microphone: t.covered === 'mute' ? 'covered' : t.missing === 'mute' ? 'missing' : 'visible', camera: t.covered === 'camera' ? 'covered' : t.missing === 'camera' ? 'missing' : 'visible', end: t.covered === 'end' ? 'covered' : t.missing === 'end' ? 'missing' : 'visible' }, timestamp: Date.now(), source: 'accessibility', window, windowId: '123:4', elements: [
            { id: 'mute', role: 'AXButton', label: t.muted ? 'Unmute' : 'Mute', enabled: true, rect: { x: 300, y: 600, width: 60, height: 60 } },
            { id: 'camera', role: 'AXButton', label: t.cameraOff ? 'Camera On' : 'Camera Off', enabled: true, rect: { x: 380, y: 600, width: 60, height: 60 } },
            { id: 'end', role: 'AXButton', label: 'End', enabled: true, rect: { x: 500, y: 600, width: 60, height: 60 } },
          ].filter(element => element.id !== t.covered && element.id !== t.missing) };
      if (isObservation && t.hiddenToolbar) {
        payload.elements = [];
        payload.controlVisibility = { microphone: 'missing', camera: 'missing', end: 'missing' };
        delete payload.observedBundleId;
        payload.frontmostBundleId = t.helpFocused ? 'app.helpos.desktop' : 'com.apple.FaceTime';
        if (t.helpFocused) { payload.window = null; delete payload.windowId; }
      }
      return JSON.stringify(payload);
    };
  });
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).enabled, false);
  assert.deepEqual(await application.evaluate(() => globalThis.__loginFixture.writes), []);
  await home.evaluate(() => window.helpOS.setCallHelpEnabled(true));
  await application.evaluate(() => globalThis.__emitActivation());
  await until(async () => (await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion?.source === 'activation');
  const offer = await pageForRoute('#call-help');
  assert.ok(offer);
  await offer.getByRole('heading', { name: 'FaceTime help' }).waitFor();
  await until(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('#call-help') && w.isVisible())));
  await assertPanelFits(offer);
  const native = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#call-help'));
    return { visible: window.isVisible(), focused: window.isFocused(), prefs: window.webContents.getLastWebPreferences() };
  });
  assert.equal(native.visible, true);
  assert.equal(native.focused, false);
  assert.equal(native.prefs.sandbox, true);
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).status, 'idle');
  results.push('App activation fixture opens a passive native offer without a call requirement; no guide starts automatically');
  await offer.getByText('For FaceTime calls.', { exact: true }).waitFor();
  assert.equal(await offer.getByText('FaceTime call detected', { exact: true }).count(), 0);
  await offer.screenshot({ path: 'test-results/call-help-activation-fixture.png' });

  await assert.rejects(home.evaluate(() => window.helpOS.chooseCallHelpLesson('facetime-end')));
  await assert.rejects(offer.evaluate(() => window.helpOS.chooseCallHelpLesson('safari-zoom')));
  await assert.rejects(home.evaluate(() => window.helpOS.switchLiveLesson('facetime-camera')));
  await assert.rejects(home.evaluate(() => window.helpOS.reportCoachHeight(300)));
  await assert.rejects(home.evaluate(() => window.helpOS.reportCallHelpHeight(300)));
  await assert.rejects(offer.evaluate(() => window.helpOS.reportCoachHeight(300)));
  await assert.rejects(offer.evaluate(() => window.helpOS.reportCallHelpHeight(NaN)));
  results.push('Home renderer cannot switch the coach and unsupported lessons cannot start from a call offer');
  await offer.evaluate(() => window.helpOS.chooseCallHelpLesson('facetime-mic'));
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  const decodedCounts = await application.evaluate(() => ({ context: globalThis.__callTest.contextDecodes, observation: globalThis.__callTest.observationDecodes }));
  assert.ok(decodedCounts.context > 0 && decodedCounts.observation > 0);
  results.push('Choosing an app-activation fixture starts the live guide even while HelpOS has foreground focus');
  const coach = await pageForRoute('#coach');
  await coach.getByText('Guides', { exact: true }).click();
  await coach.getByRole('tab', { name: 'Microphone guide', exact: true }).waitFor();
  const revealSession = (await home.evaluate(() => window.helpOS.getLiveState())).sessionId;
  await application.evaluate(() => { globalThis.__callTest.hiddenToolbar = true; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'waiting-control');
  await coach.getByRole('heading', { name: 'Reveal call buttons', exact: true }).waitFor();
  assert.equal(await coach.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
  await assertPanelFits(coach);
  const waitingBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('#coach')).getBounds());
  await application.evaluate(() => { globalThis.__callTest.helpFocused = true; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'waiting-app');
  await assertPanelFits(coach);
  const lostContext = await home.evaluate(() => window.helpOS.getLiveState());
  assert.equal(lostContext.target, null); assert.equal(lostContext.contextWindow, undefined);
  assert.equal(lostContext.stepIndex, 0); assert.equal(lostContext.sessionId, revealSession);
  const missingWindows = await application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return { bounds: windows.find(w => w.webContents.getURL().endsWith('#coach')).getBounds(), overlay: windows.find(w => w.webContents.getURL().endsWith('#overlay')).isVisible() };
  });
  assert.equal(missingWindows.bounds.x, waitingBounds.x);
  assert.equal(missingWindows.bounds.y, waitingBounds.y);
  assert.equal(missingWindows.overlay, false);
  await application.evaluate(() => { globalThis.__callTest.hiddenToolbar = false; globalThis.__callTest.helpFocused = false; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).sessionId, revealSession);
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).stepIndex, 0);
  results.push('Hidden-toolbar and HelpOS-focus fixtures recover automatically without retry; panel stays in place and no stale target survives');
  await chooseFaceTimeGuide(coach, 'Camera guide');
  await until(async () => { const state = await home.evaluate(() => window.helpOS.getLiveState()); return state.lessonId === 'facetime-camera' && state.status === 'guiding'; });
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).target.x, 380);
  await assertPanelFits(coach);
  results.push('Camera tab switches the real guide window directly without opening the home screen');
  await application.evaluate(() => { globalThis.__callTest.covered = 'camera'; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'waiting-control');
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).target, null);
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).stepIndex, 0);
  await application.evaluate(() => { globalThis.__callTest.covered = null; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  results.push('Covered-button fixture hides the highlight without completing a step, then recovers');
  await application.evaluate(() => { globalThis.__callTest.cameraOff = true; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).stepIndex === 1);
  await application.evaluate(() => { globalThis.__callTest.cameraOff = false; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'complete');
  await chooseFaceTimeGuide(coach, 'End call guide');
  await until(async () => { const state = await home.evaluate(() => window.helpOS.getLiveState()); return state.lessonId === 'facetime-end' && state.status === 'guiding'; });
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).target.x, 500);
  results.push('A completed lesson can switch directly to Leave call help; no call action is performed');
  await application.evaluate(() => { globalThis.__callTest.muted = true; });
  await chooseFaceTimeGuide(coach, 'Microphone guide');
  await until(async () => { const state = await home.evaluate(() => window.helpOS.getLiveState()); return state.lessonId === 'facetime-mic' && state.status === 'guiding'; });
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).stepIndex, 0);
  assert.match((await home.evaluate(() => window.helpOS.getLiveState())).title, /Unmute/);
  await application.evaluate(() => { globalThis.__callTest.muted = false; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).stepIndex === 1);
  await application.evaluate(() => { globalThis.__callTest.muted = true; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'complete');
  results.push('Already-muted fixture starts with Unmute and requires two new changes to finish');
  await chooseFaceTimeGuide(coach, 'End call guide');
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  await application.evaluate(() => { globalThis.__callTest.cameraOff = true; globalThis.__callTest.covered = 'mute'; globalThis.__callTest.missing = 'end'; });
  await chooseFaceTimeGuide(coach, 'Camera guide');
  await until(async () => { const s = await home.evaluate(() => window.helpOS.getLiveState()); return s.status === 'guiding' && s.currentAction === 'camera-on'; });
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).stepIndex, 0);
  await application.evaluate(() => { globalThis.__callTest.cameraOff = false; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).stepIndex === 1);
  await application.evaluate(() => { globalThis.__callTest.cameraOff = true; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'complete');
  results.push('Visible Camera adapts and advances with an unrelated covered Mic and a missing End control');
  await application.evaluate(() => { globalThis.__callTest.covered = null; globalThis.__callTest.missing = null; });
  await chooseFaceTimeGuide(coach, 'Microphone guide');
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  await assertPanelFits(coach);
  await coach.screenshot({ path: 'test-results/intuitive-coach-packaged.png' });
  await home.evaluate(() => localStorage.setItem('helpos:text-scale', '2'));
  await until(() => coach.evaluate(() => innerWidth === 640));
  await assertPanelFits(coach);
  await coach.screenshot({ path: 'test-results/intuitive-coach-packaged-200.png' });
  await home.evaluate(() => localStorage.setItem('helpos:text-scale', '1'));
  await until(() => coach.evaluate(() => innerWidth === 320));
  await assertPanelFits(coach);
  results.push('Actual native coach expands and settles at 200% text, then restores without any scrolling');
  const overlayBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).getBounds());
  const layers = JSON.parse(execFileSync('/usr/bin/swift', ['-module-cache-path', '/private/tmp/helpos-swift-cache', 'scripts/dev/window-layers.swift', String(application.process().pid)], { encoding: 'utf8', timeout: 15000 }));
  assert.ok(layers.windows.some(window => window.layer === layers.overlayLayer && window.bounds.X === overlayBounds.x && window.bounds.Y === overlayBounds.y && window.bounds.Width === overlayBounds.width && window.bounds.Height === overlayBounds.height));
  await writeFile('test-results/contextual-window-layers.json', JSON.stringify(layers, null, 2));
  results.push('Actual CG overlay layer matches the native occlusion exclusion; ordinary HelpOS panels remain blockers');

  await application.evaluate(() => { globalThis.__callTest.accessibility = false; });
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'permission');
  const setupSession = (await home.evaluate(() => window.helpOS.getLiveState())).sessionId;
  await application.evaluate(() => { globalThis.__callTest.permissionEvents = []; });
  await coach.evaluate(() => window.helpOS.requestPermission('accessibility'));
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).status, 'paused');
  assert.deepEqual(await application.evaluate(() => globalThis.__callTest.permissionEvents.filter(event => event.type !== 'read')), [
    { type: 'prompt', kind: 'accessibility' },
    { type: 'settings', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' },
  ]);
  const recoveryReads = await application.evaluate(() => {
    globalThis.__callTest.accessibility = true;
    return { context: globalThis.__callTest.contextDecodes, observation: globalThis.__callTest.observationDecodes };
  });
  await application.evaluate(() => globalThis.__emitActivation());
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  const recoveredGuide = await home.evaluate(() => window.helpOS.getLiveState());
  assert.equal(recoveredGuide.sessionId, setupSession);
  assert.equal(recoveredGuide.permission.accessibility, true);
  assert.equal(recoveredGuide.target.x, 300);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  const recoveredReads = await application.evaluate(() => ({ context: globalThis.__callTest.contextDecodes, observation: globalThis.__callTest.observationDecodes }));
  assert.ok(recoveredReads.context > recoveryReads.context && recoveredReads.observation > recoveryReads.observation);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('#call-help') && w.isVisible())), false);
  results.push('Permission-request pause recovers the same guide after fresh matching FaceTime activation and granted native observation, without a second offer');

  await coach.evaluate(() => window.helpOS.pauseLive());
  // Opening setup from an explicit user pause must not make it auto-resumable.
  await coach.evaluate(() => window.helpOS.requestPermission('accessibility'));
  const deliberatePauseReads = await application.evaluate(() => globalThis.__callTest.contextDecodes);
  await application.evaluate(() => globalThis.__emitActivation());
  const deliberatelyPaused = await home.evaluate(() => window.helpOS.getLiveState());
  assert.equal(deliberatelyPaused.status, 'paused');
  assert.equal(deliberatelyPaused.sessionId, setupSession);
  assert.equal(deliberatelyPaused.target, null);
  assert.equal(await application.evaluate(() => globalThis.__callTest.contextDecodes), deliberatePauseReads);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  results.push('Explicit user Pause remains paused after permission IPC and a fresh matching FaceTime activation');
  await home.evaluate(() => window.helpOS.stopLive());
  const contextReads = await application.evaluate(() => globalThis.__callTest.contextDecodes);
  await application.evaluate(() => globalThis.__emitActivation(true));
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  assert.equal(await application.evaluate(() => globalThis.__callTest.contextDecodes), contextReads);
  results.push('A consumed activation visit cannot reopen help after finishing a guide');

  const sampleCalls = async (state, count) => {
    const before = await application.evaluate((_electron, state) => { const t = globalThis.__callTest; t.callState = state; return t.callDecodes; }, state);
    await until(() => application.evaluate((_electron, expected) => globalThis.__callTest.callDecodes >= expected, before + count));
  };
  const unchangedActivationReads = await application.evaluate(() => globalThis.__callTest.contextDecodes);
  await sampleCalls('inactive', 3);
  await sampleCalls('active', 2);
  await until(async () => (await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion?.source === 'detected');
  const firstCallOffer = (await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion.id;
  await until(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('#call-help') && w.isVisible())));
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).status, 'idle');
  await assertPanelFits(offer);
  assert.equal(await application.evaluate(() => globalThis.__callTest.contextDecodes), unchangedActivationReads);
  results.push('Two positive call-state fixtures open passive help while FaceTime stays in the same visit, without a new activation');

  await offer.evaluate(() => window.helpOS.chooseCallHelpLesson('facetime-mic'));
  await until(async () => (await home.evaluate(() => window.helpOS.getLiveState())).status === 'guiding');
  await home.evaluate(() => window.helpOS.stopLive());
  await sampleCalls('active', 2);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  results.push('Choosing a detected call offer consumes that call and does not reopen help after closing its guide');

  await sampleCalls('inactive', 3); await sampleCalls('active', 2);
  await until(async () => (await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion?.source === 'detected');
  assert.notEqual((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion.id, firstCallOffer);
  await offer.evaluate(() => window.helpOS.dismissCallHelp());
  await sampleCalls('active', 2);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  assert.equal(await application.evaluate(() => globalThis.__callTest.contextDecodes), unchangedActivationReads);
  results.push('Three inactive then two active samples offer for a later call in the same app visit; dismissal prevents repeats');

  await sampleCalls('inactive', 3); await sampleCalls('active', 1);
  const beforeLateCall = await application.evaluate(() => { globalThis.__callTest.disableOnCallDecode = true; return globalThis.__callTest.callDecodes; });
  await until(() => application.evaluate(() => globalThis.__callTest.disabledDuringCallDecode));
  assert.ok(await application.evaluate((_electron, previous) => globalThis.__callTest.callDecodes > previous, beforeLateCall));
  // Check presentation before a settings refresh can hide an erroneous offer.
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.webContents.getURL().endsWith('#call-help') && w.isVisible())), false);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  await home.evaluate(() => window.helpOS.setCallHelpEnabled(false));
  results.push('External OS Off during a real native call read prevents its decoded positive result from showing help');
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).enabled, false);
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
  const loginWrites = await application.evaluate(() => globalThis.__loginFixture.writes);
  assert.deepEqual(loginWrites, [
    { type: 'agentService', serviceName: 'app.helpos.app-watcher.plist', openAtLogin: true },
    { type: 'agentService', serviceName: 'app.helpos.app-watcher.plist', openAtLogin: false },
  ]);
  results.push('Explicit enable and disable address only the mocked app-watcher agent service');
  await home.evaluate(() => window.helpOS.previewCallHelp());
  await offer.getByText('Demo preview', { exact: true }).waitFor();
  await application.evaluate(({ app }) => { app.emit('activate'); });
  assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion?.source, 'preview');
  await offer.getByText('Demo preview', { exact: true }).waitFor();
  results.push('An app activation event preserves the currently visible help offer');
  await offer.screenshot({ path: 'test-results/call-help-preview-packaged.png' });
  await offer.evaluate(() => window.helpOS.chooseCallHelpLesson('facetime-camera'));
  await home.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
  await until(async () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.getURL().endsWith('/index.html') && window.isVisible())));
  assert.equal(await home.locator('.practice-page, .tutorial-scrim').count(), 0);
  assert.equal(await home.getByRole('button', { name: 'Open voice guide', exact: true }).isVisible(), true);
  assert.equal((await home.evaluate(() => window.helpOS.getLiveState())).status, 'idle');
  results.push('Internal preview while automatic help is off returns to live-only Home without starting a simulated or native guide');
  await writeFile('test-results/call-help-ipc-results.json', JSON.stringify({ packaged: !!executablePath, results, nativeDecodes: await application.evaluate(() => ({ context: globalThis.__callTest.contextDecodes, observation: globalThis.__callTest.observationDecodes, call: globalThis.__callTest.callDecodes })), note: 'Real Electron windows/preload/IPC; The real in-process native read-only operation and Koffi pointer decode run; recognized app-context, call-state and guide-observation JSON is replaced with fixtures after decoding. Call-state defaults to inactive, isolating any real user call; the new call-start scenarios use explicit active/inactive fixtures with actual decoded-call counts. App activation is delivered through a synthetic second-instance event. Login get/set methods are stubbed before any enable action, and every service option must target the app-watcher agent; no OS registration or restart persistence is tested. Dev builds redirect only the observer dylib load to the actual project library. Permission read, prompt and Settings boundaries are mocked for setup recovery; no OS permission was changed, no actual prompt or Settings opening occurred, and no call was placed or controlled. Physical keyboard shortcuts are stubbed.' }, null, 2));
  console.log('PASS', results.length, 'call help IPC checks');
} catch (error) {
  await writeFile('test-results/call-help-ipc-results.json', JSON.stringify({ results, failure: String(error), fixture: await application.evaluate(() => ({ callDecodes: globalThis.__callTest?.callDecodes, contextDecodes: globalThis.__callTest?.contextDecodes, disabledDuringCallDecode: globalThis.__callTest?.disabledDuringCallDecode, osEnabled: globalThis.__loginFixture?.enabled })) }, null, 2));
  console.error(error);
  console.log('DEBUG WINDOWS', JSON.stringify(await application.evaluate(({ BrowserWindow, app }) => ({ hidden: app.isHidden(), windows: BrowserWindow.getAllWindows().map(w => ({ url: w.webContents.getURL(), visible: w.isVisible(), loading: w.webContents.isLoadingMainFrame(), focused: w.isFocused() })) }))));
  console.log('DEBUG LIVE', JSON.stringify(await application.windows()[0].evaluate(() => window.helpOS.getLiveState()).catch(() => null)));
  console.log('DEBUG STATE', JSON.stringify(await application.windows()[0].evaluate(() => window.helpOS.getCallHelpState())));
  process.exitCode = 1;
} finally { await application.close(); }
