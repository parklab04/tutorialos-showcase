import { ipcMain } from 'electron';
import { z } from 'zod';
import { voiceGoalIds, type VoiceGoal } from '../../../src/features/voice-guide/contracts';
import type { LiveState } from '../../../src/features/live-guide/contracts';
import type { WindowSecurity } from '../../platform/security';
import type { LiveEngine } from '../live-guide/live-engine';
import type { VoiceController } from './controller';
import type { createVoiceWindow } from './window';
import { voiceGoal } from './intent';

export function registerVoiceIPC(options: {
  security: WindowSecurity; voice: VoiceController; window: ReturnType<typeof createVoiceWindow>;
  guide(goal: VoiceGoal): Promise<LiveState>; engine: LiveEngine;
  getPresentedState(): LiveState;
}) {
  const { security: { authorize }, voice, window, guide, engine } = options;
  ipcMain.handle('helpos:voice-state', event => { authorize(event, ['home', 'coach', 'voice']); return voice.getState(); });
  ipcMain.handle('helpos:voice-show', event => { authorize(event, ['home', 'coach', 'call-help']); voice.open(); });
  ipcMain.handle('helpos:voice-start', event => { authorize(event, ['home', 'voice']); return voice.start(); });
  ipcMain.handle('helpos:voice-stop', event => { authorize(event, ['home', 'voice']); return voice.stop(); });
  ipcMain.handle('helpos:voice-cancel', event => { authorize(event, ['home', 'voice']); return voice.cancel(); });
  ipcMain.handle('helpos:voice-text', (event, text) => { authorize(event, ['home', 'voice']); return voice.submit(z.string().trim().min(1).max(500).parse(text)); });
  ipcMain.handle('helpos:voice-use', event => { authorize(event, ['voice']); return voice.useGoal(); });
  ipcMain.handle('helpos:voice-height', (event, height) => { authorize(event, ['voice']); window.setHeight(z.number().finite().min(100).max(2200).parse(height)); });
  ipcMain.handle('helpos:voice-scale', (event, scale) => { authorize(event, ['voice']); window.setScale(z.number().finite().min(1).max(2).parse(scale)); });
  ipcMain.handle('helpos:goal-start', (event, id) => { authorize(event, ['home', 'coach']); return guide(voiceGoal(z.enum(voiceGoalIds).parse(id))); });
  ipcMain.handle('helpos:goal-complete', event => {
    authorize(event, ['coach']);
    const presented = options.getPresentedState();
    if (!presented.canComplete || presented.sessionId !== engine.getState().sessionId) return;
    engine.completeGoal();
    // Complete is the user's acknowledgement, never an AI/observed-success claim.
    if (engine.getState().status === 'complete' && engine.getState().verification === 'self-confirmed') engine.stop();
  });
}
