import { BrowserWindow, screen } from 'electron';
import type { VoiceState } from '../../../src/features/voice-guide/contracts';
import type { Renderer } from '../../platform/renderer';
import type { WindowSecurity } from '../../platform/security';

interface Options {
  renderer: Renderer; security: WindowSecurity;
  state(): VoiceState; cancel(): void; syncEscape(): void; isQuitting(): boolean;
}
export function createVoiceWindow(options: Options) {
  let window: BrowserWindow | null = null;
  let wanted = false;
  let height = 460;
  let scale = 1;
  function position() {
    if (!window) return;
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.round(Math.min(480 * scale, area.width - 32));
    const actualHeight = Math.min(height, area.height - 32);
    window.setBounds({ x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - actualHeight) / 2), width, height: actualHeight });
  }
  function show() {
    wanted = true;
    if (!window || window.isDestroyed()) {
      window = new BrowserWindow({ width: 480, height, frame: false, show: false, transparent: true, hasShadow: false, type: 'panel', skipTaskbar: true, alwaysOnTop: true, acceptFirstMouse: true, resizable: false, minimizable: false, maximizable: false,
        webPreferences: { preload: options.renderer.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
      const created = window;
      options.security.secureWindow(created, 'voice');
      created.setAlwaysOnTop(true, 'pop-up-menu', 3);
      created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      created.on('close', event => { if (!options.isQuitting()) { event.preventDefault(); options.cancel(); } });
      void options.renderer.load(created, 'voice').then(() => {
        if (created.isDestroyed() || window !== created) return;
        publish(options.state());
        if (wanted) { position(); created.showInactive(); options.syncEscape(); }
      });
    } else if (!window.webContents.isLoadingMainFrame()) { position(); window.showInactive(); }
    options.syncEscape();
  }
  function hide() { wanted = false; window?.hide(); options.syncEscape(); }
  function publish(state: VoiceState) { if (window && !window.isDestroyed()) window.webContents.send('helpos:voice-state', state); }
  return {
    show, hide, publish,
    isVisible: () => wanted,
    setHeight: (next: number) => { const rounded = Math.ceil(next); if (rounded !== height) { height = rounded; position(); } },
    setScale: (next: number) => { if (next !== scale) { scale = next; position(); } },
  };
}
