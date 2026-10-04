import type { LessonId, Verification } from '../lessons/types';
import type { Rect } from '../../shared/geometry';
import type { VoiceGoal } from '../voice-guide/contracts';

export type ControlVisibility = Record<'microphone' | 'camera' | 'end', 'visible' | 'covered' | 'missing'>;

export interface Observation {
  trusted: boolean; screenCapture: boolean; frontmostBundleId: string; frontmostName: string;
  timestamp: number; source: 'accessibility' | 'ocr' | 'none';
  window: Rect | null;
  windowId?: string;
  observedBundleId?: string;
  occluded?: boolean;
  controlVisibility?: ControlVisibility;
  elements: ObservedElement[];
}
export interface ObservedElement {
  id: string; role: string; label: string; value?: string; enabled: boolean; rect: Rect;
  selected?: boolean; scope?: 'bookmark-sheet';
  nativeIdentifier?: 'toggleVideoButton' | 'toggleMicMenuButton';
  subrole?: 'AXSwitch';
}
export type LiveStatus = 'idle' | 'observing' | 'guiding' | 'waiting-app' | 'waiting-control' | 'permission' | 'paused' | 'complete' | 'error';
// Ephemeral display coordinates only; emitted while a guide companion is visible.
// All values use Electron global DIP coordinates, including negative display origins.
export interface GuidePointerState {
  sessionId: string;
  cursor: { x: number; y: number };
  displayBounds: Rect;
  workArea: Rect;
  coachBounds: Rect | null;
}
export interface LiveState {
  sessionId: string; lessonId: LessonId | null; status: LiveStatus; stepIndex: number;
  title: string; message: string; why: string; target: Rect | null;
  observationSource: Observation['source']; verification: Verification;
  canConfirm?: boolean;
  goal?: VoiceGoal;
  canComplete?: boolean;
  completionMode?: 'manual';
  overlayOrigin?: { x: number; y: number };
  // Ephemeral native presentation identity; used only to match layout measurements.
  coachLayoutId?: string;
  contextWindow?: Rect;
  currentAction?: string;
  permission: { accessibility: boolean; screenCapture: boolean };
}

// Shared, side-effect-free presentation eligibility. This is not target detection.
export function guidePointerMode(state: LiveState | null): 'pointing' | 'following' | null {
  const finiteRect = (rect: Rect | null | undefined) => !!rect &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  if (!state?.sessionId || state.canConfirm) return null;
  if (state.status === 'guiding' && finiteRect(state.target)) return 'pointing';
  if (state.canComplete && state.message === 'No click needed. Choose Complete.') return null;
  if (state.message === 'Make room for help.' || ['Zoom In is unavailable', 'Reader is not available here', 'No closed tab to reopen', 'Reader is already on'].includes(state.title)) return null;
  if (['observing', 'waiting-control'].includes(state.status) && finiteRect(state.contextWindow) &&
      (state.permission.accessibility || state.permission.screenCapture)) return 'following';
  return null;
}
