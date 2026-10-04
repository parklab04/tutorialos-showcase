import { BrowserWindow, screen } from 'electron';
import type { GuidePointerState, LiveState } from '../../../src/features/live-guide/contracts';
import { guidePointerMode } from '../../../src/features/live-guide/contracts';
import { intersects, placeGuideBubble, placePanel } from '../../platform/placement';
import type { Rect } from '../../../src/shared/geometry';
import type { Renderer } from '../../platform/renderer';
import type { WindowSecurity } from '../../platform/security';
import { coachLayoutKey, CoachLayoutMeasurements, GuideFitHistory } from './fit-history';

interface Options {
  renderer: Renderer;
  security: WindowSecurity;
  isQuitting(): boolean;
  getState(): LiveState;
  getHome(): BrowserWindow | null;
  endGuide(): void;
  beforeShow(): void;
  syncEscape(): void;
}
export function createLiveGuideWindows({ renderer, security, isQuitting, getState, getHome, endGuide, beforeShow, syncEscape }: Options) {
  const { preload, load } = renderer;
  const { secureWindow } = security;
  let coach: BrowserWindow | null = null;
  let overlay: BrowserWindow | null = null;
  let coachScale = 1;
  let placementSession = '';
  let hasCoachPosition = false;
  let placementContext: Rect | undefined;
  let expandedCoach = false;
  let permissionRecovery = false;
  let presentationState: LiveState | null = null;
  let coachState: LiveState | null = null;
  let pointerTimer: ReturnType<typeof setInterval> | undefined;
  let pointerState: GuidePointerState | null = null;
  let lastPointer = '';
  let disposed = false;
  const fitHistory = new GuideFitHistory();
  const measurements = new CoachLayoutMeasurements();

  function stopPointer() {
    clearInterval(pointerTimer); pointerTimer = undefined;
    pointerState = null; lastPointer = '';
    if (overlay && !overlay.isDestroyed()) overlay.webContents.send('helpos:guide-pointer', null);
  }
  function updatePointer() {
    const state = presentationState;
    const mode = guidePointerMode(state);
    if (disposed || isQuitting() || !state || !mode || !overlay || overlay.isDestroyed() || overlay.webContents.isLoadingMainFrame()) {
      stopPointer(); return;
    }
    const cursor = screen.getCursorScreenPoint();
    const display = mode === 'pointing' && state.target ? screen.getDisplayMatching(state.target) : screen.getDisplayNearestPoint(cursor);
    const bounds = overlay.getBounds();
    if (bounds.x !== display.bounds.x || bounds.y !== display.bounds.y || bounds.width !== display.bounds.width || bounds.height !== display.bounds.height) overlay.setBounds(display.bounds);
    const next: GuidePointerState = {
      sessionId: state.sessionId, cursor, displayBounds: display.bounds, workArea: display.workArea,
      coachBounds: coach && !coach.isDestroyed() && coach.isVisible() ? coach.getBounds() : null,
    };
    const key = JSON.stringify(next);
    pointerState = next;
    if (key !== lastPointer) {
      lastPointer = key;
      overlay.webContents.send('helpos:guide-pointer', next);
    }
    if (!overlay.isVisible()) overlay.showInactive();
  }
  function syncPointer(state: LiveState) {
    presentationState = state;
    if (disposed || !guidePointerMode(state) || !overlay || overlay.isDestroyed() || overlay.webContents.isLoadingMainFrame()) {
      stopPointer(); overlay?.hide(); return;
    }
    updatePointer();
    // Read-only cursor position, scoped to this visible guide. Never record or
    // persist samples, and never move the OS pointer or dispatch target input.
    if (!pointerTimer) pointerTimer = setInterval(updatePointer, 50);
  }
  function overlayState(state: LiveState): LiveState {
    if (!overlay || overlay.isDestroyed()) return state;
    const { x, y } = overlay.getBounds();
    return { ...state, overlayOrigin: { x, y } };
  }

  function createGuidanceWindows() {
    if (coach && overlay) return;
    const common = { frame: false, show: false, transparent: true, hasShadow: false, skipTaskbar: true, alwaysOnTop: true, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, backgroundThrottling: false } };
    // Electron's frameless NSWindow override preserves requested menu-bar coordinates
    // only with this option; ordinary windows are constrained to the work area.
    overlay = new BrowserWindow({ ...common, ...screen.getPrimaryDisplay().bounds, enableLargerThanScreen: true, focusable: false, resizable: false, movable: false });
    secureWindow(overlay, 'overlay');
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.setAlwaysOnTop(true, 'pop-up-menu', 1);
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    const updateOverlayOrigin = () => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send('helpos:live-state', overlayState(presentationState ?? getState())); };
    overlay.on('move', updateOverlayOrigin);
    overlay.on('resize', updateOverlayOrigin);
    coach = new BrowserWindow({ ...common, width: 320, height: 200, type: 'panel', acceptFirstMouse: true, resizable: false, minimizable: false, maximizable: false, movable: false });
    secureWindow(coach, 'coach');
    // Keep the controls above the non-interactive cursor companion.
    coach.setAlwaysOnTop(true, 'pop-up-menu', 2);
    coach.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    coach.on('close', event => { if (!isQuitting()) { event.preventDefault(); endGuide(); } });
    void Promise.all([load(overlay, 'overlay'), load(coach, 'coach')]).then(() => publish(getState()));
  }
  function prepareCoach(state: LiveState) {
    if (placementSession !== state.sessionId) {
      placementSession = state.sessionId;
      hasCoachPosition = false;
      placementContext = undefined;
      expandedCoach = false;
      permissionRecovery = false;
      fitHistory.reset();
      measurements.reset();
    }
    if (state.status === 'permission') { expandedCoach = true; permissionRecovery = true; }
    else if (state.status === 'error') { expandedCoach = true; permissionRecovery = false; }
    else if (state.status === 'paused') expandedCoach = permissionRecovery;
    else { expandedCoach = false; permissionRecovery = false; }
    const observedTarget = state.status === 'guiding' ? state.target : null;
    const anchor = observedTarget ?? state.contextWindow;
    const sameContext = !state.contextWindow || !!placementContext &&
      ['x', 'y', 'width', 'height'].every(key => state.contextWindow![key as keyof Rect] === placementContext![key as keyof Rect]);
    // Controls must not chase the cursor while observation catches up. Retain
    // only this session's coach position; fresh context geometry still wins.
    const previous = !observedTarget && hasCoachPosition && sameContext ? coach!.getBounds() : null;
    if (state.contextWindow) placementContext = { ...state.contextWindow };
    const area = (anchor ? screen.getDisplayMatching(anchor) : previous ? screen.getDisplayMatching(previous) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
    const width = Math.max(1, Math.min(Math.round((expandedCoach ? 360 : 320) * coachScale), area.width - 32));
    const target = observedTarget ? { x: observedTarget.x - 12, y: observedTarget.y - 12, width: observedTarget.width + 24, height: observedTarget.height + 24 } : null;
    return { area, width, target, previous };
  }
  function layoutKey(state: LiveState, width: number): string {
    return coachLayoutKey(state, width, coachScale);
  }
  function positionCoach(state: LiveState, layout: ReturnType<typeof prepareCoach>, measuredHeight?: number, guidingHeight?: number, apply = true): boolean {
    if (!coach) return false;
    const { area, width, target, previous } = layout;
    // Content, not available space below the call, determines the height.
    // The renderer reports its natural no-scroll layout after each state change.
    const height = Math.max(1, Math.min(Math.ceil(measuredHeight ?? (expandedCoach ? 360 : 200) * coachScale), area.height - 32));
    const fitHeight = guidingHeight === undefined ? height : Math.max(1, Math.min(Math.ceil(guidingHeight), area.height - 32));
    const requiredHeight = fitHistory.requiredHeight({
      sessionId: state.sessionId, stepIndex: state.stepIndex, currentAction: state.currentAction,
      scale: coachScale, workArea: area, contextWindow: state.contextWindow ?? placementContext,
    }, target, fitHeight);
    const position = previous ? {
      x: Math.round(Math.max(area.x + 16, Math.min(previous.x, area.x + area.width - width - 16))),
      y: Math.round(Math.max(area.y + 16, Math.min(previous.y, area.y + area.height - height - 16))),
      width, height,
    } : (target ? placeGuideBubble(area, { width, height: requiredHeight }, target, 48 * coachScale) : null) ??
      placePanel(area, { width, height: requiredHeight }, state.contextWindow, target ? [target] : []);
    const fits = !target || !intersects(position, target);
    if (!fits && target && guidingHeight !== undefined) fitHistory.reject(requiredHeight);
    // Size the visible fallback to its own natural content, but do not mistake
    // that shorter layout for evidence that the full guiding bubble now fits.
    const visiblePosition = { ...position, height };
    if (apply) {
      const current = coach.getBounds();
      if (current.x !== visiblePosition.x || current.y !== visiblePosition.y || current.width !== visiblePosition.width || current.height !== visiblePosition.height) coach.setBounds(visiblePosition);
      hasCoachPosition = true;
    }
    return fits;
  }
  function publish(state: LiveState) {
    if (disposed) return;
    if (state.status === 'idle') {
      placementSession = ''; hasCoachPosition = false; placementContext = undefined; expandedCoach = false; permissionRecovery = false;
      fitHistory.reset(); measurements.reset(); coachState = state;
      presentationState = state; stopPointer();
      overlay?.hide(); coach?.hide(); syncEscape();
    } else if (!isQuitting()) {
      beforeShow();
      createGuidanceWindows();
      const layout = prepareCoach(state);
      const normalKey = layoutKey(state, layout.width);
      const normalHeight = measurements.height(normalKey);
      const measuring = !!layout.target && normalHeight === undefined;
      if (measuring) {
        // Render the actual guiding content internally before declaring that
        // it fits. The hidden coach may contain Complete; the public presenter
        // and IPC eligibility remain off until its current token is measured.
        coachState = { ...state, coachLayoutId: measurements.select(normalKey) };
        coach?.hide();
        positionCoach(state, layout);
        state = { ...state, status: 'observing', target: null, canComplete: false, canConfirm: false, title: 'Preparing guide', message: 'Checking room for help.' };
      } else {
        const fits = positionCoach(state, layout, normalHeight, layout.target ? normalHeight : undefined, false);
        if (!fits) {
          const original = state;
          state = { ...state, status: 'waiting-control', target: null, canComplete: false, canConfirm: false, title: 'Move the app window', message: 'Make room for help.' };
          // The fallback is allowed to shrink, but only the separately cached
          // guiding content height can qualify its original target again.
          positionCoach(original, layout, measurements.height(layoutKey(state, layout.width)), normalHeight);
        } else if (!layout.target && fitHistory.hasFailedFit() && ['observing', 'waiting-control'].includes(state.status)) {
          // Keep genuine disabled/missing-control reasons. Losing a target
          // does not restore completion suppressed by the preceding no-fit.
          state = { ...state, canComplete: false, canConfirm: false };
          positionCoach(state, layout, measurements.height(layoutKey(state, layout.width)));
        } else positionCoach(state, layout, normalHeight, layout.target ? normalHeight : undefined);
        coachState = { ...state, coachLayoutId: measurements.select(layoutKey(state, layout.width)) };
        if (coach && !coach.webContents.isLoadingMainFrame()) coach.showInactive();
      }
      if (measuring) { presentationState = state; stopPointer(); overlay?.hide(); }
      else syncPointer(state);
      syncEscape();
    }
    for (const window of [getHome(), coach, overlay]) if (window && !window.isDestroyed()) window.webContents.send('helpos:live-state', window === overlay ? overlayState(state) : window === coach ? coachState : state);
  }
  function setScale(value: number) {
    if (value === coachScale) return;
    coachScale = value;
    fitHistory.reset(); measurements.reset();
    publish(getState());
  }
  function setHeight(value: number, layoutId: string) {
    const rounded = Math.ceil(value);
    if (!measurements.accept(layoutId, rounded)) return;
    publish(getState());
  }
  function dispose() { disposed = true; presentationState = null; coachState = null; fitHistory.reset(); measurements.reset(); stopPointer(); overlay?.hide(); }
  return { publish, overlayState, getCoachState: () => structuredClone(coachState ?? presentationState ?? getState()), getPresentationState: () => structuredClone(presentationState ?? getState()), getOverlayState: () => overlayState(presentationState ?? getState()), setScale, setHeight, dispose, getPointerState: () => pointerState ? structuredClone(pointerState) : null, isVisible: () => !!coach && !coach.isDestroyed() && coach.isVisible() };
}
export type LiveGuideWindows = ReturnType<typeof createLiveGuideWindows>;
