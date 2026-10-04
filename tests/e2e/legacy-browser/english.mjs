const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Rendered UI only: multilingual native matcher aliases remain valid and are not UI copy.
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 }, deviceScaleFactor: 1 });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const audit = async name => {
  const rendered = await page.evaluate(() => ({
    language: document.documentElement.lang,
    text: document.body.innerText,
    accessibleLabels: [...document.querySelectorAll('[aria-label], input[placeholder], img[alt]')]
      .filter(element => element.getClientRects().length > 0)
      .flatMap(element => ['aria-label', 'placeholder', 'alt'].map(key => element.getAttribute(key) || '')).join('\n'),
  }));
  assert.equal(rendered.language, 'en', `${name}: document language`);
  assert.doesNotMatch(rendered.text + rendered.accessibleLabels, /[가-힣]/u, `${name}: untranslated rendered Korean copy`);
  results.push({ name, passed: true });
};
const home = async () => {
  await page.goto(`${baseURL}/`);
  await page.getByRole('heading', { name: 'What would you like to learn?' }).waitFor();
};
try {
  await home();
  assert.equal(await page.locator('.lesson-row').count(), 8);
  await audit('Home, all eight lesson names, mode descriptions and accessible names');
  await page.screenshot({ path: 'test-results/english-home-1180.png' });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  await audit('Help dialog');
  await page.getByRole('button', { name: 'Choose a guide', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('dialog[open]').waitFor();
  await audit('Settings dialog, text sizes, permissions, optional AI explanation');
  await page.screenshot({ path: 'test-results/english-settings-1180.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('radio', { name: /On my Mac/ }).click();
  await audit('Browser live-mode explanation');
  const lessons = [
    ['Mute and unmute', ['microphone', 'microphone']],
    ['Turn your camera off and on', ['camera', 'camera']],
    ['End a call', ['end-call']],
    ['Make text larger', ['view-menu', 'zoom-in']],
    ['Read without distractions', ['view-menu', 'show-reader']],
    ['Save this page', ['bookmarks-menu', 'add-bookmark', 'save-bookmark']],
    ['Bring back a closed tab', ['history-menu', 'reopen-closed-tab']],
    ['Find Downloads', ['downloads']],
  ];
  for (const [title, targets] of lessons) {
    await home();
    await page.getByRole('button', { name: `${title} Start practice`, exact: true }).click();
    for (let step = 0; step < targets.length; step++) {
      await audit(`${title}: step ${step + 1}`);
      await page.locator(`[data-guide-target="${targets[step]}"]`).click();
    }
    await page.getByRole('heading', { name: 'Guide complete', exact: true }).waitFor();
    await audit(`${title}: completion and learning evidence`);
    await page.getByRole('button', { name: 'Try without hints', exact: true }).click();
    await audit(`${title}: repeat without hints`);
  }
  await home();
  await page.evaluate(() => localStorage.setItem('helpos:text-scale', '2'));
  await page.setViewportSize({ width: 780, height: 680 });
  await page.reload();
  await audit('Home at 200% text');
  await page.getByRole('button', { name: 'Mute and unmute Start practice', exact: true }).click();
  await page.locator('.practice-coach.spotlight-coach').waitFor();
  await audit('Microphone tutorial at 200% text');
  await page.screenshot({ path: 'test-results/english-practice-200-viewport.png' });
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-english-results.json', JSON.stringify({ environment: 'Isolated English practice renderer; no native app actions', auditedScreens: results.length, results, errors }, null, 2));
  console.log(`PASS ${results.length} rendered-English screens, document language, accessible labels; no JavaScript errors`);
} catch (error) {
  await page.screenshot({ path: 'test-results/english-failure.png', fullPage: true });
  await writeFile('test-results/ui-english-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
