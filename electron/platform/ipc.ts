import { app, ipcMain, shell } from 'electron';
import path from 'node:path';
import { z } from 'zod';
import type { AppStatus } from '../../src/shared/bridge';
import { isAIConfigured } from '../features/ai/ai';
import { readNativePermission } from '../features/permissions/native';
import type { WindowSecurity } from './security';

interface Options { security: WindowSecurity; showHome(mode?: 'practice'): void }
export function registerAppIPC({ security: { authorize }, showHome }: Options) {
  async function status(): Promise<AppStatus> {
    const accessibility = readNativePermission('accessibility');
    const screenCapture = readNativePermission('screen');
    return { desktop: true, platform: process.platform, accessibility, screenCapture, aiConfigured: isAIConfigured(), version: app.getVersion() };
  }
  ipcMain.handle('helpos:status', event => { authorize(event); return status(); });
  ipcMain.handle('helpos:home', (event, mode) => { authorize(event); showHome(z.literal('practice').optional().parse(mode)); });
  ipcMain.handle('helpos:show-app', event => {
    authorize(event);
    // This fixed path reveals the running app; callers cannot choose other files.
    const item = app.isPackaged ? path.resolve(process.resourcesPath, '..', '..') : app.getAppPath();
    shell.showItemInFolder(item);
  });
}
