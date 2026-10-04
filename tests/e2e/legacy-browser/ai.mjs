import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 760 } });
const results = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.__ai = { configured: true, calls: [], fail: false, pending: false };
  window.helpOS = {
    getStatus: async () => ({ desktop: true, platform: 'darwin', accessibility: false, screenCapture: false, aiConfigured: window.__ai.configured, version: '0.1.4' }),
    getLiveState: async () => ({ status: 'idle' }),
    onLiveState: () => () => {},
    stopLive: async () => {},
    askAI: async question => {
      window.__ai.calls.push(question);
      if (window.__ai.pending) await new Promise(resolve => { window.__resolveAI = resolve; });
      if (window.__ai.fail) throw new Error('Fixture failure');
      return { lessonId: 'facetime-mic', explanation: 'Try the microphone guide.' };
    },
  };
});
try {
  await page.goto(baseURL);
  await page.getByRole('heading', { name: 'Ask AI which guide to use' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ai.calls), []);
  await page.getByLabel('What you want to learn', { exact: true }).fill('  How do I mute?  ');
  await page.getByRole('button', { name: 'Suggest a guide', exact: true }).click();
  await page.getByText('Try the microphone guide.', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__ai.calls), ['How do I mute?']);
  await page.locator('.ai-answer').getByRole('button', { name: 'Start practice', exact: true }).click();
  await page.locator('[data-guide-target="microphone"]').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.ai-answer').count(), 0);
  results.push('Configured AI is user-triggered and its recommendation opens the selected Practice guide');

  await page.evaluate(() => { window.__ai.fail = true; });
  await page.getByRole('button', { name: 'Suggest a guide', exact: true }).click();
  await page.getByText('AI is unavailable right now. You can still use the prepared guides.', { exact: true }).waitFor();
  await page.evaluate(() => { window.__ai.fail = false; window.__ai.pending = true; });
  await page.getByRole('button', { name: 'Suggest a guide', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Finding a guide for you…', exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__ai.pending = false; window.__resolveAI(); });
  await page.getByText('Try the microphone guide.', { exact: true }).waitFor();
  assert.equal(await page.getByText('AI is unavailable right now. You can still use the prepared guides.', { exact: true }).count(), 0);
  results.push('Provider failure recovers and pending requests keep the submit button disabled');

  await page.evaluate(() => { window.__ai.configured = false; window.dispatchEvent(new Event('focus')); });
  await page.locator('.ai-advice').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.lesson-row').count(), 8);
  results.push('Disconnecting removes AI advice while prepared guides remain available');
  assert.deepEqual(errors, []);
  await writeFile('test-results/ai-ui-results.json', JSON.stringify({ results, errors, note: 'Provider and desktop bridge are stubbed; no cloud request or API key was used.' }, null, 2));
  console.log(`PASS ${results.length} AI advice UI flows with a stubbed provider`);
} finally { await browser.close(); }
