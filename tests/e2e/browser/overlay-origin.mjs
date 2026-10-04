const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 730 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.testOrigin = { x: 756, y: 491 };
  Object.defineProperty(window, 'screenX', { configurable: true, get: () => window.testOrigin.x });
  Object.defineProperty(window, 'screenY', { configurable: true, get: () => window.testOrigin.y });
  window.stateEvents = 0;
  window.helpOS = {
    getLiveState: async () => ({ sessionId: 'origin-race', lessonId: 'safari-zoom', status: 'guiding', stepIndex: 0, title: 'View', message: 'Click View.', why: '', target: { x: 197.79, y: 13.04, width: 42, height: 24 }, observationSource: 'accessibility', verification: null, permission: { accessibility: true, screenCapture: false } }),
    onLiveState: callback => { window.sendState = state => { window.stateEvents++; callback(state); }; return () => {}; },
    stopLive: async () => {},
  };
});
try {
  await page.goto(`${baseURL}/#overlay`);
  await page.locator('.native-target').waitFor({ state: 'attached' });
  const initial = await page.locator('.native-target').evaluate(element => ({ x: parseFloat(element.style.left), y: parseFloat(element.style.top) }));
  assert.ok(Math.abs(initial.x + 564.21) < .02 && Math.abs(initial.y + 483.96) < .02);
  await page.evaluate(() => { window.testOrigin = { x: 0, y: 0 }; });
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.native-target').style.left) - 191.79) < .02 && Math.abs(parseFloat(document.querySelector('.native-target').style.top) - 7.04) < .02);
  assert.equal(await page.evaluate(() => window.stateEvents), 0, 'Origin tracking must not depend on a new live-state event');
  await page.evaluate(() => { window.testOrigin = { x: -1440, y: 120 }; });
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.native-target').style.left) - 1631.79) < .02 && Math.abs(parseFloat(document.querySelector('.native-target').style.top) + 112.96) < .02);
  await page.evaluate(async () => { const state = await window.helpOS.getLiveState(); window.sendState({ ...state, overlayOrigin: { x: 0, y: 0 } }); });
  await page.waitForFunction(() => Math.abs(parseFloat(document.querySelector('.native-target').style.left) - 191.79) < .02 && Math.abs(parseFloat(document.querySelector('.native-target').style.top) - 7.04) < .02);
  assert.deepEqual(await page.evaluate(() => window.testOrigin), { x: -1440, y: 120 }, 'Authoritative native bounds must override delayed browser origin');
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-overlay-origin-results.json', JSON.stringify({ environment: 'Renderer test with explicitly controlled window origin; not a native window positioning test', initial, correctedWithoutStateEvent: true, movedOriginTracked: true, authoritativeNativeOriginPreferred: true, errors }, null, 2));
  console.log('PASS overlay follows window movement and prefers authoritative native bounds over delayed browser origin');
} finally { await browser.close(); }
