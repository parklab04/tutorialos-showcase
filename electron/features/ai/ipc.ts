import { ipcMain } from 'electron';
import { z } from 'zod';
import type { WindowSecurity } from '../../platform/security';
import { configureAI, askAI } from './ai';

export function registerAIIPC({ authorize }: WindowSecurity) {
  ipcMain.handle('helpos:ai-configure', (event, config) => { authorize(event, ['home']); return configureAI(config); });
  ipcMain.handle('helpos:ai-ask', (event, question) => { authorize(event, ['home']); return askAI(z.string().trim().min(1).max(2000).parse(question)); });
}
