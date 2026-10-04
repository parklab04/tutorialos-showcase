import type { Rect } from '../../shared/geometry';

type Point = { x: number; y: number };
export interface PointerLayout { pointer: Rect; rotation: number }
const finiteRect = (rect: Rect) => [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const within = (rect: Rect, area: Rect) => rect.x >= area.x && rect.y >= area.y && rect.x + rect.width <= area.x + area.width && rect.y + rect.height <= area.y + area.height;
const inset = (rect: Rect, padding: number): Rect => ({ x: rect.x + padding, y: rect.y + padding, width: rect.width - padding * 2, height: rect.height - padding * 2 });

export function companionArea(display: Rect, workArea: Rect): Rect | null {
  if (!finiteRect(display) || !finiteRect(workArea)) return null;
  const x = Math.max(display.x, workArea.x); const y = Math.max(display.y, workArea.y);
  const area = { x, y, width: Math.min(display.x + display.width, workArea.x + workArea.width) - x, height: Math.min(display.y + display.height, workArea.y + workArea.height) - y };
  return finiteRect(area) ? area : null;
}

function prepared(area: Rect, coach: Rect | null, scale: number) {
  if (!finiteRect(area) || !coach || !finiteRect(coach) || !Number.isFinite(scale) || scale < 1 || scale > 2) return null;
  const safe = inset(area, 8);
  // The side-24 triangle plus stroke fits a radius14.606 circle in viewBox32.
  // This square therefore contains the painted pointer at every rotation.
  return finiteRect(safe) ? { safe, blocked: inset(coach, -6), size: 32 * scale, gap: 8 * scale } : null;
}

// Target anchoring adapts Clicky's navigation pointer. The native compact coach
// is now the only speech bubble; its actual bounds decide the pointer's side.
// Copyright (c) 2026 Farza. MIT; see third_party/clicky/LICENSE and NOTICE.md.
export function placeTargetPointer(target: Rect, coach: Rect | null, area: Rect, scale: number): PointerLayout | null {
  const setup = prepared(area, coach, scale);
  if (!setup || !finiteRect(target) || !coach) return null;
  const { safe, blocked, size, gap } = setup;
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const padded = inset(target, -10);
  const candidates: PointerLayout[] = [
    { pointer: { x: padded.x + padded.width + gap, y: center.y - size / 2, width: size, height: size }, rotation: -90 },
    { pointer: { x: padded.x - gap - size, y: center.y - size / 2, width: size, height: size }, rotation: 90 },
    { pointer: { x: center.x - size / 2, y: padded.y + padded.height + gap, width: size, height: size }, rotation: 0 },
    { pointer: { x: center.x - size / 2, y: padded.y - gap - size, width: size, height: size }, rotation: 180 },
  ];
  const distanceToCoach = ({ pointer }: PointerLayout) => {
    const x = pointer.x + pointer.width / 2; const y = pointer.y + pointer.height / 2;
    return Math.hypot(Math.max(coach.x - x, 0, x - coach.x - coach.width), Math.max(coach.y - y, 0, y - coach.y - coach.height));
  };
  return candidates.sort((a, b) => distanceToCoach(a) - distanceToCoach(b))
    .find(({ pointer }) => within(pointer, safe) && !overlaps(pointer, blocked) && !overlaps(pointer, padded)) ?? null;
}

export function placeFollowingPointer(cursor: Point, coach: Rect | null, area: Rect, scale: number): PointerLayout | null {
  const setup = prepared(area, coach, scale);
  if (!setup || ![cursor.x, cursor.y].every(Number.isFinite) || !within({ ...cursor, width: .01, height: .01 }, area)) return null;
  const { safe, blocked, size } = setup;
  // Clicky's +35/+25 offset, scaled for readability. Global DIP already uses a
  // top-left origin, so the original AppKit Y conversion is not needed here.
  // Copyright (c) 2026 Farza. MIT; see third_party/clicky/LICENSE and NOTICE.md.
  for (const horizontal of [1, -1]) for (const vertical of [1, -1]) {
    const center = { x: cursor.x + horizontal * 35 * scale, y: cursor.y + vertical * 25 * scale };
    const pointer = { x: center.x - size / 2, y: center.y - size / 2, width: size, height: size };
    if (within(pointer, safe) && !overlaps(pointer, blocked) && !overlaps(pointer, { x: cursor.x - 7, y: cursor.y - 7, width: 14, height: 14 })) {
      return { pointer, rotation: Math.atan2(cursor.y - center.y, cursor.x - center.x) * 180 / Math.PI + 90 };
    }
  }
  return null;
}
