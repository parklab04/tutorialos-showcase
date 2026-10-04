export const voiceGoalIds = ['mute', 'unmute', 'camera-off', 'camera-on', 'zoom-in'] as const;
export type VoiceGoalId = typeof voiceGoalIds[number];
export interface VoiceGoal { id: VoiceGoalId; label: string; app: 'facetime' | 'safari' }
export type VoicePhase = 'idle' | 'requesting' | 'listening' | 'processing' | 'review' | 'error';
export interface VoiceState {
  phase: VoicePhase;
  transcript: string;
  message: string;
  goal: VoiceGoal | null;
  shortcut: string;
  shortcutAvailable: boolean;
}
export const initialVoiceState = (): VoiceState => ({
  phase: 'idle', transcript: '', message: '', goal: null,
  shortcut: 'Control+Option+Space', shortcutAvailable: false,
});
