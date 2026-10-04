const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 730 } });
const results = [];
const home = async () => {
  await page.goto(`${baseURL}/`);
  await page.getByRole('heading', { name: 'What would you like to learn?' }).waitFor();
};
const within = async (selector, name) => {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.y >= -1 && box.y + box.height <= 731, `${name} outside 730px content viewport: ${JSON.stringify(box)}`);
  results.push({ name, top: box.y, bottom: box.y + box.height });
};
try {
  await home();
  const rows = await page.locator('.lesson-row').count();
  assert.equal(rows, 8);
  // The lesson library may scroll as it grows. Each complete lesson button
  // must remain reachable; floating guide targets/controls stay viewport-bound.
  for (let i = 0; i < rows; i++) {
    await page.locator('.lesson-row').nth(i).scrollIntoViewIfNeeded();
    await within(`.lesson-row >> nth=${i}`, `home lesson ${i + 1} reachable`);
  }
  const homeWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(homeWidth.content <= homeWidth.viewport + 2, `Home has horizontal overflow: ${JSON.stringify(homeWidth)}`);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/layout-home-730.png' });
  for (const [name, target] of [['Mute and unmute', 'microphone'], ['Turn your camera off and on', 'camera'], ['End a call', 'end-call'], ['Make text larger', 'view-menu'], ['Read without distractions', 'view-menu'], ['Save this page', 'bookmarks-menu'], ['Bring back a closed tab', 'history-menu'], ['Find Downloads', 'downloads']]) {
    await home();
    await page.getByRole('button', { name: `${name} Start practice`, exact: true }).click();
    await within(`[data-guide-target="${target}"]`, `${name} target`);
    await within('.coach-control-row button:last-child', `${name} stop`);
    if (target === 'microphone') {
      await page.locator('[data-guide-target="microphone"]').click();
      await within('[data-guide-target="microphone"]', 'microphone second step target');
      await within('.coach-control-row button:last-child', 'microphone second step stop');
      await page.screenshot({ path: 'test-results/layout-mic-730.png' });
    }
  }
  await writeFile('test-results/ui-layout-results.json', JSON.stringify({ viewport: { width: 1180, height: 730 }, checks: results }, null, 2));
  console.log(`PASS ${results.length} default-viewport target/stop/lesson bounds checks`);
} finally { await browser.close(); }
