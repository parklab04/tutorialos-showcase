import { useEffect, useLayoutEffect, useState } from 'react';
import { guidePointerMode, type GuidePointerState, type LiveState } from './contracts';
import { companionArea, placeFollowingPointer, placeTargetPointer } from './pointer-layout';

function useGuidePointer(sessionId: string) {
  const [pointer, setPointer] = useState<GuidePointerState | null>(null);
  useEffect(() => {
    const bridge = window.helpOS;
    if (!bridge?.getGuidePointer || !bridge.onGuidePointer) return;
    let active = true; let received = false;
    setPointer(null);
    const accept = (next: GuidePointerState | null) => {
      if (active && (!next || next.sessionId === sessionId)) setPointer(next);
    };
    const off = bridge.onGuidePointer(next => {
      if (next && next.sessionId !== sessionId) return;
      received = true; accept(next);
    });
    void bridge.getGuidePointer().then(next => { if (!received) accept(next); }).catch(() => { if (!received) accept(null); });
    return () => { active = false; off(); };
  }, [sessionId]);
  return pointer?.sessionId === sessionId ? pointer : null;
}

export function PointerCompanion({ state, origin }: { state: LiveState; origin: { x: number; y: number } }) {
  const pointer = useGuidePointer(state.sessionId);
  const [scale, setScale] = useState(1);
  const mode = guidePointerMode(state);
  useLayoutEffect(() => {
    const measure = () => {
      setScale(Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16)));
    };
    const fontObserver = new MutationObserver(measure);
    fontObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    measure();
    return () => fontObserver.disconnect();
  }, []);
  if (!pointer || !mode) return null;
  // State and cursor feeds can arrive separately during a native display move.
  // Do not draw with coordinates belonging to the previous overlay display.
  const matchingOrigin = !state.overlayOrigin || (state.overlayOrigin.x === pointer.displayBounds.x && state.overlayOrigin.y === pointer.displayBounds.y);
  const area = matchingOrigin ? companionArea(pointer.displayBounds, pointer.workArea) : null;
  const layout = area ? mode === 'pointing' && state.target ? placeTargetPointer(state.target, pointer.coachBounds, area, scale) : placeFollowingPointer(pointer.cursor, pointer.coachBounds, area, scale) : null;
  const local = (rect: { x: number; y: number }) => ({ left: rect.x - origin.x, top: rect.y - origin.y });
  return <div className="pointer-companion" data-mode={mode} data-visible={!!layout} aria-hidden="true">
    {layout && <svg className="companion-pointer" viewBox="-16 -16 32 32" style={{ ...local(layout.pointer), width: layout.pointer.width, height: layout.pointer.height, transform: `rotate(${layout.rotation}deg)` }}>
      {/* Equilateral triangle port: Copyright (c) 2026 Farza, MIT. See third_party/clicky. */}
      <path d={`M 0 ${-24 * Math.sqrt(3) / 3} L -12 ${24 * Math.sqrt(3) / 6} L 12 ${24 * Math.sqrt(3) / 6} Z`} />
    </svg>}
  </div>;
}
