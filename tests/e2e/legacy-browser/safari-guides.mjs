import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 850 }, deviceScaleFactor: 1 });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const target = name => page.locator(`[data-guide-target="${name}"]`);
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
let visit = 0;
const start = async (id, scale = 1, width = 1180, height = 850) => {
  await page.setViewportSize({ width, height });
  await page.goto(baseURL);
  await page.evaluate(value => localStorage.setItem('helpos:text-scale', String(value)), scale);
  await page.goto(`${baseURL}/?safari-check=${++visit}#practice/${id}`);
  await page.getByRole('region', { name: 'Safari Practice scene', exact: true }).waitFor();
};
const step = async (number, total) => {
  await page.waitForFunction(({ number, total }) => document.querySelector('.step-meta')?.textContent.includes(`Step ${number} of ${total}`), { number, total });
  assert.equal(await page.locator('.completion-mark').count(), 0);
};
const complete = () => page.getByText('You clicked the controls in practice.', { exact: true }).waitFor();
const noOverflow = async label => {
  const metrics = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(metrics.content <= metrics.viewport + 2, `${label}: ${metrics.content}/${metrics.viewport} horizontal overflow`);
  const clipped = await page.locator('.practice-safari-coach.spotlight-coach .practice-coach-content').evaluateAll(elements => elements.some(element => element.scrollHeight > element.clientHeight + 2));
  assert.equal(clipped, false, `${label}: the instruction card needs scrolling`);
};

try {
  await check('Reader requires View then Show Reader; Zoom In does not complete it', async () => {
    await start('safari-reader');
    assert.equal(await page.locator('.safari-article-extra').isVisible(), true);
    await step(1, 2);
    await target('view-menu').click(); await step(2, 2);
    await target('zoom-in').click(); await step(2, 2);
    await page.getByText('Open View again to find Show Reader.', { exact: true }).waitFor();
    await target('view-menu').click(); await target('show-reader').click(); await complete();
    assert.equal(await page.locator('.reader-on').count(), 1);
    assert.equal(await page.locator('.safari-site-nav, .safari-article-extra').count(), 0);
    assert.equal(await page.getByText('To make the text larger again, choose View → Zoom In.', { exact: true }).count(), 0);
    await page.screenshot({ path: 'test-results/safari-reader-complete.png', fullPage: true });
  });

  await check('Bookmark requires its menu, dialog, and Add; Cancel recovers without completing', async () => {
    await start('safari-bookmark');
    await target('history-menu').click(); await step(1, 3);
    await target('bookmarks-menu').click(); await step(2, 3);
    await target('add-bookmark').click(); await step(3, 3);
    const dialog = page.getByRole('dialog', { name: 'Add Bookmark — Practice', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByText('Favorites', { exact: true }).isVisible(), true);
    await page.screenshot({ path: 'test-results/safari-bookmark-add.png', fullPage: true });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await step(3, 3);
    assert.equal(await page.locator('.safari-saved-badge').count(), 0);
    await page.getByText('Open Bookmarks, then choose Add Bookmark again.', { exact: true }).waitFor();
    await target('bookmarks-menu').click(); await target('add-bookmark').click(); await step(3, 3);
    await page.keyboard.press('Escape'); await step(3, 3);
    assert.equal(await dialog.count(), 0);
    await target('bookmarks-menu').click(); await target('add-bookmark').click();
    await target('save-bookmark').click(); await complete();
    await page.getByText('Saved to Favorites', { exact: true }).waitFor();
    assert.equal(await dialog.count(), 0);
    await page.getByRole('button', { name: 'Try without hints', exact: true }).click();
    assert.equal(await page.locator('.safari-saved-badge').count(), 0);
    assert.equal(await page.locator('.practice-highlight').count(), 0);
  });

  await check('Closed-tab practice restores only after History and Reopen Last Closed Tab', async () => {
    await start('safari-reopen-tab');
    await page.getByRole('heading', { name: 'Your practice tab is closed.', exact: true }).waitFor();
    assert.equal(await page.locator('.sample-webpage').count(), 0);
    await target('view-menu').click(); await step(1, 2);
    assert.equal(await target('zoom-in').isDisabled(), true);
    await target('history-menu').click(); await step(2, 2);
    await page.screenshot({ path: 'test-results/safari-reopen-menu.png', fullPage: true });
    await target('reopen-closed-tab').click(); await complete();
    await page.getByText('Practice · Tab restored', { exact: true }).waitFor();
    assert.equal(await page.locator('.sample-webpage').isVisible(), true);
    await page.locator('.practice-bottom').getByRole('button', { name: 'Restart practice', exact: true }).click();
    await page.getByRole('heading', { name: 'Your practice tab is closed.', exact: true }).waitFor();
    await step(1, 2);
  });

  await check('An action while paused does not complete a lesson; reset restores its starting state', async () => {
    await start('safari-reader');
    await target('view-menu').click(); await step(2, 2);
    await page.getByRole('button', { name: 'Pause guide', exact: true }).click();
    await target('show-reader').click();
    assert.equal(await page.locator('.reader-on').count(), 1);
    assert.equal(await page.locator('.completion-mark').count(), 0);
    await page.getByRole('button', { name: 'Resume guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Reset the practice scene.', exact: true }).waitFor();
    await page.locator('.practice-coach').getByRole('button', { name: 'Restart practice', exact: true }).click();
    await step(1, 2);
    assert.equal(await page.locator('.reader-on').count(), 0);
  });

  await check('Existing zoom practice still enlarges text only after View and Zoom In', async () => {
    await start('safari-zoom');
    const before = await page.locator('.sample-webpage p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    await target('view-menu').click(); await target('zoom-in').click(); await complete();
    const after = await page.locator('.sample-webpage p').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
    assert.ok(after > before, `Zoom ${before} -> ${after}`);
    await page.getByText('To make the text larger again, choose View → Zoom In.', { exact: true }).waitFor();
  });

  await check('All three Safari guides keep menus, dialog, and results within the page at 100% and 200%', async () => {
    const flows = [
      ['safari-reader', ['view-menu', 'show-reader']],
      ['safari-bookmark', ['bookmarks-menu', 'add-bookmark', 'save-bookmark']],
      ['safari-reopen-tab', ['history-menu', 'reopen-closed-tab']],
    ];
    for (const [scale, width, height] of [[1, 1180, 850], [2, 780, 680], [2, 540, 800]]) {
      for (const [id, actions] of flows) {
        await start(id, scale, width, height); await noOverflow(`${id} initial ${scale}/${width}`);
        for (const action of actions) {
          await target(action).click(); await noOverflow(`${id} ${action} ${scale}/${width}`);
          if (action === 'add-bookmark' && scale === 2) await page.screenshot({ path: `test-results/safari-bookmark-${scale}-${width}.png`, fullPage: true });
        }
        await complete(); await noOverflow(`${id} complete ${scale}/${width}`);
      }
    }
  });

  assert.deepEqual(errors, []);
  results.push({ name: 'No browser JavaScript errors', passed: true });
  await writeFile('test-results/safari-guides-results.json', JSON.stringify({ passed: results.length, results, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/safari-guides-failure.png', fullPage: true });
  await writeFile('test-results/safari-guides-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
