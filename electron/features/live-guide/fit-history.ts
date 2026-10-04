import type { Rect } from '../../../src/shared/geometry';
import type { LiveState } from '../../../src/features/live-guide/contracts';

interface FitContext {
  sessionId: string;
  stepIndex: number;
  currentAction?: string;
  scale: number;
  workArea: Rect;
  contextWindow?: Rect;
}
const rectangleKey = (rect: Rect | undefined) => rect ? [rect.x, rect.y, rect.width, rect.height] : null;

export function coachLayoutKey(state: LiveState, width: number, scale: number): string {
  return JSON.stringify([state.sessionId, state.status, state.stepIndex, state.currentAction,
    state.title, state.message, state.why, state.goal, state.completionMode, state.canComplete, state.canConfirm,
    state.verification, state.permission.accessibility, state.permission.screenCapture, !!state.target, scale, width]);
}

// A no-space fallback hides controls and therefore measures shorter than the
// guiding bubble. Its height must not immediately qualify the same target,
// restore the controls, grow, and fail again. Retain only the required fit
// height, never a target to display or any completion evidence.
export class GuideFitHistory {
  private frameKey = '';
  private targetKey = '';
  private failedHeight = 0;

  reset() { this.frameKey = ''; this.targetKey = ''; this.failedHeight = 0; }
  hasFailedFit() { return this.failedHeight > 0; }

  requiredHeight(context: FitContext, target: Rect | null, measuredHeight: number): number {
    const frameKey = JSON.stringify([context.sessionId, context.stepIndex, context.currentAction,
      context.scale, rectangleKey(context.workArea), rectangleKey(context.contextWindow)]);
    if (frameKey !== this.frameKey) {
      this.reset();
      this.frameKey = frameKey;
    }
    // A transient missing target does not prove that the failed geometry has
    // changed. The caller retains the last known context only for positioning.
    if (!target) return measuredHeight;
    const targetKey = JSON.stringify(rectangleKey(target));
    if (targetKey !== this.targetKey) {
      this.targetKey = targetKey;
      this.failedHeight = 0;
    }
    return Math.max(measuredHeight, this.failedHeight);
  }

  reject(requiredHeight: number) {
    if (this.targetKey) this.failedHeight = Math.max(this.failedHeight, requiredHeight);
  }
}

// Tokens belong to the rendered content, not a native window's previous size.
// A delayed permission/fallback measurement cannot become a guiding height.
export class CoachLayoutMeasurements {
  private heights = new Map<string, number>();
  private current: { key: string; id: string } | null = null;
  private revision = 0;

  reset() { this.heights.clear(); this.current = null; }
  height(key: string) { return this.heights.get(key); }
  select(key: string): string {
    if (this.current?.key !== key) this.current = { key, id: `coach-layout-${++this.revision}` };
    return this.current.id;
  }
  accept(id: string, height: number): boolean {
    if (id !== this.current?.id || !Number.isFinite(height) || height <= 0 || this.heights.get(this.current.key) === height) return false;
    this.heights.set(this.current.key, height);
    return true;
  }
}
