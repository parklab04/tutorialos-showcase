import { app, type BrowserWindow } from 'electron';
import path from 'node:path';

// Main and preload remain the build entrypoints. Every app window loads this
// same renderer, with a hash selecting its feature surface.
export function createRenderer(preload: string) {
  const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
  const developmentURL = !app.isPackaged && process.env.HELPOS_DEV_URL?.startsWith('http://127.0.0.1:') ? process.env.HELPOS_DEV_URL : null;
  function ownPage(url: string): boolean {
    try {
      const parsed = new URL(url);
      return developmentURL ? parsed.origin === new URL(developmentURL).origin : parsed.protocol === 'file:' && decodeURIComponent(parsed.pathname) === indexPath;
    } catch { return false; }
  }
  async function load(window: BrowserWindow, hash: string) {
    if (developmentURL) await window.loadURL(`${developmentURL.replace(/\/$/, '')}/#${hash}`);
    else await window.loadFile(indexPath, { hash });
  }
  return { preload, ownPage, load };
}
export type Renderer = ReturnType<typeof createRenderer>;
