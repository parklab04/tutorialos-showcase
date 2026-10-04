const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Explicit bridge stubs only. No macOS permission, Settings, or Finder APIs run here.
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const errors = [];
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
const baseState = { sessionId: 'permission-ui', lessonId: 'safari-zoom', status: 'permission', stepIndex: 0, title: 'Allow access so HelpOS can find the controls.', message: 'Access is needed to locate controls.', why: '', target: null, observationSource: 'none', verification: null, permission: { accessibility: false, screenCapture: false }, canConfirm: false };
const setupPage = async (coach = false, lessonId = 'safari-zoom') => {
  const page = await browser.newPage({ viewport: coach ? { width: 400, height: 560 } : { width: 1180, height: 760 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ state, coach }) => {
    window.calls = [];
    window.statusValue = { desktop: true, platform: 'darwin', accessibility: false, screenCapture: false, aiConfigured: false, version: 'test' };
    window.stateValue = { ...state, coachLayoutId: 'permission-fixture' };
    window.showAppFails = false;
    window.helpOS = {
      getStatus: async () => { window.calls.push(['status']); return { ...window.statusValue }; },
      getLiveState: async () => window.stateValue,
      onLiveState: callback => { window.updateState = value => { window.stateValue = { ...value, coachLayoutId: value.coachLayoutId ?? 'permission-fixture' }; callback(window.stateValue); }; return () => {}; },
      reportCoachScale: async () => {},
      reportCoachHeight: async height => { window.requestedCoachHeight = height; },
      stopLive: async () => window.calls.push(['stop']),
      pauseLive: async () => window.calls.push(['pause']),
      resumeLive: async () => { window.calls.push(['resume']); if (coach) window.updateState({ ...window.stateValue, status: 'observing', permission: { accessibility: window.statusValue.accessibility, screenCapture: window.statusValue.screenCapture } }); },
      retryLive: async () => { window.calls.push(['retry']); if (coach) window.updateState({ ...window.stateValue, status: 'observing', permission: { accessibility: window.statusValue.accessibility, screenCapture: window.statusValue.screenCapture } }); },
      confirmLive: async () => {},
      showHome: async mode => window.calls.push(['home', mode]),
      configureAI: async () => ({ configured: false }),
      askAI: async () => ({ lessonId: null, explanation: '' }),
      showAppInFinder: async () => { window.calls.push(['show-app']); if (window.showAppFails) throw new Error('Simulated Finder failure'); },
      requestPermission: kind => {
        window.calls.push(['request', kind]);
        if (coach) window.updateState({ ...window.stateValue, status: 'paused', message: 'Guide paused' });
        return new Promise((resolve, reject) => {
          window.finishPermission = result => {
            if (result.granted) window.statusValue[kind === 'accessibility' ? 'accessibility' : 'screenCapture'] = true;
            resolve(result);
          };
          window.failPermission = () => reject(new Error('Simulated setup failure'));
        });
      },
    };
  }, { state: { ...baseState, lessonId }, coach });
  await page.goto(`${baseURL}/${coach ? '#coach' : ''}`);
  if (coach) await page.getByRole('heading', { name: 'Allow Accessibility', exact: true }).waitFor();
  else await page.getByRole('heading', { name: 'What would you like to do?' }).waitFor();
  return page;
};
const requests = page => page.evaluate(() => window.calls.filter(call => call[0] === 'request'));
// Mirror the explicit content-height report; never scroll a clipped control into view.
const fitCoach = async (page, width = 400) => {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(() => window.requestedCoachHeight === Math.ceil(document.querySelector('.live-coach-content').getBoundingClientRect().height + 14));
  const height = await page.evaluate(() => window.requestedCoachHeight);
  await page.setViewportSize({ width, height });
  await page.waitForFunction(() => Math.abs(innerHeight - window.requestedCoachHeight) <= 1);
};
const assertCoachFits = async page => {
  const layout = await page.evaluate(() => {
    const body = document.querySelector('.native-coach-body');
    const controls = [...document.querySelectorAll('.native-coach h2, .native-coach p, .native-coach button')].map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent, x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
    });
    return { width: innerWidth, height: innerHeight, pageFits: document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1, bodyFits: body.scrollHeight <= body.clientHeight + 1 && body.scrollWidth <= body.clientWidth + 1, controls };
  });
  assert.ok(layout.pageFits && layout.bodyFits, 'The permission coach must fit without scrolling');
  for (const control of layout.controls) assert.ok(control.x >= 0 && control.y >= 0 && control.right <= layout.width + 1 && control.bottom <= layout.height + 1, `Offscreen permission content: ${control.text}`);
};
const button = (page, kind) => page.getByRole('button', { name: kind === 'screen' ? 'Set up Screen Recording access' : 'Set up Accessibility access', exact: true });
const denied = { granted: false, settingsOpened: true };
const missingApp = 'Turn on HelpOS. If it is missing, click + and choose HelpOS.app.';
const reopen = 'After enabling access, quit HelpOS with Command+Q and reopen it.';
let page;
try {
  page = await setupPage();
  await check('Status refresh, opening Settings, and checking access never request permission', async () => {
    assert.deepEqual(await requests(page), []);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('dialog[open]').waitFor();
    await page.getByRole('button', { name: 'Check access again', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.deepEqual(await requests(page), []);
  });
  await check('Explicit Accessibility request disables both buttons and prevents duplicate requests', async () => {
    await button(page, 'accessibility').click();
    await page.getByRole('button', { name: 'Requesting access…', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Requesting access…', exact: true }).isDisabled(), true);
    assert.equal(await button(page, 'screen').isDisabled(), true);
    await page.locator('[data-permission="accessibility"] button').evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await requests(page), [['request', 'accessibility']]);
    assert.equal(await page.getByText('If macOS asks, choose whether to allow access.', { exact: true }).isVisible(), true);
  });
  await check('Unavailable access gives Settings, missing-app, and restart instructions without claiming success', async () => {
    await page.evaluate(result => window.finishPermission(result), denied);
    await page.getByText('Mac settings opened. Access is not enabled yet.', { exact: true }).waitFor();
    assert.equal(await page.getByText(missingApp, { exact: true }).count(), 1);
    assert.equal(await page.getByText(reopen, { exact: true }).count(), 1);
    assert.equal(await page.getByText('Allowed', { exact: true }).count(), 0);
    assert.equal(await button(page, 'accessibility').isEnabled(), true);
  });
  await check('Show HelpOS in Finder is an explicit action and its failure has English feedback', async () => {
    assert.equal(await page.evaluate(() => window.calls.some(call => call[0] === 'show-app')), false);
    await page.getByRole('button', { name: 'Show HelpOS in Finder', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'show-app').length), 1);
    await page.evaluate(() => { window.showAppFails = true; });
    await page.getByRole('button', { name: 'Show HelpOS in Finder', exact: true }).click();
    await page.getByRole('alert').getByText('HelpOS could not show the app in Finder. Locate HelpOS.app where you installed it.', { exact: true }).waitFor();
  });
  await check('Returning after a real observed grant removes obsolete denial instructions', async () => {
    const before = await requests(page);
    await page.evaluate(() => { window.statusValue.accessibility = true; window.dispatchEvent(new Event('focus')); });
    await page.locator('[data-permission="accessibility"]').getByText('Allowed', { exact: true }).waitFor();
    assert.equal(await page.getByText('Mac settings opened. Access is not enabled yet.', { exact: true }).count(), 0);
    assert.equal(await page.getByText(missingApp, { exact: true }).count(), 0);
    assert.equal(await page.getByText(reopen, { exact: true }).count(), 0);
    assert.deepEqual(await requests(page), before);
    await page.evaluate(() => { window.statusValue.accessibility = false; window.dispatchEvent(new Event('focus')); });
    await button(page, 'accessibility').waitFor();
  });
  await check('A late denied request cannot replace a newer observed grant with stale instructions', async () => {
    await button(page, 'accessibility').click();
    await page.evaluate(() => { window.statusValue.accessibility = true; window.dispatchEvent(new Event('focus')); });
    await page.locator('[data-permission="accessibility"]').getByText('Allowed', { exact: true }).waitFor();
    await page.evaluate(result => window.finishPermission(result), denied);
    await page.getByText('If macOS asks, choose whether to allow access.', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(missingApp, { exact: true }).count(), 0);
    assert.equal(await page.getByText('Mac settings opened. Access is not enabled yet.', { exact: true }).count(), 0);
    await page.evaluate(() => { window.statusValue.accessibility = false; window.dispatchEvent(new Event('focus')); });
    await button(page, 'accessibility').waitFor();
  });
  await check('Granted Screen Recording refreshes status and shows Allowed only for its own row', async () => {
    await button(page, 'screen').click();
    assert.deepEqual((await requests(page)).at(-1), ['request', 'screen']);
    await page.evaluate(() => window.finishPermission({ granted: true, settingsOpened: false }));
    await page.locator('[data-permission="screen"]').getByText('Allowed', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-permission="accessibility"]').getByText('Allowed', { exact: true }).count(), 0);
    await page.getByText('Access is available. You can return to your guide.', { exact: true }).waitFor();
    assert.equal(await page.getByText(missingApp, { exact: true }).count(), 0);
  });
  await check('A later revoked permission is reflected by a read-only refresh', async () => {
    const before = await requests(page);
    await page.evaluate(() => { window.statusValue.screenCapture = false; });
    await page.getByRole('button', { name: 'Check access again', exact: true }).click();
    await button(page, 'screen').waitFor();
    assert.equal(await page.locator('[data-permission="screen"]').getByText('Allowed', { exact: true }).count(), 0);
    assert.deepEqual(await requests(page), before);
    await page.getByText('Access is available. You can return to your guide.', { exact: true }).waitFor({ state: 'hidden' });
  });
  await check('Request failure is recoverable and does not show a granted result', async () => {
    await button(page, 'accessibility').click();
    await page.evaluate(() => window.failPermission());
    await page.getByRole('alert').getByText('HelpOS could not finish access setup. Try again or open System Settings to check access.', { exact: true }).waitFor();
    assert.equal(await button(page, 'accessibility').isEnabled(), true);
    await page.getByText('Access is available. You can return to your guide.', { exact: true }).waitFor({ state: 'hidden' });
    await button(page, 'accessibility').click();
    await page.evaluate(() => window.finishPermission({ granted: false, settingsOpened: false }));
    await page.getByText('Access is not enabled yet. Try setup again, then check Mac settings.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
  });
  await page.close();
  page = await setupPage(true);
  await check('Coach mounting, focus, and retry never request access; Open Mac Settings is explicit and prevents duplicates', async () => {
    assert.deepEqual(await requests(page), []);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.evaluate(() => window.updateState({ ...window.stateValue, status: 'error' }));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    assert.deepEqual(await requests(page), []);
    await page.evaluate(() => window.updateState({ ...window.stateValue, status: 'permission' }));
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Checking access', exact: true }).waitFor();
    const checking = page.getByRole('button', { name: 'Checking…', exact: true });
    assert.equal(await checking.isDisabled(), true);
    await checking.evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await requests(page), [['request', 'accessibility']]);
    assert.equal(await page.evaluate(() => window.stateValue.status), 'paused');
    assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isVisible(), true);
  });
  await check('Coach Settings feedback survives pause and app switch; Find HelpOS remains an explicit action', async () => {
    await page.evaluate(result => window.finishPermission(result), denied);
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    assert.equal(await page.getByText('In Accessibility settings.', { exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Resume', exact: true }).count(), 0);
    const requestsBeforeCheck = await requests(page);
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    assert.deepEqual(await requests(page), requestsBeforeCheck);
    assert.equal(await page.evaluate(() => window.calls.some(call => call[0] === 'show-app')), false);
    await page.getByRole('button', { name: 'Find HelpOS', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'show-app').length), 1);
    await page.evaluate(() => window.updateState({ ...window.stateValue, status: 'waiting-app', title: 'Bring Safari to the front.' }));
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Access ready', exact: true }).count(), 0);
    assert.deepEqual(await requests(page), [['request', 'accessibility']]);
    await fitCoach(page);
    await assertCoachFits(page);
    await page.screenshot({ path: 'test-results/permission-coach-feedback.png' });
  });
  await check('Coach return refresh confirms access without another prompt or starting the guide', async () => {
    const before = await requests(page);
    await page.evaluate(() => { window.statusValue.accessibility = true; window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('heading', { name: 'Access ready', exact: true }).waitFor();
    assert.deepEqual(await requests(page), before);
    assert.equal(await page.getByRole('button', { name: 'Continue guide', exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'resume').length), 0);
    assert.equal(await page.getByRole('heading', { name: 'Done', exact: true }).count(), 0);
    await page.evaluate(() => { window.statusValue.accessibility = false; document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    assert.deepEqual(await requests(page), before);
  });
  await check('Enlarged permission coach fits Find HelpOS and Close help without scrolling', async () => {
    await page.evaluate(() => { localStorage.setItem('helpos:text-scale', '2'); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' })); });
    await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).fontSize) === 32);
    await fitCoach(page, 540);
    await assertCoachFits(page);
    assert.equal(await page.getByRole('button', { name: 'Find HelpOS', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isVisible(), true);
    assert.doesNotMatch(await page.locator('body').innerText(), /[가-힣]/u);
    await page.screenshot({ path: 'test-results/permission-coach-200.png' });
  });
  await page.close();
  page = await setupPage(true, 'facetime-mic');
  await check('FaceTime access failure stays recoverable and never claims a grant', async () => {
    assert.deepEqual(await requests(page), []);
    assert.equal(await button(page, 'screen').count(), 0);
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.evaluate(() => window.failPermission());
    await page.getByRole('heading', { name: 'Try again', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('heading', { name: 'Access ready', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Done', exact: true }).count(), 0);
  });
  await check('Confirmed access displays Access ready and waits for explicit Continue guide or Close help', async () => {
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.evaluate(() => window.finishPermission({ granted: true, settingsOpened: false }));
    await page.getByRole('heading', { name: 'Access ready', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Done', exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.stateValue.verification), null);
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'retry').length), 0);
    assert.deepEqual(await requests(page), [['request', 'accessibility'], ['request', 'accessibility']]);
    await fitCoach(page);
    await assertCoachFits(page);
    await page.getByRole('button', { name: 'Continue guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Finding button', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'retry').length), 1);
    assert.deepEqual(await requests(page), [['request', 'accessibility'], ['request', 'accessibility']]);
    await page.getByRole('button', { name: 'Close help', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'stop').length), 1);
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-permission-results.json', JSON.stringify({ environment: 'Isolated renderer with explicit bridge stubs; does not test actual macOS TCC prompts or registration', passed: results.length, results, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'test-results/permission-failure.png', fullPage: true });
  await writeFile('test-results/ui-permission-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
