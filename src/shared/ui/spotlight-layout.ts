import type { Rect } from '../geometry';

export const spotlightPadding = 6;
export interface CoachPlacement extends Rect { side: 'left' | 'right' | 'above' | 'below'; arrow: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function placeCoach(target: Rect, viewport: { width: number; height: number }, preferredHeight: number, preferAbove = false, preferredWidth = 360): CoachPlacement | null {
  const margin = 16; const gap = 22;
  const width = Math.min(preferredWidth, viewport.width - margin * 2);
  const height = Math.min(preferredHeight, 440, viewport.height - margin * 2);
  const centerX = target.x + target.width / 2; const centerY = target.y + target.height / 2;
  const hole = { x: target.x - spotlightPadding, y: target.y - spotlightPadding, width: target.width + spotlightPadding * 2, height: target.height + spotlightPadding * 2 };
  const candidates: CoachPlacement[] = [
    { x: target.x + target.width + gap, y: centerY - height / 2, width, height, side: 'right', arrow: 0 },
    { x: target.x - gap - width, y: centerY - height / 2, width, height, side: 'left', arrow: 0 },
    { x: centerX - width / 2, y: target.y - gap - height, width, height, side: 'above', arrow: 0 },
    { x: centerX - width / 2, y: target.y + target.height + gap, width, height, side: 'below', arrow: 0 },
  ];
  if (preferAbove) candidates.unshift(...candidates.splice(2, 1));
  for (const candidate of candidates) {
    if (candidate.side === 'left' || candidate.side === 'right') candidate.y = clamp(candidate.y, margin, viewport.height - margin - height);
    else candidate.x = clamp(candidate.x, margin, viewport.width - margin - width);
    if (candidate.x < margin || candidate.y < margin || candidate.x + width > viewport.width - margin || candidate.y + height > viewport.height - margin || overlaps(candidate, hole)) continue;
    candidate.arrow = candidate.side === 'left' || candidate.side === 'right' ? clamp(centerY - candidate.y, 24, height - 24) : clamp(centerX - candidate.x, 24, width - 24);
    return candidate;
  }
  // A short instruction viewport keeps the target and exit controls apart on a small screen.
  if (height > 260) return placeCoach(target, viewport, Math.max(260, height - 60), preferAbove, preferredWidth);
  return null;
}
