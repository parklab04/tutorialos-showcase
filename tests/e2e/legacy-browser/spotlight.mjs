const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated practice-UI checks only. The script never interacts with a native target app.
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
const startMicrophone = async () => {
  await page.goto(`${baseURL}/`);
  await page.getByRole('button', { name: 'Mute and unmute Start practice', exact: true }).click();
  await page.locator('[data-guide-target="microphone"]').waitFor();
};
const targetRect = async () => page.locator('[data-guide-target="microphone"]').boundingBox();
const holeRect = async () => page.locator('[data-spotlight-hole="target"]').evaluate(element => ({
  x: Number(element.getAttribute('x')),
  y: Number(element.getAttribute('y')),
  width: Number(element.getAttribute('width')),
  height: Number(element.getAttribute('height')),
}));
const assertHole = async () => {
  const target = await targetRect();
  assert.ok(target, 'Practice target exists');
  const hole = await holeRect();
  const expected = { x: target.x - 6, y: target.y - 6, width: target.width + 12, height: target.height + 12 };
  for (const key of Object.keys(expected)) assert.ok(Math.abs(hole[key] - expected[key]) <= 1.5, `Target hole ${key}: expected ${expected[key]}, received ${hole[key]}`);
  return { target, hole };
};
try {
  await check('One scrim and one adjacent coach, with target hole matching the actual control', async () => {
    await startMicrophone();
    await page.locator('.tutorial-scrim').waitFor({ state: 'attached' });
    assert.equal(await page.locator('.tutorial-scrim').count(), 1);
    assert.equal(await page.locator('.practice-coach').count(), 1);
    const coach = page.locator('.practice-coach.spotlight-coach');
    assert.equal(await coach.isVisible(), true);
    const { target } = await assertHole();
    const box = await coach.boundingBox();
    assert.ok(box);
    const overlaps = box.x < target.x + target.width && box.x + box.width > target.x && box.y < target.y + target.height && box.y + box.height > target.y;
    assert.equal(overlaps, false, 'Coach must not cover the target');
    const dx = Math.max(target.x - (box.x + box.width), box.x - (target.x + target.width), 0);
    const dy = Math.max(target.y - (box.y + box.height), box.y - (target.y + target.height), 0);
    assert.ok(Math.hypot(dx, dy) <= 160, `Coach should be near the target, gap=${Math.hypot(dx, dy)}`);
    const instruction = 'Click Mute.';
    assert.equal(await page.getByText(instruction, { exact: true }).count(), 1, 'Instruction must not appear in a duplicate card');
    await page.screenshot({ path: 'test-results/spotlight-microphone-1180.png' });
  });
  await check('The highlighted practice target receives a click and advances the lesson', async () => {
    await page.locator('[data-guide-target="microphone"]').click();
    assert.match(await page.locator('.step-meta').innerText(), /Step 2 of 2/);
    await assertHole();
  });
  await check('Pause removes the scrim and resume restores it', async () => {
    await page.getByRole('button', { name: 'Pause guide', exact: true }).click();
    assert.equal(await page.locator('.tutorial-scrim').count(), 0);
    await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
    await page.locator('.tutorial-scrim').waitFor({ state: 'attached' });
  });
  await check('Settings remains above the spotlight and Escape closes only the dialog', async () => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.locator('dialog[open]');
    await dialog.waitFor();
    const topLayerOwnsPoint = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(box.x + Math.min(40, box.width / 2), box.y + Math.min(35, box.height / 2)));
    });
    assert.equal(topLayerOwnsPoint, true);
    await page.screenshot({ path: 'test-results/spotlight-settings-dialog.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.equal(await page.locator('.practice-page').count(), 1);
  });
  await check('Hint-free repeat has no scrim until the learner requests help', async () => {
    await page.locator('[data-guide-target="microphone"]').click();
    await page.getByText('You clicked the controls in practice.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Try without hints', exact: true }).click();
    assert.equal(await page.locator('.tutorial-scrim').count(), 0);
    await page.getByRole('button', { name: 'Show me where to click', exact: true }).click();
    await page.locator('.tutorial-scrim').waitFor({ state: 'attached' });
    await assertHole();
  });
  await check('At 200% text and narrow width, no horizontal overflow and Stop remains reachable', async () => {
    await page.evaluate(() => localStorage.setItem('helpos:text-scale', '2'));
    await page.setViewportSize({ width: 780, height: 680 });
    await startMicrophone();
    const stop = page.getByRole('button', { name: 'End guide', exact: true });
    await stop.scrollIntoViewIfNeeded();
    assert.equal(await stop.isVisible(), true);
    const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(metrics.width <= metrics.viewport + 2, `Horizontal overflow: ${metrics.width}/${metrics.viewport}`);
    assert.equal(await page.locator('.practice-coach').count(), 1);
    await page.screenshot({ path: 'test-results/spotlight-narrow-200.png', fullPage: true });
    await page.screenshot({ path: 'test-results/spotlight-narrow-200-viewport.png' });
    const readable = await page.locator('.practice-coach-content').evaluate(element => ({
      visibleHeight: element.clientHeight,
      instructionLineHeight: parseFloat(getComputedStyle(element.querySelector('.instruction-content h2')).lineHeight),
      scrollHeight: element.scrollHeight,
      bodyTop: element.getBoundingClientRect().top,
      bodyBottom: element.getBoundingClientRect().bottom,
      instructionTop: element.querySelector('.instruction-content h2').getBoundingClientRect().top,
      instructionBottom: element.querySelector('.instruction-content h2').getBoundingClientRect().bottom,
    }));
    assert.ok(readable.visibleHeight >= readable.instructionLineHeight * 2, `Coach must expose at least two instruction lines at enlarged text: ${JSON.stringify(readable)}`);
    assert.ok(readable.instructionTop >= readable.bodyTop - 1 && readable.instructionBottom <= readable.bodyBottom + 1, `The full first instruction must be visible above the footer at enlarged text: ${JSON.stringify(readable)}`);
    await stop.click();
    await page.getByRole('heading', { name: 'What would you like to learn?' }).waitFor();
  });
  await check('All eight initial instructions, targets and End guide fit at 200% in the narrow viewport', async () => {
    const findings = [];
    for (const [name, target, screenshotName = target] of [['Mute and unmute', 'microphone'], ['Turn your camera off and on', 'camera'], ['End a call', 'end-call'], ['Make text larger', 'view-menu'], ['Read without distractions', 'view-menu', 'reader-view-menu'], ['Save this page', 'bookmarks-menu'], ['Bring back a closed tab', 'history-menu'], ['Find Downloads', 'downloads']]) {
      await page.goto(`${baseURL}/`);
      await page.getByRole('button', { name: `${name} Start practice`, exact: true }).click();
      await page.locator('.practice-coach.spotlight-coach').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const reading = await page.locator('.practice-coach-content').evaluate(element => {
        const body = element.getBoundingClientRect();
        const instruction = element.querySelector('.instruction-content h2').getBoundingClientRect();
        return { bodyTop: body.top, bodyBottom: body.bottom, instructionTop: instruction.top, instructionBottom: instruction.bottom };
      });
      const targetBounds = await page.locator(`[data-guide-target="${target}"]`).boundingBox();
      const stopBounds = await page.getByRole('button', { name: 'End guide', exact: true }).boundingBox();
      const scroll = await page.evaluate(() => ({ y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      if (!(reading.instructionTop >= reading.bodyTop - 1 && reading.instructionBottom <= reading.bodyBottom + 1)) findings.push(`${name}: full instruction must fit at 200%: ${JSON.stringify({ ...reading, targetBounds, scroll })}`);
      for (const [kind, bounds] of [['target', targetBounds], ['End guide', stopBounds]]) if (!(bounds && bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= 781 && bounds.y + bounds.height <= 681)) findings.push(`${name}: ${kind} must fit in the viewport: ${JSON.stringify(bounds)}`);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 782) findings.push(`${name}: no horizontal overflow at 200%, width=${width}`);
      await page.screenshot({ path: `test-results/spotlight-200-${screenshotName}.png` });
    }
    assert.deepEqual(findings, [], 'Every lesson must expose its complete instruction, target, and End guide at 200%');
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/spotlight-ui-results.json', JSON.stringify({ environment: 'Isolated browser practice UI; no native target-app interactions', viewport: { width: 1180, height: 760 }, passed: results.length, results, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/spotlight-failure.png', fullPage: true });
  await writeFile('test-results/spotlight-ui-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
