const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 730 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  window.baseState = { sessionId: 'pointer-fixture', lessonId: 'safari-zoom', status: 'guiding', stepIndex: 0, title: 'Open View', message: 'Click View.', why: '', target: { x: 240, y: 0, width: 50, height: 28 }, currentAction: 'open-view-menu', contextWindow: { x: 80, y: 70, width: 850, height: 600 }, overlayOrigin: { x: 0, y: 0 }, observationSource: 'accessibility', verification: null, permission: { accessibility: true, screenCapture: false } };
  window.pointerState = { sessionId: 'pointer-fixture', cursor: { x: 300, y: 230 }, displayBounds: { x: 0, y: 0, width: 1180, height: 730 }, workArea: { x: 0, y: 30, width: 1180, height: 680 }, coachBounds: { x: 105, y: 88, width: 320, height: 140 } };
  window.helpOS = {
    getLiveState: async () => ({ ...window.baseState, coachLayoutId: 'pointer-fixture' }),
    onLiveState: cb => { window.sendState = patch => cb({ ...window.baseState, ...patch }); return () => {}; },
    getGuidePointer: () => new Promise(resolve => { window.resolveInitialPointer = resolve; }),
    onGuidePointer: cb => { window.sendPointer = patch => { window.pointerState = { ...window.pointerState, ...patch }; cb(window.pointerState); }; window.clearPointer = () => cb(null); return () => {}; },
    reportCoachHeight: async height => {
      if (!window.frameElement) return;
      window.frameElement.style.height = `${height}px`;
      const r = window.frameElement.getBoundingClientRect();
      window.parent.sendPointer({ coachBounds: { x: r.x, y: r.y, width: r.width, height: r.height } });
    },
    reportCoachScale: async () => {}, stopLive: async () => {}, pauseLive: async () => {},
  };
});
const visible = '.pointer-companion[data-visible="true"]';
const geometry = () => page.locator('.companion-pointer').evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top), width: parseFloat(el.style.width), height: parseFloat(el.style.height), rotation: el.style.transform, pointerEvents: getComputedStyle(el).pointerEvents }));
try {
  await page.goto(`${baseURL}/#overlay`);
  await page.waitForFunction(() => !!window.sendPointer);
  await page.evaluate(() => window.sendPointer({}));
  await page.locator(visible).waitFor();
  assert.equal(await page.locator('.tutorial-scrim, .companion-bubble, button, summary').count(), 0, 'Overlay contains no dim layer, duplicate text bubble, or interactive controls');
  const anchored = await geometry();
  assert.equal(anchored.pointerEvents, 'none');
  await page.evaluate(() => window.sendPointer({ cursor: { x: 1050, y: 660 } }));
  assert.deepEqual(await geometry(), anchored, 'Cursor motion cannot cancel or move target guidance');
  await page.evaluate(() => window.resolveInitialPointer(null));
  assert.deepEqual(await geometry(), anchored, 'A late initial read cannot overwrite the pointer event');
  await page.evaluate(() => window.sendPointer({ sessionId: 'old-session', cursor: { x: 20, y: 20 } }));
  assert.deepEqual(await geometry(), anchored, 'Stale session events are ignored');
  await page.evaluate(() => window.sendPointer({ sessionId: 'pointer-fixture' }));

  // Render the real coach in a separate iframe to model the second native
  // surface. Only the neutral backdrop and window coordinates are simulated.
  await page.evaluate(url => {
    const fixture = document.createElement('div'); fixture.id = 'pointer-fixture-backdrop';
    fixture.style.cssText = 'position:fixed;inset:0;background:#edf2f7;z-index:0;pointer-events:none;font:20px sans-serif;color:#263c4d';
    fixture.innerHTML = '<div style="height:30px;background:white;padding-left:80px">Safari　File　Edit　View　History</div><div style="margin:90px 80px;background:white;border-radius:18px;padding:40px;width:700px;height:380px"><b style="font-size:28px">Learn one click at a time</b><p>Simulated Safari backdrop for renderer layout checks.</p></div>';
    document.body.prepend(fixture);
    const coach = document.createElement('iframe'); coach.id = 'coach-fixture'; coach.title = 'Simulated native coach surface';
    coach.src = `${url}/#coach`; coach.style.cssText = 'position:fixed;left:105px;top:88px;width:320px;height:200px;border:0;z-index:60';
    document.body.append(coach);
  }, baseURL);
  const coach = page.frameLocator('#coach-fixture');
  await coach.locator('[data-presentation="companion"]').waitFor();
  await coach.getByRole('heading', { name: 'Click View', exact: true }).waitFor();
  await coach.getByRole('button', { name: 'Pause', exact: true }).waitFor();
  assert.equal(await coach.locator('.native-coach-header, .live-action-icon').count(), 0);
  assert.equal(await coach.locator('h2').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), 20);
  await page.screenshot({ path: 'test-results/pointer-companion-100.png' });
  await page.evaluate(() => {
    const frame = document.getElementById('coach-fixture'); frame.style.width = '640px'; frame.style.left = '10px'; frame.style.top = '136px';
    localStorage.setItem('helpos:text-scale', '2'); dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' }));
  });
  await page.waitForFunction(() => parseFloat(document.querySelector('.companion-pointer')?.style.width) === 64);
  await coach.locator('h2').evaluate(el => new Promise(resolve => {
    const check = () => parseFloat(getComputedStyle(el).fontSize) === 40 ? resolve() : requestAnimationFrame(check); check();
  }));
  const large = await geometry();
  await page.screenshot({ path: 'test-results/pointer-companion-200.png' });
  await page.evaluate(() => { document.getElementById('pointer-fixture-backdrop').remove(); document.getElementById('coach-fixture').remove(); });

  await page.evaluate(() => {
    localStorage.setItem('helpos:text-scale', '1'); dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '1' }));
    window.sendState({ target: { x: 1090, y: 200, width: 70, height: 32 }, currentAction: 'zoom-in' });
    window.sendPointer({ coachBounds: { x: 710, y: 140, width: 320, height: 200 } });
  });
  await page.waitForFunction(() => document.querySelector('.companion-pointer')?.style.transform === 'rotate(90deg)');
  const edge = await geometry();
  assert.ok(edge.x + edge.width < 1090);
  await page.evaluate(() => window.sendState({ target: { x: -1260, y: -100, width: 60, height: 30 }, overlayOrigin: { x: -1440, y: -180 } }));
  await page.waitForFunction(() => document.querySelector('.pointer-companion')?.getAttribute('data-visible') === 'false');
  await page.evaluate(() => window.sendPointer({ displayBounds: { x: -1440, y: -180, width: 1180, height: 730 }, workArea: { x: -1440, y: -150, width: 1180, height: 680 }, coachBounds: { x: -1140, y: -130, width: 320, height: 200 } }));
  await page.locator(visible).waitFor();
  const negative = await geometry();
  assert.ok(negative.x > 0 && negative.x + negative.width <= 1180 && negative.y >= 30);
  assert.equal(await page.locator('.native-target').evaluate(el => parseFloat(el.style.left)), 174);

  await page.evaluate(() => {
    window.sendState({ status: 'waiting-control', target: null, lessonId: 'facetime-mic', title: 'Reveal call buttons' });
    window.sendPointer({ cursor: { x: 300, y: 230 }, displayBounds: { x: 0, y: 0, width: 1180, height: 730 }, workArea: { x: 0, y: 30, width: 1180, height: 680 }, coachBounds: { x: 800, y: 400, width: 320, height: 200 } });
  });
  await page.locator('.pointer-companion[data-mode="following"][data-visible="true"]').waitFor();
  assert.equal(await page.locator('.native-target').count(), 0);
  const following = await geometry();
  await page.evaluate(() => window.sendPointer({ cursor: { x: 390, y: 280 } }));
  await page.waitForFunction(x => parseFloat(document.querySelector('.companion-pointer').style.left) !== x, following.x);
  const moved = await geometry();
  assert.equal(moved.x - following.x, 90); assert.equal(moved.y - following.y, 50);
  await page.evaluate(() => { localStorage.setItem('helpos:text-scale', '2'); dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' })); });
  await page.waitForFunction(() => parseFloat(document.querySelector('.companion-pointer')?.style.width) === 64);
  assert.equal(await page.locator('.companion-pointer').evaluate(el => getComputedStyle(el).animationName), 'none');
  const followingLarge = await geometry();
  for (const patch of [
    ...['permission', 'paused', 'complete', 'error', 'idle', 'waiting-app'].map(status => ({ status })),
    { status: 'waiting-control', target: null, contextWindow: undefined },
    { status: 'waiting-control', target: null, permission: { accessibility: false, screenCapture: false } },
    { status: 'guiding', canConfirm: true },
  ]) {
    await page.evaluate(patch => window.sendState(patch), patch);
    await page.waitForFunction(() => !document.querySelector('.pointer-companion'));
  }
  await page.evaluate(() => window.sendState({}));
  await page.locator('.native-target').waitFor();
  await page.evaluate(() => window.sendPointer({ coachBounds: null }));
  await page.waitForFunction(() => document.querySelector('.pointer-companion')?.getAttribute('data-visible') === 'false');
  assert.equal(await page.locator('.companion-pointer').count(), 0, 'Unknown coach geometry omits decoration and preserves real target outline');
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-pointer-companion-results.json', JSON.stringify({ environment: 'Simulated browser/native bridge and backdrop; real coach renderer in separate iframe', anchored, large, edge, negative, following, moved, followingLarge, overlayHasNoInstructionOrControls: true, errors }, null, 2));
  console.log('PASS sole actionable coach bubble, target-linked pointer, waiting follow, edges, 200% text, session/display races, reduced motion and click-through overlay');
} finally { await browser.close(); }
