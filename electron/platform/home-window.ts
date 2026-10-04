import { BrowserWindow, screen } from 'electron';
import type { Renderer } from './renderer';
import type { WindowSecurity } from './security';

export function createHomeWindow(renderer: Renderer, security: WindowSecurity, isQuitting: () => boolean) {
  const { preload, load } = renderer;
  const { secureWindow } = security;
  let home: BrowserWindow | null = null;
  let requestedVisible = false;
  let requestedFocus = false;
  let loaded = false;
  let navigation = 0;
  let loading: Promise<void> | null = null;
  const current = (window: BrowserWindow) => home === window && !window.isDestroyed();
  function reveal(window: BrowserWindow) {
    if (!current(window) || !loaded || !requestedVisible) return;
    if (requestedFocus) { window.show(); window.focus(); }
    else window.showInactive();
  }
  function hide() {
    requestedVisible = false; requestedFocus = false;
    if (home && !home.isDestroyed()) home.hide();
  }
  function createHome(showOnReady = true) {
    if (home && !home.isDestroyed()) return home;
    const area = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1180, area.width); const height = Math.min(760, area.height);
    const window = new BrowserWindow({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), minWidth: Math.min(760, area.width), minHeight: Math.min(620, area.height), show: false, backgroundColor: '#F7F6F2', title: 'HelpOS', webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
    home = window; requestedVisible = showOnReady; requestedFocus = false; loaded = false;
    const revision = ++navigation;
    secureWindow(window, 'home');
    window.on('close', event => {
      if (!isQuitting()) { event.preventDefault(); if (current(window)) hide(); else window.hide(); }
    });
    window.on('closed', () => {
      if (home !== window) return;
      home = null; requestedVisible = false; requestedFocus = false; loaded = false;
      loading = null; ++navigation;
    });
    loading = load(window, '').then(() => {
      if (!current(window) || navigation !== revision) return;
      loaded = true; reveal(window);
    });
    return window;
  }
  async function navigate(window: BrowserWindow, fragment: string | null) {
    const previous = loading;
    const revision = ++navigation;
    loaded = false;
    // Let an initial load finish before a deliberate replacement navigation.
    // Its stale completion cannot reveal this or a subsequently created window.
    const next = (async () => {
      await previous;
      if (!current(window) || navigation !== revision) return;
      if (fragment === null) {
        await new Promise<void>((resolve, reject) => {
          const contents = window.webContents;
          const clean = () => {
            contents.removeListener('did-finish-load', ready);
            contents.removeListener('did-fail-load', failed);
            window.removeListener('closed', ready);
          };
          const ready = () => { clean(); resolve(); };
          const failed = (_event: unknown, _code: number, description: string, _url: string, mainFrame: boolean) => {
            if (!mainFrame) return;
            clean(); reject(new Error(description));
          };
          contents.once('did-finish-load', ready);
          contents.on('did-fail-load', failed);
          window.once('closed', ready);
          window.reload();
        });
      } else await load(window, fragment);
      if (!current(window) || navigation !== revision) return;
      loaded = true; reveal(window);
    })();
    loading = next;
    await next;
  }
  function show(mode?: 'practice') {
    const window = createHome(false);
    requestedVisible = true; requestedFocus = true;
    if (mode === 'practice') {
      // Legacy mode requests return to the current live-only home.
      void navigate(window, null);
    } else reveal(window);
  }
  return { create: createHome, get: () => home, hide, show };
}
export type HomeWindow = ReturnType<typeof createHomeWindow>;
