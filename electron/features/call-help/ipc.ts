import { ipcMain } from 'electron';
import { z } from 'zod';
import type { HomeWindow } from '../../platform/home-window';
import type { WindowSecurity } from '../../platform/security';
import type { LiveEngine } from '../live-guide/live-engine';
import type { AppHelpController } from '../app-help/controller';
import { lessons } from '../../../src/features/lessons/catalog';
import { lessonIds } from '../../../src/features/lessons/types';
import type { createAppHelpService } from '../app-help/service';
import type { CallHelpWindow } from './window';

interface Options {
  security: WindowSecurity;
  callHelp: AppHelpController;
  preferences: ReturnType<typeof createAppHelpService>;
  window: CallHelpWindow;
  engine: LiveEngine;
  home: HomeWindow;
}
export function registerCallHelpIPC({ security: { authorize }, callHelp, preferences, window, engine, home }: Options) {
  ipcMain.handle('helpos:call-help-state', event => { authorize(event, ['home', 'call-help']); return preferences.refresh(); });
  ipcMain.handle('helpos:call-help-enabled', (event, enabled) => { authorize(event, ['home', 'call-help']); return preferences.set(z.boolean().parse(enabled)); });
  ipcMain.handle('helpos:call-help-preview', (event, app) => {
    authorize(event, ['home']);
    engine.stop();
    callHelp.preview(z.enum(['facetime', 'safari', 'finder']).default('facetime').parse(app));
  });
  ipcMain.handle('helpos:call-help-dismiss', event => { authorize(event, ['home', 'call-help']); callHelp.dismiss(); });
  ipcMain.handle('helpos:call-help-height', (event, height) => { authorize(event, ['call-help']); window.setHeight(z.number().finite().min(100).max(3000).parse(height)); });
  ipcMain.handle('helpos:call-help-scale', (event, scale) => {
    authorize(event, ['call-help']);
    window.setScale(z.number().min(1).max(2).parse(scale));
  });
  ipcMain.handle('helpos:call-help-choose', async (event, id) => {
    authorize(event, ['call-help']);
    const valid = z.enum(lessonIds).parse(id);
    const suggestion = callHelp.getState().suggestion;
    if (!suggestion) throw new Error('This offer has closed. Open a guide from HelpOS.');
    if (lessons.find(lesson => lesson.id === valid)?.app !== (suggestion.app ?? 'facetime')) throw new Error('Choose a guide for the offered app.');
    callHelp.dismiss();
    if (suggestion.source === 'preview') {
      engine.stop();
      home.show();
    } else { home.hide(); engine.start(valid); }
  });
}
