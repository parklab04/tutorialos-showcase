import { ipcMain } from 'electron';
import { z } from 'zod';
import type { WindowSecurity } from '../../platform/security';
import type { LiveEngine } from '../live-guide/live-engine';
import type { createNativePermissionRequester } from './native';

interface Options { security: WindowSecurity; engine: LiveEngine; requestPermission: ReturnType<typeof createNativePermissionRequester> }
export function registerPermissionIPC({ security: { authorize }, engine, requestPermission }: Options) {
  ipcMain.handle('helpos:permission', async (event, kind) => {
    authorize(event);
    const permission = z.enum(['accessibility', 'screen']).parse(kind);
    if (engine.getState().status !== 'idle') engine.pause('permission');
    return requestPermission(permission);
  });
}
