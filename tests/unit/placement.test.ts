import test from 'node:test';
import assert from 'node:assert/strict';
import { intersects, placeGuideBubble, placePanel } from '../../electron/platform/placement';

test('call help uses free space beside the call instead of covering video', () => {
  const area = { x: 0, y: 25, width: 1600, height: 1000 };
  const call = { x: 60, y: 80, width: 800, height: 600 };
  const panel = placePanel(area, { width: 360, height: 420 }, call);
  assert.equal(intersects(panel, call), false);
  assert.ok(panel.x >= area.x && panel.x + panel.width <= area.x + area.width);
});

test('near-fullscreen calls keep the actual target clear when no outside panel fits', () => {
  const area = { x: 0, y: 25, width: 1050, height: 850 };
  const call = { x: 40, y: 60, width: 970, height: 760 };
  const target = { x: 200, y: 710, width: 80, height: 80 };
  const panel = placePanel(area, { width: 360, height: 340 }, call, [target]);
  assert.equal(intersects(panel, target), false);
  assert.ok(panel.y >= area.y && panel.y + panel.height <= area.y + area.height);
});

test('placement respects negative display coordinates and bounds large text panels', () => {
  const area = { x: -1100, y: 50, width: 1000, height: 650 };
  const panel = placePanel(area, { width: 720, height: 840 }, { x: -1000, y: 100, width: 850, height: 500 });
  assert.ok(panel.x >= area.x && panel.x + panel.width <= area.x + area.width);
  assert.ok(panel.y >= area.y && panel.y + panel.height <= area.y + area.height);
});

test('compact guide bubble stays beside the real target with a reserved companion gap', () => {
  const area = { x: 0, y: 25, width: 1600, height: 1000 };
  const target = { x: 650, y: 350, width: 80, height: 60 };
  const bubble = placeGuideBubble(area, { width: 320, height: 170 }, target);
  assert.deepEqual(bubble, { x: 778, y: 295, width: 320, height: 170 });
  assert.equal(intersects(bubble!, target), false);
  assert.equal(bubble!.x - (target.x + target.width), 48);
});

test('guide bubble flips beside the target instead of clamping over it at display edges', () => {
  const area = { x: 0, y: 25, width: 900, height: 700 };
  const size = { width: 320, height: 170 };
  const right = { x: 780, y: 350, width: 60, height: 50 };
  assert.equal(placeGuideBubble(area, size, right)!.x, right.x - 48 - size.width);
  // Neither horizontal side fits. Preserve the below/above gap instead.
  const center = { x: 390, y: 120, width: 120, height: 50 };
  assert.equal(placeGuideBubble(area, size, center, 80)!.y, center.y + center.height + 80);
  const bottom = { ...center, y: 600 };
  assert.equal(placeGuideBubble(area, size, bottom, 80)!.y, bottom.y - 80 - size.height);
});

test('menu-bar targets keep the bubble inside the work area and the target uncovered', () => {
  const area = { x: 0, y: 32, width: 1440, height: 840 };
  const target = { x: 240, y: -12, width: 74, height: 48 };
  const bubble = placeGuideBubble(area, { width: 320, height: 180 }, target);
  assert.ok(bubble);
  assert.ok(bubble.y >= area.y + 16);
  assert.equal(intersects(bubble, target), false);
});

test('large-text bubbles preserve their full reported height at negative display origins', () => {
  const area = { x: -1800, y: -900, width: 1600, height: 1000 };
  const target = { x: -1450, y: -300, width: 80, height: 60 };
  const bubble = placeGuideBubble(area, { width: 640, height: 340 }, target, 96);
  assert.ok(bubble);
  assert.equal(bubble.width, 640);
  assert.equal(bubble.height, 340);
  assert.equal(bubble.x - target.x - target.width, 96);
  assert.ok(bubble.x >= area.x + 16 && bubble.x + bubble.width <= area.x + area.width - 16);
  assert.ok(bubble.y >= area.y + 16 && bubble.y + bubble.height <= area.y + area.height - 16);
  assert.equal(intersects(bubble, target), false);
});

test('an impossible or invalid guide bubble fit returns no adjacent position', () => {
  const area = { x: 0, y: 25, width: 480, height: 340 };
  const target = { x: 180, y: 120, width: 100, height: 100 };
  assert.equal(placeGuideBubble(area, { width: 320, height: 220 }, target), null);
  assert.equal(placeGuideBubble(area, { width: 640, height: 400 }, target), null);
  assert.equal(placeGuideBubble(area, { width: 320, height: 170 }, { ...target, x: NaN }), null);
  assert.equal(placeGuideBubble(area, { width: 320, height: 170 }, target, -1), null);
  // The caller may use the old placement strategy, but still must reject any
  // fallback overlapping the padded real target before publishing guidance.
  const fallback = placePanel(area, { width: 320, height: 220 }, null, [target]);
  assert.equal(intersects(fallback, target), true);
});
