import type { Rect } from '../../src/shared/geometry';

export const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const overlap = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// Keep the actionable companion bubble beside its current observed target.
// The caller supplies a padded target and reserves a triangle-sized gap. Do
// not clamp the primary axis across the target: flip sides or report no fit.
export function placeGuideBubble(area: Rect, size: { width: number; height: number }, target: Rect, gap = 48): Rect | null {
  const valid = (rect: Rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
  if (!valid(area) || !valid(target) || !valid({ x: 0, y: 0, ...size }) || !Number.isFinite(gap) || gap < 0) return null;
  const safe = { x: area.x + 16, y: area.y + 16, width: area.width - 32, height: area.height - 32 };
  if (size.width > safe.width || size.height > safe.height) return null;
  const clampX = (x: number) => Math.max(safe.x, Math.min(x, safe.x + safe.width - size.width));
  const clampY = (y: number) => Math.max(safe.y, Math.min(y, safe.y + safe.height - size.height));
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;
  const candidates: Rect[] = [
    { x: target.x + target.width + gap, y: clampY(centerY - size.height / 2), ...size },
    { x: target.x - gap - size.width, y: clampY(centerY - size.height / 2), ...size },
    { x: clampX(centerX - size.width / 2), y: target.y + target.height + gap, ...size },
    { x: clampX(centerX - size.width / 2), y: target.y - gap - size.height, ...size },
  ];
  return candidates.map(rect => ({ ...rect, x: Math.round(rect.x), y: Math.round(rect.y) })).find(rect =>
    rect.x >= safe.x && rect.y >= safe.y && rect.x + rect.width <= safe.x + safe.width &&
    rect.y + rect.height <= safe.y + safe.height && !intersects(rect, target)) ?? null;
}

// Prefer space outside the observed call window. If none fits, cover as little
// of the call as possible while keeping its actual controls clear.
export function placePanel(area: Rect, size: { width: number; height: number }, context?: Rect | null, avoid: Rect[] = []): Rect {
  const width = Math.max(1, Math.min(size.width, area.width - 32));
  const height = Math.max(1, Math.min(size.height, area.height - 32));
  const clamp = (x: number, y: number): Rect => ({
    x: Math.round(Math.max(area.x + 16, Math.min(x, area.x + area.width - width - 16))),
    y: Math.round(Math.max(area.y + 16, Math.min(y, area.y + area.height - height - 16))), width, height,
  });
  const candidates: Rect[] = [];
  if (context) {
    candidates.push(clamp(context.x + context.width + 18, context.y), clamp(context.x - width - 18, context.y),
      clamp(context.x + (context.width - width) / 2, context.y + context.height + 18),
      clamp(context.x + (context.width - width) / 2, context.y - height - 18));
  }
  for (const rect of avoid) {
    candidates.push(clamp(rect.x + rect.width + 18, rect.y), clamp(rect.x - width - 18, rect.y),
      clamp(rect.x, rect.y + rect.height + 18), clamp(rect.x, rect.y - height - 18));
  }
  candidates.push(clamp(area.x + area.width - width - 16, area.y + 16), clamp(area.x + 16, area.y + 16),
    clamp(area.x + area.width - width - 16, area.y + area.height - height - 16), clamp(area.x + 16, area.y + area.height - height - 16));
  const clear = candidates.filter(candidate => avoid.every(target => !intersects(candidate, target)));
  const choices = clear.length ? clear : candidates;
  return choices.reduce((best, candidate) => {
    const score = (rect: Rect) => avoid.reduce((sum, target) => sum + overlap(rect, target) * 100000, 0) + (context ? overlap(rect, context) : 0);
    return score(candidate) < score(best) ? candidate : best;
  });
}
