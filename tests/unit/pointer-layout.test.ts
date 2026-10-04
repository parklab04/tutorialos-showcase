import assert from 'node:assert/strict';
import test from 'node:test';
import { companionArea, placeFollowingPointer, placeTargetPointer, type PointerLayout } from '../../src/features/live-guide/pointer-layout';
import type { Rect } from '../../src/shared/geometry';

const area = { x: 0, y: 25, width: 1280, height: 750 };
const coach = { x: 950, y: 500, width: 320, height: 180 };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
function safe(result: PointerLayout | null, bounds = area, obstacles: Rect[] = []) {
  assert.ok(result);
  const rect = result.pointer;
  assert.ok(rect.x >= bounds.x && rect.y >= bounds.y && rect.x + rect.width <= bounds.x + bounds.width && rect.y + rect.height <= bounds.y + bounds.height);
  for (const obstacle of obstacles) assert.equal(overlaps(rect, obstacle), false);
  return result;
}

test('pointer connects the observed target to the actual coach side', () => {
  const target = { x: 400, y: 300, width: 50, height: 35 };
  const rightCoach = { x: 510, y: 240, width: 320, height: 180 };
  const leftCoach = { x: 20, y: 240, width: 320, height: 180 };
  assert.equal(safe(placeTargetPointer(target, rightCoach, area, 1), area, [target, rightCoach]).rotation, -90);
  assert.equal(safe(placeTargetPointer(target, leftCoach, area, 1), area, [target, leftCoach]).rotation, 90);
});

test('menu-bar target uses the below-target gap instead of clipping at work-area edge', () => {
  const target = { x: 230, y: 0, width: 50, height: 25 };
  const bubble = { x: 95, y: 85, width: 320, height: 145 };
  const result = safe(placeTargetPointer(target, bubble, area, 1), area, [target, bubble]);
  assert.equal(result.rotation, 0);
  assert.ok(result.pointer.y + result.pointer.height <= bubble.y);
});

test('right edge pointer flips left with the native compact coach', () => {
  const target = { x: 1190, y: 300, width: 50, height: 35 };
  const bubble = { x: 810, y: 240, width: 320, height: 180 };
  assert.equal(safe(placeTargetPointer(target, bubble, area, 1), area, [target, bubble]).rotation, 90);
});

test('negative display origins and 200 percent pointer keep global DIP', () => {
  const negativeArea = { x: -1440, y: -180, width: 1440, height: 850 };
  const target = { x: -1250, y: -100, width: 48, height: 30 };
  const bubble = { x: -1094, y: -140, width: 640, height: 280 };
  const result = safe(placeTargetPointer(target, bubble, negativeArea, 2), negativeArea, [target, bubble]);
  assert.equal(result.pointer.width, 64);
  assert.equal(result.rotation, -90);
  assert.ok(result.pointer.x < 0);
});

test('following applies Clicky offset without moving the system pointer', () => {
  const cursor = { x: 300, y: 200 };
  const result = safe(placeFollowingPointer(cursor, coach, area, 1), area, [coach]);
  assert.equal(result.pointer.x + result.pointer.width / 2, 335);
  assert.equal(result.pointer.y + result.pointer.height / 2, 225);
  assert.deepEqual(cursor, { x: 300, y: 200 });
});

test('following flips at an edge and stays clear of the stable clickable coach', () => {
  const cursor = { x: 1260, y: 200 };
  assert.ok(safe(placeFollowingPointer(cursor, coach, area, 1)).pointer.x < cursor.x);
  const closeCoach = { x: 350, y: 150, width: 320, height: 180 };
  safe(placeFollowingPointer({ x: 325, y: 220 }, closeCoach, area, 1), area, [closeCoach]);
});

test('following remains visible and clear of learner cursor at 200 percent', () => {
  const cursor = { x: 300, y: 200 };
  const result = safe(placeFollowingPointer(cursor, coach, area, 2), area, [{ x: 293, y: 193, width: 14, height: 14 }]);
  assert.equal(result.pointer.x + result.pointer.width / 2, 370);
  assert.equal(result.pointer.y + result.pointer.height / 2, 250);
});

test('missing coach or insufficient room omits decorative pointer', () => {
  const target = { x: 35, y: 40, width: 50, height: 35 };
  assert.equal(placeTargetPointer(target, null, area, 1), null);
  assert.equal(placeTargetPointer(target, area, area, 1), null);
  assert.equal(placeFollowingPointer({ x: 50, y: 60 }, area, area, 1), null);
});

test('invalid geometry and off-display cursors are rejected', () => {
  for (const target of [{ x: NaN, y: 3, width: 50, height: 20 }, { x: 0, y: 3, width: 0, height: 20 }]) assert.equal(placeTargetPointer(target, coach, area, 1), null);
  assert.equal(placeFollowingPointer({ x: 1281, y: 100 }, coach, area, 1), null);
  assert.equal(placeFollowingPointer({ x: 200, y: Infinity }, coach, area, 1), null);
  assert.equal(placeFollowingPointer({ x: 200, y: 100 }, coach, area, NaN), null);
});

test('work area intersects the display and rejects empty intersections', () => {
  assert.deepEqual(companionArea({ x: -1440, y: 0, width: 1440, height: 900 }, { x: -1440, y: 30, width: 1440, height: 830 }), { x: -1440, y: 30, width: 1440, height: 830 });
  assert.equal(companionArea(area, { x: 1500, y: 0, width: 400, height: 400 }), null);
});

test('grid of edge targets is either clear at both scales or safely omitted', () => {
  let placed = 0;
  for (const scale of [1, 2]) for (const x of [0, 15, 200, 600, 1050, 1230]) for (const y of [0, 25, 50, 400, 720]) {
    const target = { x, y, width: 45, height: 30 };
    const result = placeTargetPointer(target, coach, area, scale);
    if (result) { safe(result, area, [target, coach]); placed++; }
  }
  assert.ok(placed > 25);
});
