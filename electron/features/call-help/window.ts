import { BrowserWindow, screen } from 'electron';
import type { CallHelpState } from '../../../src/features/call-help/contracts';
import { placePanel } from '../../platform/placement';
import type { Rect } from '../../../src/shared/geometry';
import type { Renderer } from '../../platform/renderer';
import type { WindowSecurity } from '../../platform/security';

interface Options {
  renderer: Renderer;
  security: WindowSecurity;
  isQuitting(): boolean;
  getState(): CallHelpState;
  canPresent(): boolean;
  getAnchor(): Rect | null;
  getHome(): BrowserWindow | null;
  dismiss(): void;
  syncEscape(): void;
}
export function createCallHelpWindow({ renderer, security, isQuitting, getState, canPresent, getAnchor, getHome, dismiss, syncEscape }: Options) {
  const { preload, load } = renderer;
  const { secureWindow } = security;
  let callOffer: BrowserWindow | null = null;
  let callHelpScale = 1;
  let callHelpHeight: number | null = null;
  let callOfferReady = false;
  function positionCallHelp() {
    if (!callOffer || callOffer.isDestroyed()) return;
    const anchor = getAnchor();
    const area = (anchor ? screen.getDisplayMatching(anchor) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
    const width = Math.max(1, Math.min(Math.round(360 * callHelpScale), area.width - 32));
    const height = Math.max(1, Math.min(Math.ceil(callHelpHeight ?? 340 * callHelpScale), area.height - 32));
    const controls = getState().suggestion?.controls ?? [];
    const avoid = controls.map(({ rect }) => ({ x: rect.x - 12, y: rect.y - 12, width: rect.width + 24, height: rect.height + 24 }));
    callOffer.setBounds(placePanel(area, { width, height }, anchor, avoid));
  }
  function publishCallHelp(state: CallHelpState) {
    if (isQuitting()) return;
    // Recheck after an asynchronous page load without mutating window reads.
    if (state.suggestion && state.suggestion.source !== 'preview' && !canPresent()) { dismiss(); return; }
    if (state.suggestion) {
      if (!callOffer || callOffer.isDestroyed()) {
        callOfferReady = false;
        callOffer = new BrowserWindow({ width: 360, height: 420, frame: false, show: false, transparent: true, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, type: 'panel', acceptFirstMouse: true, resizable: false, minimizable: false, maximizable: false, movable: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } });
        secureWindow(callOffer, 'call-help');
        callOffer.setAlwaysOnTop(true, 'pop-up-menu', 2);
        callOffer.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        callOffer.on('close', event => { if (!isQuitting()) { event.preventDefault(); dismiss(); } });
        void load(callOffer, 'call-help').then(() => { callOfferReady = true; publishCallHelp(getState()); });
      }
      positionCallHelp();
      if (callOfferReady) callOffer.showInactive();
    } else callOffer?.hide();
    for (const window of [getHome(), callOffer]) if (window && !window.isDestroyed()) window.webContents.send('helpos:call-help-state', state);
    syncEscape();
  }
  return {
    publish: publishCallHelp,
    isVisible: () => !!callOffer && !callOffer.isDestroyed() && callOffer.isVisible(),
    position: positionCallHelp,
    setScale(value: number) { if (callHelpScale === value) return; callHelpScale = value; callHelpHeight = null; positionCallHelp(); },
    setHeight(value: number) { const rounded = Math.ceil(value); if (callHelpHeight === rounded) return; callHelpHeight = rounded; positionCallHelp(); },
  };
}
export type CallHelpWindow = ReturnType<typeof createCallHelpWindow>;
