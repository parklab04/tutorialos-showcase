import { createStartupSettings } from './features/startup/startup';
import { AppHelpController } from './features/app-help/controller';
import { createAppHelpService } from './features/app-help/service';
import { inspectAppContext } from './features/app-help/context';
import { runFaceTimeObserver } from './features/call-help/facetime-observer';
import { hasActivationArgument, parseActivation } from './features/app-help/activation';
import { isBackgroundLaunch } from './features/startup/launch';
import { app, globalShortcut, Menu, nativeImage, screen, Tray } from 'electron';
import path from 'node:path';
import { LiveEngine } from './features/live-guide/live-engine';
import { createLiveGuideWindows } from './features/live-guide/windows';
import { registerLiveGuideIPC } from './features/live-guide/ipc';
import { createCallHelpWindow } from './features/call-help/window';
import { registerCallHelpIPC } from './features/call-help/ipc';
import { createNativePermissionRequester } from './features/permissions/native';
import { registerPermissionIPC } from './features/permissions/ipc';
import { registerAIIPC } from './features/ai/ipc';
import { createRenderer } from './platform/renderer';
import { createWindowSecurity } from './platform/security';
import { createHomeWindow } from './platform/home-window';
import { registerAppIPC } from './platform/ipc';
import { runObserver } from './platform/observer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { VoiceController } from './features/voice-guide/controller';
import { createNativeVoiceInput } from './features/voice-guide/native-voice';
import { createVoiceWindow } from './features/voice-guide/window';
import { registerVoiceIPC } from './features/voice-guide/ipc';
import type { VoiceGoal } from '../src/features/voice-guide/contracts';
const runFile = promisify(execFile);
let goalGeneration = 0;
let pendingGoal: { generation: number; isCurrent: () => boolean } | null = null;

function hasPendingGoal() {
  return pendingGoal !== null && pendingGoal.generation === goalGeneration && pendingGoal.isCurrent();
}
function cancelPendingGoal() {
  ++goalGeneration;
  pendingGoal = null;
}

let quitting = false;
let startupReady = false;
let pendingActivation = parseActivation(process.argv);
let tray: Tray | null = null;
const observerLibrary = () => app.isPackaged ? path.join(process.resourcesPath, 'libhelpos-observer.dylib') : path.join(app.getAppPath(), 'native', 'libhelpos-observer.dylib');
const renderer = createRenderer(path.join(__dirname, 'preload.cjs'));
const security = createWindowSecurity(renderer, role => {
  if (role === 'voice') { voice.cancel(); return true; }
  if (role === 'call-help') { callHelp.dismiss(); return true; }
  if (engine.getState().status !== 'idle') { endGuide(); return true; }
  return false;
});
const home = createHomeWindow(renderer, security, () => quitting);
const engine = new LiveEngine((bundle, signal) => runObserver(observerLibrary(), bundle, signal), state => liveWindows.publish(state));
const callHelp = new AppHelpController({
  inspect: () => inspectAppContext(observerLibrary()),
  observeCall: async signal => {
    // Honor OS-disabled state even while every HelpOS window is hidden.
    if (!registration.get().enabled) {
      preferences.refresh();
      throw new Error('Automatic help is off.');
    }
    return runFaceTimeObserver(observerLibrary(), signal);
  },
  publish: state => callWindow.publish(preferences.decorate(state)),
  canOffer: () => !quitting && !hasPendingGoal() && !voiceWindow.isVisible() && registration.get().enabled && engine.getState().status === 'idle',
  canRecoverGuide: bundle => !quitting && !hasPendingGoal() && registration.get().enabled && engine.canRecoverPermissionFor(bundle),
  recoverGuide: bundle => engine.recoverPermissionFor(bundle),
});
const liveWindows = createLiveGuideWindows({
  renderer, security, isQuitting: () => quitting,
  getState: () => engine.getState(), getHome: home.get,
  endGuide, beforeShow: () => callHelp.suppressForGuide(), syncEscape,
});
const callWindow = createCallHelpWindow({
  renderer, security, isQuitting: () => quitting,
  getState: () => preferences.decorate(callHelp.getState()), getAnchor: () => callHelp.getAnchor(), getHome: home.get,
  canPresent: () => !hasPendingGoal() && !voiceWindow.isVisible() && registration.get().enabled && engine.getState().status === 'idle',
  dismiss: () => callHelp.dismiss(), syncEscape,
});
const requestPermission = createNativePermissionRequester();
const voiceWindow = createVoiceWindow({ renderer, security, isQuitting: () => quitting,
  state: () => voice.getState(), cancel: () => { voice.cancel(); }, syncEscape });
const nativeVoice = createNativeVoiceInput(observerLibrary());
const voice = new VoiceController({ native: nativeVoice,
  publish: state => { voiceWindow.publish(state); home.get()?.webContents.send('helpos:voice-state', state); },
  show: () => voiceWindow.show(), hide: () => voiceWindow.hide(),
  beforeInput: () => { cancelPendingGoal(); callHelp.dismiss(); engine.stop(); home.hide(); },
  guide: async (goal, isCurrent) => { await startGoal(goal, true, isCurrent); },
});
async function startGoal(goal: VoiceGoal, fromVoice = false, isCurrent = () => true) {
  const generation = ++goalGeneration;
  // The voice panel is hidden before the target app opens, while the engine is
  // still idle. Keep ownership of this interval independently of either UI.
  pendingGoal = { generation, isCurrent };
  try {
    if (!fromVoice) voice.cancel();
    callHelp.dismiss(); engine.stop(); home.hide();
    // The explicit Show me action brings the requested app forward; no target
    // control is clicked, no text is entered, and no FaceTime call is created.
    if (process.platform === 'darwin') {
      await runFile('/usr/bin/open', ['-b', goal.app === 'facetime' ? 'com.apple.FaceTime' : 'com.apple.Safari'], { timeout: 5000 });
    }
    if (generation !== goalGeneration || !isCurrent() || quitting) return engine.getState();
    return engine.startGoal(goal);
  } finally {
    // A cancelled/older open can settle after another request has taken over.
    if (pendingGoal?.generation === generation) pendingGoal = null;
  }
}


const registration = createStartupSettings({
  available: () => process.platform === 'darwin' && app.isPackaged,
  read: () => app.getLoginItemSettings({ type: 'agentService', serviceName: 'app.helpos.app-watcher.plist' }),
  write: enabled => app.setLoginItemSettings({ type: 'agentService', serviceName: 'app.helpos.app-watcher.plist', openAtLogin: enabled }),
});
const preferences = createAppHelpService(callHelp, registration, state => callWindow.publish(state));

async function handleActivation(argv: readonly string[]) {
  const request = parseActivation(argv);
  if (!request) return;
  if (!startupReady) { pendingActivation = request; return; }
  preferences.refresh();
  await callHelp.acceptActivation(request);
}

function showHome(mode?: 'practice') {
  cancelPendingGoal(); voice.cancel();
  callHelp.dismiss();
  engine.stop();
  home.show(mode);
}
function endGuide() {
  cancelPendingGoal();
  voice.cancel();
  engine.stop();
}
function syncEscape() {
  const visibleHelp = voiceWindow.isVisible() || callWindow.isVisible() || liveWindows.isVisible();
  if (!visibleHelp) globalShortcut.unregister('Escape');
  else if (!globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', () => {
    cancelPendingGoal();
    if (voiceWindow.isVisible()) voice.cancel();
    else if (engine.getState().status !== 'idle') engine.stop();
    else callHelp.dismiss();
  });
}
function registerIPC() {
  registerAppIPC({ security, showHome });
  registerLiveGuideIPC({ security, engine, windows: liveWindows, home, endGuide });
  registerCallHelpIPC({ security, callHelp, preferences, window: callWindow, engine, home });
  registerPermissionIPC({ security, engine, requestPermission });
  registerAIIPC(security);
  registerVoiceIPC({ security, voice, window: voiceWindow, guide: startGoal, engine, getPresentedState: liveWindows.getPresentationState });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    if (hasActivationArgument(commandLine)) { void handleActivation(commandLine); return; }
    if (hasPendingGoal() || voiceWindow.isVisible()) return;
    if (commandLine.includes('--preview-call-help')) { engine.stop(); callHelp.preview(); }
    else if (!commandLine.includes('--background') && engine.getState().status === 'idle' && !callHelp.getState().suggestion) showHome();
  });
  app.whenReady().then(async () => {
    // The login AppleEvent is available only after ready. There is no macOS
    // openAsHidden option in Electron 44: create no home window on login.
    let wasOpenedAtLogin = false;
    if (process.platform === 'darwin' && app.isPackaged) {
      try { wasOpenedAtLogin = app.getLoginItemSettings({ type: 'mainAppService' }).wasOpenedAtLogin; } catch { /* A manual launch remains usable. */ }
    }
    const background = hasActivationArgument(process.argv) || isBackgroundLaunch(process.argv, wasOpenedAtLogin);
    registerIPC();
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'HelpOS', submenu: [{ label: 'Open HelpOS', click: () => showHome() }, { type: 'separator' }, { role: 'quit', label: 'Quit HelpOS' }] }, { label: 'Edit', submenu: [{ role: 'undo', label: 'Undo' }, { role: 'redo', label: 'Redo' }, { type: 'separator' }, { role: 'cut', label: 'Cut' }, { role: 'copy', label: 'Copy' }, { role: 'paste', label: 'Paste' }, { role: 'selectAll', label: 'Select All' }] }]));
    const image = nativeImage.createEmpty();
    tray = new Tray(image); tray.setTitle('HelpOS'); tray.setToolTip('HelpOS guides');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Voice guide (Control+Option+Space)', click: () => voice.open() }, { label: 'All guides', click: () => showHome() }, { label: 'End guide', click: endGuide }, { type: 'separator' }, { label: 'Quit HelpOS', click: () => app.quit() }]));
    voice.setShortcut(globalShortcut.register('Control+Alt+Space', () => { void voice.toggle(); }));
    if (!background) home.create();
    preferences.refresh();
    if (process.argv.includes('--preview-call-help')) callHelp.preview();
    startupReady = true;
    if (pendingActivation) { const request = pendingActivation; pendingActivation = null; await callHelp.acceptActivation(request); }
    screen.on('display-metrics-changed', () => { if (callHelp.getState().suggestion) callWindow.position(); });
  });
  app.on('activate', () => { if (startupReady && !hasPendingGoal() && !voiceWindow.isVisible() && engine.getState().status === 'idle' && !callHelp.getState().suggestion) showHome(); });
  app.on('window-all-closed', () => { /* Menu-bar help remains available until explicit Quit. */ });
  app.on('before-quit', () => { quitting = true; cancelPendingGoal(); voice.dispose(); callHelp.dispose(); engine.stop(); liveWindows.dispose(); globalShortcut.unregisterAll(); tray?.destroy(); });
}
