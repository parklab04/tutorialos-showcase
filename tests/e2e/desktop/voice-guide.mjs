import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runGoalHandoffChecks } from './voice-handoff-checks.mjs';
import { assertCoachPresentation, assertGuidanceHidden } from './companion-checks.mjs';

// Preload mocks in development. Packaged Electron ignores -r, so install them
// after quiet launch and prove native cancel uses the mock before any recording.
// A cached read-only observer may predate these mocks; decode its allocation
// normally, then substitute observation JSON. Speech must always use the mock.
// The real preload, validation, controller, engine and native windows remain.
const profile = await mkdtemp('/private/tmp/helpos-voice-desktop-');
const bootstrap = path.join(profile, 'voice-boundaries.cjs');
const executablePath = process.argv[2];
const applicationRoot = executablePath
  ? path.join(path.dirname(path.dirname(path.resolve(executablePath))), 'Resources', 'app.asar')
  : process.cwd();
await writeFile(path.join(profile, 'call-help.json'), JSON.stringify({ enabled: false }));
await mkdir('test-results', { recursive: true });
await writeFile(bootstrap, String.raw`
if (process.type === 'browser') {
  const { app, screen, globalShortcut, systemPreferences, desktopCapturer, shell } = require('electron');
  const fromApp = require('node:module').createRequire(process.env.HELPOS_VOICE_TEST_APP_ROOT + '/package.json');
  const koffi = fromApp('koffi');
  const originalDecode = koffi.decode;
  const childProcess = require('node:child_process');
  const memory = new Map();
  let pointer = 0n;
  const t = globalThis.__voiceDesktop = {
    installedBeforeMain: !globalThis.__voiceMainWasRunning, nativeLoads: 0, nativeCalls: [], starts: 0,
    observations: 0, openRequests: [], shortcutCallbacks: new Map(),
    permissionRequests: 0, captures: 0, settingsRequests: 0, registrationWrites: 0,
    nextTranscript: 'mute my microphone', nextError: null, micValue: '0', cameraValue: '1',
    lastTimestamp: 0, speech: null, allocations: 0, unexpectedNativeDecodes: 0,
    nativeObservationDecodes: 0, nativeCallDecodes: 0, nativeContextDecodes: 0,
    holdOpen: false, heldOpens: [], completedOpens: 0, failNextOpen: false,
    trusted: true, autoHelpEnabled: false, contexts: 0, noSpace: false, recoveryFit: false,
  };
  const snapshot = (phase = 'idle', transcript = '', error = null) => ({
    phase, transcript, error, locale: 'en-US', sessionId: phase === 'idle' || phase === 'cancelled' ? null : 'fixture-' + t.starts,
    microphone: 'authorized', speech: 'authorized', onDeviceSupported: true, listening: phase === 'listening',
  });
  t.speech = snapshot();
  const allocate = value => {
    const address = ++pointer;
    memory.set(address, JSON.stringify(value)); t.allocations = memory.size;
    return address;
  };
  const observation = command => {
    const timestamp = Math.max(Date.now(), t.lastTimestamp + 1); t.lastTimestamp = timestamp;
    if (command === '--facetime-call') return { accessibility: true, state: 'inactive', callId: null, window: null, timestamp };
    const area = screen.getPrimaryDisplay().workArea;
    const window = t.noSpace || t.recoveryFit ? { x: area.x + 16, y: area.y + 16, width: area.width - 32, height: area.height - 32 } :
      { x: area.x + 70, y: area.y + 70, width: Math.min(860, area.width - 140), height: Math.min(540, area.height - 140) };
    if (command === '--app-context') { t.contexts++; return { frontmostBundleId: 'com.apple.FaceTime', pid: 456, window, timestamp }; }
    t.observations++;
    const constrainedHeight = t.noSpace ? 500 : 360;
    const micRect = t.noSpace || t.recoveryFit ? { x: window.x, y: window.y + (window.height - constrainedHeight) / 2, width: Math.min(1600, window.width), height: constrainedHeight } :
      { x: window.x + 180, y: window.y + window.height - 90, width: 54, height: 54 };
    const cameraRect = { x: window.x + 260, y: micRect.y, width: 54, height: 54 };
    t.micRect = micRect; t.cameraRect = cameraRect;
    return { trusted: t.trusted, screenCapture: false, source: 'accessibility', frontmostBundleId: 'app.helpos.desktop', frontmostName: 'HelpOS',
      observedBundleId: 'com.apple.FaceTime', window, windowId: 'voice-fixture:44', timestamp, occluded: false,
      controlVisibility: { microphone: 'visible', camera: 'visible', end: 'visible' },
      elements: [
        { id: 'mic', nativeIdentifier: 'toggleMicMenuButton', role: 'AXCheckBox', subrole: 'AXSwitch', label: 'Microphone', value: t.micValue, enabled: true, rect: micRect },
        { id: 'camera', nativeIdentifier: 'toggleVideoButton', role: 'AXCheckBox', subrole: 'AXSwitch', label: 'Camera', value: t.cameraValue, enabled: true, rect: cameraRect },
        { id: 'end', role: 'AXButton', label: 'End', enabled: true, rect: { x: window.x + 340, y: micRect.y, width: 54, height: 54 } },
      ] };
  };
  koffi.load = filename => {
    if (!String(filename).endsWith('libhelpos-observer.dylib')) throw Error('Unexpected native library');
    t.nativeLoads++;
    return { func(declaration) {
      const name = declaration.match(/\b(helpos_[a-z_]+)\s*\(/)?.[1];
      if (name === 'helpos_voice_free' || name === 'helpos_free') return address => {
        if (!memory.delete(address)) throw Error('Unknown native allocation');
        t.allocations = memory.size;
      };
      const fn = () => { throw Error('Synchronous native call forbidden'); };
      fn.async = (...args) => {
        const callback = args.pop();
        t.nativeCalls.push(name);
        let value;
        if (name === 'helpos_observe') value = observation(args[0]);
        else if (name === 'helpos_voice_start') {
          if (args[0] !== 'en-US') throw Error('English default required');
          t.starts++;
          t.speech = t.nextError ? snapshot('error', '', t.nextError) : snapshot('listening');
          t.nextError = null; value = t.speech;
        } else if (name === 'helpos_voice_stop') {
          t.speech = snapshot('final', t.nextTranscript); value = t.speech;
        } else if (name === 'helpos_voice_cancel') {
          t.speech = snapshot('cancelled'); value = t.speech;
        } else if (name === 'helpos_voice_poll' || name === 'helpos_voice_status') value = t.speech;
        else throw Error('Unexpected native action: ' + name);
        const address = allocate(value);
        setImmediate(() => callback(null, address));
      };
      return fn;
    } };
  };
  koffi.decode = (address, type, ...args) => {
    if (type === 'char' && memory.has(address)) return memory.get(address);
    // Main may have cached its observation binding while reading OS startup
    // registration before this bootstrap ran. Its real free function still
    // owns that allocation; never hand it a fake pointer or leak the original.
    const decoded = originalDecode.call(koffi, address, type, ...args);
    let actual;
    if (type === 'char' && typeof decoded === 'string') {
      try { actual = JSON.parse(decoded); } catch { /* Reject unknown native output below. */ }
    }
    if (actual && typeof actual === 'object') {
      if (Object.hasOwn(actual, 'trusted') && Object.hasOwn(actual, 'screenCapture')) {
        t.nativeObservationDecodes++;
        return JSON.stringify(observation('--observe com.apple.FaceTime'));
      }
      if (Object.hasOwn(actual, 'callId') && Object.hasOwn(actual, 'accessibility')) {
        t.nativeCallDecodes++;
        return JSON.stringify(observation('--facetime-call'));
      }
      if (Object.hasOwn(actual, 'pid') && Object.hasOwn(actual, 'frontmostBundleId') && !Object.hasOwn(actual, 'trusted')) {
        t.nativeContextDecodes++;
        return JSON.stringify(observation('--app-context'));
      }
    }
    t.unexpectedNativeDecodes++;
    throw Error('Unexpected native decode');
  };
  // execFile was captured by main's promisify, but all Node child launches still
  // pass this low-level boundary. Replace only open with a harmless true process.
  const spawn = childProcess.ChildProcess.prototype.spawn;
  childProcess.ChildProcess.prototype.spawn = function(options) {
    if (options.file !== '/usr/bin/open') throw Error('Unexpected subprocess in voice test');
    t.openRequests.push(options.args.slice(1));
    const replacement = t.failNextOpen ? '/usr/bin/false' : '/usr/bin/true';
    t.failNextOpen = false;
    const emit = this.emit;
    this.emit = function(event, ...args) {
      if (event === 'close') {
        const finish = () => { t.completedOpens++; return emit.call(this, event, ...args); };
        if (t.holdOpen) { t.heldOpens.push(finish); return true; }
        return finish();
      }
      return emit.call(this, event, ...args);
    };
    return spawn.call(this, { ...options, file: replacement, args: [replacement] });
  };
  globalShortcut.register = (key, callback) => { t.shortcutCallbacks.set(key, callback); return true; };
  globalShortcut.unregister = key => t.shortcutCallbacks.delete(key);
  globalShortcut.unregisterAll = () => t.shortcutCallbacks.clear();
  globalShortcut.isRegistered = key => t.shortcutCallbacks.has(key);
  app.getLoginItemSettings = () => ({ openAtLogin: t.autoHelpEnabled, status: t.autoHelpEnabled ? 'enabled' : 'not-registered', wasOpenedAtLogin: false });
  app.setLoginItemSettings = () => { t.registrationWrites++; throw Error('Watcher registration forbidden'); };
  systemPreferences.isTrustedAccessibilityClient = prompt => {
    if (prompt) { t.permissionRequests++; throw Error('Permission prompt forbidden'); }
    return t.trusted;
  };
  systemPreferences.getMediaAccessStatus = () => 'granted';
  systemPreferences.askForMediaAccess = async () => { t.permissionRequests++; throw Error('Permission prompt forbidden'); };
  desktopCapturer.getSources = async () => { t.captures++; throw Error('Screen capture forbidden'); };
  shell.openExternal = async () => { t.settingsRequests++; throw Error('External application forbidden'); };
  shell.showItemInFolder = () => { t.settingsRequests++; throw Error('Finder activation forbidden'); };
}
`);

const resultFile = `test-results/voice-guide-${executablePath ? 'packaged' : 'development'}-results.json`;
const application = await electron.launch({
  ...(executablePath ? { executablePath, args: ['-r', bootstrap, '--background', '--user-data-dir=' + profile] } : { args: ['-r', bootstrap, '.', '--background', '--user-data-dir=' + profile] }),
  cwd: process.cwd(), timeout: 30000,
  env: { ...process.env, HELPOS_VOICE_TEST_APP_ROOT: applicationRoot },
});
const results = [];
const record = message => { results.push(message); console.log('PASS', message); };
const until = async (check, reason) => {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw Error('Timed out waiting for ' + reason);
};
const windows = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible() })));
const patch = value => application.evaluate((_electron, value) => Object.assign(globalThis.__voiceDesktop, value), value);
const shortcut = async () => {
  const invoked = await application.evaluate(() => {
    const callback = globalThis.__voiceDesktop.shortcutCallbacks.get('Control+Alt+Space');
    if (!callback) return false;
    callback(); return true;
  });
  // In the frozen package the shortcut registered before the mocks. Exercise
  // its real Record/Stop IPC path without generating system keyboard events.
  if (!invoked) await home.evaluate(async () => {
    const state = await window.helpOS.getVoiceState();
    if (state.phase === 'listening') await window.helpOS.stopVoice();
    else await window.helpOS.startVoice();
  });
};
async function pageForRoute(hash) {
  let page;
  await until(() => {
    page = application.windows().find(candidate => !candidate.isClosed() && candidate.url().endsWith('/index.html' + hash));
    return !!page;
  }, hash + ' page');
  await page.waitForLoadState('domcontentloaded');
  return page;
}
let home;
const state = () => home.evaluate(() => window.helpOS.getVoiceState());
const live = () => home.evaluate(() => window.helpOS.getLiveState());
async function phaseIs(phase) { await until(async () => (await state()).phase === phase, 'voice ' + phase); return state(); }
async function idleGuide() {
  await until(async () => (await live()).status === 'idle', 'ended guide');
  await until(async () => (await windows()).filter(window => /#coach|#overlay|#voice/.test(window.url)).every(window => !window.visible), 'hidden guide windows');
}
async function panelFits(page) {
  await until(() => page.evaluate(() => {
    const controls = [...document.querySelectorAll('button,input,label,h1,h2,p,footer')].filter(element => element.getClientRects().length);
    const containers = [...document.querySelectorAll('.voice-panel-content,.voice-panel-body,.voice-record-controls,.voice-command-form,.voice-panel-footer')];
    return document.body.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1 &&
      containers.every(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1 && !['scroll', 'auto'].includes(getComputedStyle(element).overflowY)) &&
      controls.every(element => { const rect = element.getBoundingClientRect(); return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1; });
  }), 'native panel without clipping');
}

try {
  assert.deepEqual(await windows(), []);
  if (!await application.evaluate(() => !!globalThis.__voiceDesktop)) {
    assert.ok(executablePath, 'Development boundary preloading must work');
    await application.evaluate((_electron, bootstrap) => {
      globalThis.__voiceMainWasRunning = true;
      process.mainModule.require(bootstrap);
    }, bootstrap);
  }
  assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.starts), 0);
  await application.evaluate(({ app }) => app.emit('activate'));
  home = await pageForRoute('');
  await home.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
  // cancel is harmless even if an earlier app activation cached a real native
  // binding. In that case this assertion fails, and no recording is attempted.
  await until(() => application.evaluate(() => globalThis.__voiceDesktop.nativeCalls.includes('helpos_voice_cancel')), 'proof the native voice adapter is mocked before recording');
  assert.equal((await state()).phase, 'idle');
  assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.starts), 0);
  const preloaded = await application.evaluate(() => globalThis.__voiceDesktop.installedBeforeMain);
  record('Quiet startup and home state never request microphone input; a mocked cancel proves the voice adapter is isolated before recording');

  await shortcut();
  const voice = await pageForRoute('#voice');
  await voice.getByRole('heading', { name: 'Voice guide', exact: true }).waitFor();
  await phaseIs('listening');
  await voice.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  assert.equal((await state()).transcript, '');
  await panelFits(voice);
  await shortcut();
  const reviewed = await phaseIs('review');
  assert.equal(reviewed.goal?.id, 'mute');
  assert.equal(reviewed.transcript, 'mute my microphone');
  assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.openRequests.length), 0);
  await voice.getByRole('button', { name: 'Show me', exact: true }).waitFor();
  await panelFits(voice);
  await voice.screenshot({ path: 'test-results/voice-guide-review.png' });
  record((preloaded ? 'Registered shortcut' : 'Record/Stop IPC') + ' starts and stops fixture speech, then displays editable request review before any app activation');

  await voice.getByRole('button', { name: 'Show me', exact: true }).click();
  await until(async () => (await live()).status === 'guiding' && (await live()).goal?.id === 'mute', 'single mute goal');
  const coach = await pageForRoute('#coach');
  const overlay = await pageForRoute('#overlay');
  await coach.getByRole('button', { name: 'Complete', exact: true }).waitFor();
  assert.equal((await live()).completionMode, 'manual');
  assert.equal((await live()).canComplete, true);
  const expected = await application.evaluate(() => globalThis.__voiceDesktop.micRect);
  assert.deepEqual((await live()).target, expected);
  await until(() => overlay.locator('.native-target').count().then(count => count === 1), 'real overlay target');
  await assertCoachPresentation({ application, coach, overlay, until, target: expected, passive: true });
  assert.deepEqual(await application.evaluate(() => globalThis.__voiceDesktop.openRequests), [['-b', 'com.apple.FaceTime']]);
  await panelFits(coach);
  await coach.screenshot({ path: 'test-results/voice-guide-coach.png' });
  record('Reviewed command opens one compact actionable bubble and a noninteractive target marker, clear of the target without taking focus; app activation is mocked');

  for (const method of ['startVoice', 'stopVoice', 'cancelVoice', 'useVoiceGoal', 'completeGoal']) {
    await assert.rejects(overlay.evaluate(method => window.helpOS[method](), method), /not allowed/);
  }
  await assert.rejects(overlay.evaluate(() => window.helpOS.submitVoiceText('mute my microphone')), /not allowed/);
  await assert.rejects(overlay.evaluate(() => window.helpOS.startGoal('camera-on')), /not allowed/);
  for (const method of ['stopLive', 'pauseLive', 'resumeLive', 'retryLive', 'confirmLive']) {
    await assert.rejects(overlay.evaluate(method => window.helpOS[method](), method), /not allowed/);
  }
  await assert.rejects(voice.evaluate(() => window.helpOS.completeGoal()), /not allowed/);
  for (const page of [home, voice, coach]) {
    await assert.rejects(page.evaluate(() => window.helpOS.getGuidePointer()), /not allowed/);
  }
  record('Overlay and wrong-role renderers cannot record, submit commands, start goals, mark them complete or read the overlay-only pointer feed');

  // Expanded setup must not contribute a permanent guiding-height floor. This
  // target leaves enough room for the compact goal, but not the setup panel.
  await patch({ trusted: false, recoveryFit: true });
  await until(async () => (await live()).status === 'permission', 'expanded recovery before a fitting compact target');
  await assertCoachPresentation({ application, coach, overlay, until, mode: 'recovery' });
  const recoveryLayoutId = await coach.evaluate(async () => (await window.helpOS.getLiveState()).coachLayoutId);
  assert.equal(typeof recoveryLayoutId, 'string');
  await patch({ trusted: true });
  await until(() => coach.evaluate(async () => {
    const state = await window.helpOS.getLiveState();
    return state.status === 'guiding' && state.canComplete && state.target?.height === 360;
  }), 'a stale permission height must not permanently block compact guidance');
  await assertCoachPresentation({ application, coach, overlay, until, target: await application.evaluate(() => globalThis.__voiceDesktop.micRect) });
  const compactLayoutId = await coach.evaluate(async () => (await window.helpOS.getLiveState()).coachLayoutId);
  assert.notEqual(compactLayoutId, recoveryLayoutId);
  const compactBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds());
  await coach.evaluate(id => window.helpOS.reportCoachHeight(3000, id), recoveryLayoutId);
  assert.deepEqual(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach')).getBounds()), compactBounds, 'A late valid recovery layout ID cannot resize the new compact coach');
  const afterStaleHeight = await coach.evaluate(() => window.helpOS.getLiveState());
  assert.equal(afterStaleHeight.coachLayoutId, compactLayoutId);
  assert.equal(afterStaleHeight.status, 'guiding');
  assert.equal(afterStaleHeight.canComplete, true);
  await assert.rejects(coach.evaluate(() => window.helpOS.reportCoachHeight(200)), /string|invalid|expected/i);
  await patch({ recoveryFit: false });
  await until(() => coach.evaluate(async expected => JSON.stringify((await window.helpOS.getLiveState()).target) === JSON.stringify(expected), expected), 'normal target after permission recovery');

  const noSpaceSession = (await live()).sessionId;
  await coach.evaluate(() => {
    window.__noSpaceStates = [];
    window.__stopNoSpaceStates = window.helpOS.onLiveState(state => {
      window.__noSpaceStates.push({ status: state.status, target: state.target, canComplete: state.canComplete, canConfirm: state.canConfirm, message: state.message, height: innerHeight });
      if (window.__noSpaceStates.length > 60) window.__noSpaceStates.shift();
    });
  });
  await patch({ noSpace: true });
  await until(() => coach.evaluate(async () => {
    const state = await window.helpOS.getLiveState();
    return state.status === 'waiting-control' && state.target === null && !state.canComplete && state.message === 'Make room for help.';
  }), 'placement-safe initial coach state and completion suppression');
  assert.equal((await live()).status, 'guiding', 'The engine fixture still has a valid target; only presentation cannot fit');
  assert.equal((await live()).canComplete, true);
  const unavailableComplete = coach.getByRole('button', { name: 'Complete', exact: true });
  await until(async () => await unavailableComplete.count() === 0 || await unavailableComplete.isDisabled(), 'no actionable Complete after no-fit render');
  await until(() => overlay.locator('.native-target').count().then(count => count === 0), 'unsafe target marker removed');
  await coach.evaluate(() => { window.__noSpaceStates = []; });
  const noSpaceObservations = await application.evaluate(() => globalThis.__voiceDesktop.observations);
  await until(() => application.evaluate((_electron, previous) => globalThis.__voiceDesktop.observations >= previous + 4, noSpaceObservations), 'four fresh observations with unchanged no-space geometry');
  const noSpaceStates = await coach.evaluate(() => window.__noSpaceStates);
  assert.ok(noSpaceStates.length >= 4, 'No-space presentation must be observed across repeated fresh engine publications');
  assert.ok(noSpaceStates.every(state => state.status === 'waiting-control' && state.target === null && !state.canComplete && !state.canConfirm), 'Unchanged no-space geometry must not oscillate back to a target or actionable Complete');
  assert.equal((await coach.evaluate(() => window.helpOS.getLiveState())).canComplete, false);
  await coach.evaluate(() => window.helpOS.completeGoal());
  assert.equal((await live()).sessionId, noSpaceSession);
  assert.equal((await live()).status, 'guiding');
  assert.equal((await live()).verification, null);
  await patch({ noSpace: false });
  await until(() => coach.evaluate(async () => {
    const state = await window.helpOS.getLiveState();
    return state.status === 'guiding' && state.canComplete && state.target !== null;
  }), 'fresh fitting target restores learner completion');
  await assertCoachPresentation({ application, coach, overlay, until, target: expected });
  await coach.getByRole('button', { name: 'Complete', exact: true }).waitFor();
  await coach.evaluate(() => window.__stopNoSpaceStates());
  record('Stale recovery layout heights cannot block fitting compact guidance; no-space geometry stays suppressed through four fresh observations, rejects direct completion and recovers on changed geometry');

  const observed = await application.evaluate(() => globalThis.__voiceDesktop.observations);
  await patch({ micValue: '1' });
  await until(() => application.evaluate((_electron, previous) => globalThis.__voiceDesktop.observations > previous, observed), 'updated switch fixture');
  assert.equal((await live()).status, 'guiding');
  assert.equal((await live()).verification, null);
  assert.equal((await live()).stepIndex, 0);
  await coach.evaluate(() => {
    window.__completionEvents = [];
    window.__stopCompletionEvents = window.helpOS.onLiveState(state => window.__completionEvents.push({ status: state.status, verification: state.verification }));
  });
  await coach.getByRole('button', { name: 'Complete', exact: true }).click();
  await idleGuide();
  await until(() => coach.evaluate(() => window.__completionEvents.some(state => state.status === 'complete' && state.verification === 'self-confirmed')), 'explicit learner-confirmed completion event');
  assert.equal(await coach.evaluate(() => window.__completionEvents.some(state => state.verification === 'observed')), false);
  await coach.evaluate(() => window.__stopCompletionEvents());
  await assertGuidanceHidden({ application, overlay, until });
  record('A switch change does not auto-complete; clicking compact Complete emits learner confirmation and closes both guidance surfaces');

  await patch({ nextTranscript: 'turn my camera off' });
  await shortcut(); await phaseIs('listening');
  assert.equal((await state()).transcript, '');
  assert.equal((await state()).goal, null);
  await shortcut();
  assert.equal((await phaseIs('review')).goal?.id, 'camera-off');
  await voice.getByRole('button', { name: 'Show me', exact: true }).click();
  await until(async () => (await live()).status === 'guiding' && (await live()).goal?.id === 'camera-off', 'next camera goal');
  assert.deepEqual((await live()).target, await application.evaluate(() => globalThis.__voiceDesktop.cameraRect));
  await coach.getByRole('button', { name: 'Complete', exact: true }).click();
  await idleGuide();
  assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.starts), 2);
  record('The next request creates a fresh empty voice session and independently guides a different command');

  await home.evaluate(() => window.helpOS.showVoice());
  await voice.getByLabel('Or type a command').fill('turn my microphone on');
  await voice.getByRole('button', { name: 'Review command', exact: true }).click();
  assert.equal((await phaseIs('review')).goal?.id, 'unmute');
  await voice.getByRole('button', { name: 'Show me', exact: true }).click();
  await until(async () => (await live()).status === 'guiding' && (await live()).goal?.id === 'unmute', 'typed unmute goal');
  await coach.getByRole('button', { name: 'Complete', exact: true }).click();
  await idleGuide();
  assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.starts), 2);
  record('Typed fallback follows the same review, visual guide and Complete flow without starting speech');

  await patch({ nextError: 'on-device-unavailable' });
  await shortcut(); await phaseIs('error');
  const unavailable = await voice.getByRole('alert').innerText();
  assert.doesNotMatch(unavailable, /on-device-unavailable/);
  assert.match(unavailable, /type/i);
  await panelFits(voice);
  await voice.getByLabel('Or type a command').fill('mute my microphone');
  await voice.getByRole('button', { name: 'Review command', exact: true }).click();
  assert.equal((await phaseIs('review')).goal?.id, 'mute');
  record('Local speech unavailability shows English recovery copy and keeps typed command review usable');

  const normalBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#voice')).getBounds());
  await voice.evaluate(() => {
    localStorage.setItem('helpos:text-scale', '2');
    window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' }));
  });
  await until(() => voice.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 32), '200% voice text');
  await until(() => application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#voice'));
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    return window.isVisible() && bounds.width === Math.round(Math.min(960, area.width - 32)) && bounds.height <= area.height - 32 &&
      bounds.x >= area.x && bounds.y >= area.y && bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height;
  }), 'native voice width/height following reported 200% scale');
  await panelFits(voice);
  const enlargedBounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#voice')).getBounds());
  assert.ok(enlargedBounds.width > normalBounds.width && enlargedBounds.height > normalBounds.height, 'Native panel must grow in both dimensions for 200% review text');
  await voice.screenshot({ path: `test-results/voice-guide-review-200-${executablePath ? 'packaged' : 'development'}.png` });
  await voice.evaluate(() => {
    localStorage.setItem('helpos:text-scale', '1');
    window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '1' }));
  });
  await until(() => voice.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 16), 'restored voice text');
  await panelFits(voice);
  record('200% voice text grows the actual native panel in width and height; all controls and footer remain readable without scrolling');

  await shortcut(); await phaseIs('listening');
  await voice.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await phaseIs('idle'); await idleGuide();
  const cancelled = await application.evaluate(() => globalThis.__voiceDesktop.speech);
  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.transcript, '');
  assert.equal((await state()).transcript, '');
  record('Escape cancels capture, clears the command and closes the native voice panel');

  await runGoalHandoffChecks({ application, home, pageForRoute, until, windows, patch, state, live, phaseIs, idleGuide, record });

  const diagnostics = await application.evaluate(() => {
    const t = globalThis.__voiceDesktop;
    return { installedBeforeMain: t.installedBeforeMain, nativeLoads: t.nativeLoads, starts: t.starts, observations: t.observations, openRequests: t.openRequests,
      permissionRequests: t.permissionRequests, captures: t.captures, settingsRequests: t.settingsRequests,
      registrationWrites: t.registrationWrites, allocations: t.allocations, unexpectedNativeDecodes: t.unexpectedNativeDecodes,
      nativeObservationDecodes: t.nativeObservationDecodes, nativeCallDecodes: t.nativeCallDecodes, nativeContextDecodes: t.nativeContextDecodes };
  });
  for (const key of ['permissionRequests', 'captures', 'settingsRequests', 'registrationWrites', 'allocations', 'unexpectedNativeDecodes']) assert.equal(diagnostics[key], 0, key);
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results, diagnostics,
    evidence: 'Real Electron preload/IPC, controller, intent parsing, live engine, coach, voice panel and target overlay. Development preloads mocks and invokes the registered hotkey callback. The frozen package installs mocks after quiet launch, proves its voice-cancel call is mocked before recording, and exercises Record/Stop IPC. Native speech always uses fixtures. Observations use fixtures through production parsing; a cached read-only native observer is decoded/freed normally before its JSON is replaced. Target-app open is replaced by /usr/bin/true, or /usr/bin/false for a failure; held close callbacks exercise passive activation, second-instance, automatic offers, cancellation and overlapping launches. No actual microphone, call control, permission request, or target app activation occurs. Screen-capture requests through the mocked Electron boundary remain zero; FaceTime observation is AX metadata only. This does not establish real speech-recognition or target-detection accuracy.' }, null, 2));
  console.log('PASS', results.length, 'isolated voice desktop checks');
} catch (error) {
  const coach = application.windows().find(page => page.url().endsWith('#coach'));
  const presentation = coach ? await coach.evaluate(async () => ({ state: await window.helpOS.getLiveState(), text: document.body.innerText, width: innerWidth, height: innerHeight, noSpaceStates: window.__noSpaceStates })).catch(() => null) : null;
  const diagnostics = await application.evaluate(() => {
    const t = globalThis.__voiceDesktop;
    return t ? { installedBeforeMain: t.installedBeforeMain, nativeLoads: t.nativeLoads, nativeCalls: t.nativeCalls,
      observations: t.observations, unexpectedNativeDecodes: t.unexpectedNativeDecodes,
      nativeObservationDecodes: t.nativeObservationDecodes, nativeCallDecodes: t.nativeCallDecodes, nativeContextDecodes: t.nativeContextDecodes,
      permissionRequests: t.permissionRequests, captures: t.captures, settingsRequests: t.settingsRequests,
      registrationWrites: t.registrationWrites, allocations: t.allocations } : null;
  }).catch(() => null);
  await writeFile(resultFile, JSON.stringify({ packaged: !!executablePath, results, failure: String(error), windows: await windows().catch(() => []),
    voiceState: home ? await state().catch(() => null) : null, liveState: home ? await live().catch(() => null) : null, presentation, diagnostics }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await application.close(); }
