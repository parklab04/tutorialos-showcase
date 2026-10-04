import { ipcMain } from 'electron';
import { z } from 'zod';
import { lessonIds } from '../../../src/features/lessons/types';
import type { HomeWindow } from '../../platform/home-window';
import type { WindowSecurity } from '../../platform/security';
import type { LiveEngine } from './live-engine';
import type { LiveGuideWindows } from './windows';

const lessonId = z.enum(lessonIds);
interface Options { security: WindowSecurity; engine: LiveEngine; windows: LiveGuideWindows; home: HomeWindow; endGuide?: () => void }
export function registerLiveGuideIPC({ security, engine, windows, home, endGuide = () => engine.stop() }: Options) {
  const { authorize } = security;
  ipcMain.handle('helpos:state', event => {
    authorize(event, ['home', 'coach', 'overlay']);
    const role = security.roleOf(event.sender.id);
    return role === 'overlay' ? windows.getOverlayState() : role === 'coach' ? windows.getCoachState() : engine.getState();
  });
  ipcMain.handle('helpos:guide-pointer', event => { authorize(event, ['overlay']); return windows.getPointerState(); });
  ipcMain.handle('helpos:start', (event, id) => { authorize(event, ['home']); const valid = lessonId.parse(id); home.hide(); return engine.start(valid); });
  ipcMain.handle('helpos:switch-lesson', (event, id) => { authorize(event, ['coach']); return engine.switchLesson(z.enum(['facetime-mic', 'facetime-camera', 'facetime-end']).parse(id)); });
  ipcMain.handle('helpos:stop', event => { authorize(event); endGuide(); });
  ipcMain.handle('helpos:pause', event => { authorize(event); engine.pause(); });
  ipcMain.handle('helpos:resume', event => { authorize(event); engine.resume(); });
  ipcMain.handle('helpos:retry', event => { authorize(event); engine.retry(); });
  ipcMain.handle('helpos:confirm', event => {
    authorize(event);
    const presented = windows.getPresentationState();
    if (presented.canConfirm && presented.sessionId === engine.getState().sessionId) engine.confirm();
  });
  ipcMain.handle('helpos:coach-height', (event, height, layoutId) => {
    authorize(event, ['coach']);
    windows.setHeight(z.number().finite().min(100).max(3000).parse(height), z.string().min(1).max(100).parse(layoutId));
  });
  ipcMain.handle('helpos:coach-scale', (event, scale) => {
    authorize(event, ['coach']);
    windows.setScale(z.number().min(1).max(2).parse(scale));
  });
}
