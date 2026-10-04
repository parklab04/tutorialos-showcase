import type { LessonId } from '../features/lessons/types';
import type { GuidePointerState, LiveState } from '../features/live-guide/contracts';
import type { PermissionKind, PermissionRequestResult } from '../features/permissions/contracts';
import type { AIConfig, AIAnswer } from '../features/ai/contracts';
import type { CallHelpState, SupportedApp } from '../features/call-help/contracts';
import type { VoiceState, VoiceGoalId } from '../features/voice-guide/contracts';

export interface AppStatus { desktop: boolean; platform: string; accessibility: boolean; screenCapture: boolean; aiConfigured: boolean; version: string }
export interface HelpOSBridge {
  getVoiceState(): Promise<VoiceState>;
  onVoiceState(callback: (state: VoiceState) => void): () => void;
  showVoice(): Promise<void>;
  startVoice(): Promise<VoiceState>;
  stopVoice(): Promise<VoiceState>;
  cancelVoice(): Promise<VoiceState>;
  submitVoiceText(text: string): Promise<VoiceState>;
  useVoiceGoal(): Promise<void>;
  reportVoiceHeight(height: number): Promise<void>;
  reportVoiceScale(scale: number): Promise<void>;
  startGoal(id: VoiceGoalId): Promise<LiveState>;
  completeGoal(): Promise<void>;
  getCallHelpState(): Promise<CallHelpState>;
  setCallHelpEnabled(enabled: boolean): Promise<CallHelpState>;
  previewCallHelp(app?: SupportedApp): Promise<void>;
  dismissCallHelp(): Promise<void>;
  chooseCallHelpLesson(lessonId: LessonId): Promise<void>;
  onCallHelpState(callback: (state: CallHelpState) => void): () => void;
  reportCallHelpScale(scale: number): Promise<void>;
  reportCallHelpHeight(height: number): Promise<void>;
  getStatus(): Promise<AppStatus>;
  startLive(lessonId: LessonId): Promise<LiveState>;
  switchLiveLesson(lessonId: LessonId): Promise<LiveState>;
  stopLive(): Promise<void>;
  pauseLive(): Promise<void>;
  resumeLive(): Promise<void>;
  retryLive(): Promise<void>;
  confirmLive(): Promise<void>;
  reportCoachScale(scale: number): Promise<void>;
  reportCoachHeight(height: number, coachLayoutId?: string): Promise<void>;
  showHome(mode?: 'practice'): Promise<void>;
  requestPermission(kind: PermissionKind): Promise<PermissionRequestResult>;
  showAppInFinder(): Promise<void>;
  onLiveState(callback: (state: LiveState) => void): () => void;
  getLiveState(): Promise<LiveState>;
  getGuidePointer(): Promise<GuidePointerState | null>;
  onGuidePointer(callback: (state: GuidePointerState | null) => void): () => void;
  configureAI(config: AIConfig): Promise<{ configured: boolean }>;
  askAI(question: string): Promise<AIAnswer>;
}
declare global { interface Window { helpOS?: HelpOSBridge } }
