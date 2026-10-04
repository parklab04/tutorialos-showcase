import { contextBridge, ipcRenderer } from 'electron';
import type { AIConfig } from '../src/features/ai/contracts';
import type { CallHelpState } from '../src/features/call-help/contracts';
import type { LessonId } from '../src/features/lessons/types';
import type { GuidePointerState, LiveState } from '../src/features/live-guide/contracts';
import type { HelpOSBridge } from '../src/shared/bridge';
import type { VoiceState } from '../src/features/voice-guide/contracts';

const bridge: HelpOSBridge = {
  getVoiceState: () => ipcRenderer.invoke('helpos:voice-state'),
  showVoice: () => ipcRenderer.invoke('helpos:voice-show'),
  startVoice: () => ipcRenderer.invoke('helpos:voice-start'),
  stopVoice: () => ipcRenderer.invoke('helpos:voice-stop'),
  cancelVoice: () => ipcRenderer.invoke('helpos:voice-cancel'),
  submitVoiceText: text => ipcRenderer.invoke('helpos:voice-text', text),
  useVoiceGoal: () => ipcRenderer.invoke('helpos:voice-use'),
  reportVoiceHeight: height => ipcRenderer.invoke('helpos:voice-height', height),
  reportVoiceScale: scale => ipcRenderer.invoke('helpos:voice-scale', scale),
  startGoal: id => ipcRenderer.invoke('helpos:goal-start', id),
  completeGoal: () => ipcRenderer.invoke('helpos:goal-complete'),
  onVoiceState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: VoiceState) => callback(state);
    ipcRenderer.on('helpos:voice-state', listener);
    return () => ipcRenderer.removeListener('helpos:voice-state', listener);
  },
  getCallHelpState: () => ipcRenderer.invoke('helpos:call-help-state'),
  setCallHelpEnabled: enabled => ipcRenderer.invoke('helpos:call-help-enabled', enabled),
  previewCallHelp: app => ipcRenderer.invoke('helpos:call-help-preview', app),
  dismissCallHelp: () => ipcRenderer.invoke('helpos:call-help-dismiss'),
  chooseCallHelpLesson: id => ipcRenderer.invoke('helpos:call-help-choose', id),
  reportCallHelpScale: scale => ipcRenderer.invoke('helpos:call-help-scale', scale),
  reportCallHelpHeight: height => ipcRenderer.invoke('helpos:call-help-height', height),
  onCallHelpState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: CallHelpState) => callback(state);
    ipcRenderer.on('helpos:call-help-state', listener);
    return () => ipcRenderer.removeListener('helpos:call-help-state', listener);
  },
  getStatus: () => ipcRenderer.invoke('helpos:status'),
  startLive: (lessonId: LessonId) => ipcRenderer.invoke('helpos:start', lessonId),
  switchLiveLesson: id => ipcRenderer.invoke('helpos:switch-lesson', id),
  stopLive: () => ipcRenderer.invoke('helpos:stop'),
  pauseLive: () => ipcRenderer.invoke('helpos:pause'),
  resumeLive: () => ipcRenderer.invoke('helpos:resume'),
  retryLive: () => ipcRenderer.invoke('helpos:retry'),
  confirmLive: () => ipcRenderer.invoke('helpos:confirm'),
  reportCoachScale: scale => ipcRenderer.invoke('helpos:coach-scale', scale),
  reportCoachHeight: (height, coachLayoutId) => ipcRenderer.invoke('helpos:coach-height', height, coachLayoutId),
  showHome: mode => ipcRenderer.invoke('helpos:home', mode),
  requestPermission: kind => ipcRenderer.invoke('helpos:permission', kind),
  showAppInFinder: () => ipcRenderer.invoke('helpos:show-app'),
  getLiveState: () => ipcRenderer.invoke('helpos:state'),
  getGuidePointer: () => ipcRenderer.invoke('helpos:guide-pointer'),
  onGuidePointer: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: GuidePointerState | null) => callback(state);
    ipcRenderer.on('helpos:guide-pointer', listener);
    return () => ipcRenderer.removeListener('helpos:guide-pointer', listener);
  },
  onLiveState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: LiveState) => callback(state);
    ipcRenderer.on('helpos:live-state', listener);
    return () => ipcRenderer.removeListener('helpos:live-state', listener);
  },
  configureAI: (config: AIConfig) => ipcRenderer.invoke('helpos:ai-configure', config),
  askAI: question => ipcRenderer.invoke('helpos:ai-ask', question),
};
contextBridge.exposeInMainWorld('helpOS', bridge);
