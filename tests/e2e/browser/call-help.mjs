const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated renderer/bridge stubs. No app watcher registration, native detection, permissions, or OS actions.
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const errors = [];
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
const makePage = async ({ card = false, source = 'preview', app = 'facetime', delayedRead = false } = {}) => {
  const page = await browser.newPage({ viewport: card ? { width: 360, height: 420 } : { width: 1180, height: 760 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ card, source, app, delayedRead }) => {
    window.calls = [];
    window.callReads = 0;
    window.delayReadNext = false;
    window.failRead = false;
    window.silentSetting = false;
    window.callSubscribers = new Set();
    window.callHelp = { enabled: card, status: card ? 'watching' : 'off', suggestion: card ? { id: 'offer-1', source, app } : null };
    window.emitCallHelp = value => { window.callHelp = value; for (const callback of window.callSubscribers) callback(value); };
    window.delayChoice = false;
    window.failChoice = false;
    window.delaySetting = false;
    window.failSetting = false;
    window.helpOS = {
      getStatus: async () => ({ desktop: true, platform: 'darwin', accessibility: false, screenCapture: false, aiConfigured: false, version: 'test' }),
      getLiveState: async () => ({ sessionId: '', lessonId: null, status: 'idle', stepIndex: 0, title: '', message: '', why: '', target: null, observationSource: 'none', verification: null, permission: { accessibility: true, screenCapture: true } }),
      onLiveState: () => () => {},
      stopLive: async () => window.calls.push(['stop-live']),
      requestPermission: async kind => { window.calls.push(['permission', kind]); return { granted: false, settingsOpened: false }; },
      getCallHelpState: () => {
        window.callReads++;
        if (window.failRead) return Promise.reject(new Error('Simulated OS read failure'));
        if (window.delayReadNext) { window.delayReadNext = false; return new Promise(resolve => { window.finishDelayedRead = resolve; }); }
        return delayedRead ? new Promise(resolve => { window.finishInitial = resolve; }) : Promise.resolve(structuredClone(window.callHelp));
      },
      onCallHelpState: callback => { window.callSubscribers.add(callback); return () => window.callSubscribers.delete(callback); },
      setCallHelpEnabled: enabled => {
        window.calls.push(['enabled', enabled]);
        if (window.failSetting) return Promise.reject(new Error('Simulated setting failure'));
        const finish = () => { const value = window.nextSetting ?? { ...window.callHelp, enabled, status: enabled ? 'watching' : 'off', suggestion: enabled ? window.callHelp.suggestion : null }; if (window.silentSetting) window.callHelp = value; else window.emitCallHelp(value); return value; };
        return window.delaySetting ? new Promise(resolve => { window.finishSetting = () => resolve(finish()); }) : Promise.resolve(finish());
      },
      previewCallHelp: async (app = 'facetime') => { window.calls.push(['preview', app]); window.emitCallHelp({ ...window.callHelp, suggestion: { id: 'preview-1', source: 'preview', app } }); },
      dismissCallHelp: async () => { window.calls.push(['dismiss']); window.emitCallHelp({ ...window.callHelp, suggestion: null }); },
      chooseCallHelpLesson: id => {
        window.calls.push(['choose', id]);
        if (window.failChoice) return Promise.reject(new Error('Simulated choice failure'));
        return window.delayChoice ? new Promise((resolve, reject) => { window.finishChoice = resolve; window.rejectChoice = () => reject(new Error('Late choice failure')); }) : Promise.resolve();
      },
      reportCallHelpScale: async scale => window.calls.push(['scale', scale]),
      reportCallHelpHeight: async height => { window.callHelpHeight = height; window.calls.push(['height', height]); },
    };
  }, { card, source, app, delayedRead });
  await page.goto(`${baseURL}/${card ? '#call-help' : ''}`);
  return page;
};
const actions = page => page.evaluate(() => window.calls.filter(call => !['scale', 'height', 'stop-live'].includes(call[0])));
const choice = (page, id) => page.locator(`[data-call-lesson="${id}"]`);
const fitCard = async (page, maximumHeight = 680) => {
  await page.waitForFunction(() => {
    const content = document.querySelector('.call-help-content');
    return content && Math.abs(window.callHelpHeight - Math.ceil(content.getBoundingClientRect().height + 14)) <= 1;
  });
  const natural = await page.evaluate(() => window.callHelpHeight);
  assert.ok(natural > 0 && natural <= maximumHeight, `Call help height ${natural} must fit available ${maximumHeight}`);
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.max(240, natural) });
  const layout = await page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    documentFits: document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
    boxes: [...document.querySelectorAll('.call-help-card, .call-help-content, .call-help-body, .call-help-footer')].map(el => ({ label: el.className, overflow: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, height: el.clientHeight, scrollWidth: el.scrollWidth, width: el.clientWidth })),
    controls: [...document.querySelectorAll('.call-help-card button, .call-help-choice > span, .call-help-choice > svg, .call-help-card h1, .call-help-chip, .call-help-body > p')].map(el => { const r = el.getBoundingClientRect(); return { label: el.textContent, x: r.x, y: r.y, width: r.width, height: r.height }; }),
  }));
  assert.ok(layout.documentFits, 'Floating help must not scroll');
  for (const box of layout.boxes) { assert.ok(box.scrollHeight <= box.height + 1 && box.scrollWidth <= box.width + 1, `${box.label} must not clip content`); assert.equal(['auto', 'scroll'].includes(box.overflow), false); }
  for (const box of layout.controls) assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= layout.width + 1 && box.y + box.height <= layout.height + 1, `${box.label} must fit without scrolling`);
};
let page;
try {
  page = await makePage();
  await check('Home exposes automatic help without writing settings, and a pending change survives opening Settings', async () => {
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await toggle.waitFor();
    await page.waitForFunction(() => window.callSubscribers.size === 1);
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await toggle.isEnabled(), true);
    assert.deepEqual(await actions(page), []);
    const bounds = await toggle.boundingBox();
    assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 760, 'Home switch is visible without scrolling');
    await page.evaluate(() => { window.delaySetting = true; });
    await toggle.click();
    assert.equal(await toggle.isDisabled(), true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await toggle.isDisabled(), true, 'Settings shares the pending write');
    assert.equal(await toggle.isChecked(), false, 'Unconfirmed enable is never shown as On');
    await toggle.evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await actions(page), [['enabled', true]]);
    await page.keyboard.press('Escape');
    assert.equal(await toggle.isDisabled(), true, 'Returning Home cannot reset the pending write');
    await page.evaluate(() => window.finishSetting());
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.checked === true);
    assert.equal(await toggle.isEnabled(), true);
    assert.deepEqual(await actions(page), [['enabled', true]]);
  });
  await check('Home and Settings show the same confirmed state and reject a failed Home update', async () => {
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await page.evaluate(() => { window.delaySetting = false; });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    assert.equal(await toggle.isChecked(), true);
    await toggle.click();
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => { window.failSetting = true; });
    await toggle.click();
    await page.getByRole('alert').getByText('Could not update automatic help. Try again.', { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => window.emitCallHelp({ enabled: true, status: 'watching', suggestion: null }));
    await page.waitForFunction(() => document.querySelector('[role="switch"]')?.checked === true);
    await page.getByRole('alert').waitFor({ state: 'hidden' });
    assert.deepEqual(await actions(page), [['enabled', true], ['enabled', false], ['enabled', true]]);
    assert.equal(await page.evaluate(() => window.callSubscribers.size), 1);
  });
  await check('Home automatic help stays readable with large text and a narrow window', async () => {
    for (const [width, scale] of [[1180, 1], [760, 2], [420, 2]]) {
      await page.setViewportSize({ width, height: 850 });
      await page.evaluate(scale => {
        document.documentElement.style.setProperty('--text-scale', String(scale));
        document.documentElement.classList.toggle('enlarged-text', scale > 1);
      }, scale);
      const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
      await toggle.scrollIntoViewIfNeeded();
      const layout = await toggle.evaluate(input => {
        const card = input.closest('section');
        const bounds = card.getBoundingClientRect();
        const label = input.closest('label').getBoundingClientRect();
        return { x: bounds.x, right: bounds.right, width: innerWidth, scrollWidth: card.scrollWidth, clientWidth: card.clientWidth,
          labelHeight: label.height, texts: [...card.querySelectorAll('h2,h3,p,strong')].map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right }; }) };
      });
      assert.ok(layout.x >= -1 && layout.right <= layout.width + 1 && layout.scrollWidth <= layout.clientWidth + 1, 'Card fits the window without horizontal scrolling');
      assert.ok(layout.labelHeight >= 44, 'The click target is at least 44px high');
      for (const text of layout.texts) assert.ok(text.x >= -1 && text.right <= width + 1, 'Automatic help copy is not clipped');
      await page.screenshot({ path: `test-results/home-automatic-help-${width}-${scale}.png` });
    }
  });
  await page.close();
  page = await makePage({ delayedRead: true });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForFunction(() => !!window.finishInitial && window.callSubscribers.size === 1);
  await check('Settings subscribes before reading, newer state wins, and mounting never starts a guide or prompts', async () => {
    await page.evaluate(() => { window.emitCallHelp({ enabled: true, status: 'watching', suggestion: null }); window.finishInitial({ enabled: false, status: 'off', suggestion: null }); });
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    // The switch is visible before the asynchronous state event commits.
    await page.waitForFunction(() => document.querySelector('.call-help-toggle input')?.checked === true);
    assert.equal(await toggle.isChecked(), true);
    assert.deepEqual(await actions(page), []);
    assert.equal(await page.locator('.call-help-toggle').evaluate(element => getComputedStyle(element).flexDirection), 'row');
  });
  await check('Preference update is explicit, prevents duplicates, persists on reopen, and reports failure', async () => {
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await page.evaluate(() => { window.delaySetting = true; });
    await toggle.click(); assert.equal(await toggle.isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: /^Preview .* help$/ }).count(), 0);
    await toggle.evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await actions(page), [['enabled', false]]);
    await page.evaluate(() => window.finishSetting());
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.callSubscribers.size === 1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForFunction(() => !!window.finishInitial && window.callSubscribers.size === 1);
    await page.evaluate(() => window.finishInitial(window.callHelp));
    assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => { window.delaySetting = false; window.failSetting = true; });
    await toggle.click();
    await page.getByText('Could not update automatic help. Try again.', { exact: true }).waitFor();
    assert.equal(await toggle.isEnabled(), true); assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => { window.failSetting = false; });
    await toggle.click();
    await page.getByText('Help appears when an app opens or a FaceTime call starts.', { exact: true }).waitFor();
  });
  await check('Automatic help has one setting and no retired preview entry, lesson start or access prompt', async () => {
    assert.equal(await page.getByRole('heading', { name: 'Automatic help', exact: true }).count(), 1);
    assert.equal(await page.getByRole('switch').count(), 1);
    assert.equal(await page.getByRole('switch', { name: 'Start HelpOS when I sign in', exact: true }).count(), 0);
    await page.getByText('FaceTime, Safari, and Finder.', { exact: true }).waitFor();
    await page.getByText('FaceTime call detection needs Accessibility access.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Preview .* help$/ }).count(), 0);
    assert.equal((await actions(page)).some(call => ['preview', 'choose', 'permission'].includes(call[0])), false);
    assert.equal(await page.locator('.practice-page').count(), 0);
    await page.screenshot({ path: 'test-results/call-help-settings.png' });
  });
  await check('Approval stays unchecked and cancellable with an explicit false request', async () => {
    await page.evaluate(() => window.emitCallHelp({ enabled: false, status: 'requires-approval', suggestion: null }));
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await page.getByText('Allow automatic help in Mac Login Items.', { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await toggle.isDisabled(), true);
    assert.equal(await page.locator('.call-help-toggle strong').textContent(), 'Pending');
    const cancel = page.getByRole('button', { name: 'Cancel request', exact: true });
    const before = await actions(page);
    await page.evaluate(() => { window.delaySetting = true; });
    await cancel.click();
    assert.equal(await cancel.isDisabled(), true);
    await cancel.evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await actions(page), [...before, ['enabled', false]]);
    await page.evaluate(() => window.finishSetting());
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), false);
    assert.equal(await toggle.isEnabled(), true);
  });
  await check('Unavailable is honest and offers explicit enable with error retry and duplicate protection', async () => {
    await page.evaluate(() => { window.delaySetting = false; window.emitCallHelp({ enabled: false, status: 'unavailable', suggestion: null }); });
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await page.getByText('Mac could not read this setting.', { exact: true }).waitFor();
    assert.equal(await toggle.isDisabled(), true); assert.equal(await toggle.isChecked(), false);
    const enable = page.getByRole('button', { name: 'Enable automatic help', exact: true });
    const before = await actions(page);
    await page.evaluate(() => { window.failSetting = true; });
    await enable.click();
    await page.getByRole('alert').waitFor();
    assert.equal(await enable.isEnabled(), true); assert.equal(await toggle.isChecked(), false);
    await page.evaluate(() => { window.failSetting = false; window.delaySetting = true; });
    await enable.click();
    assert.equal(await enable.isDisabled(), true);
    await enable.evaluate(element => { element.click(); element.click(); });
    assert.deepEqual(await actions(page), [...before, ['enabled', true], ['enabled', true]]);
    await page.evaluate(() => window.finishSetting());
    await page.getByText('Help appears when an app opens or a FaceTime call starts.', { exact: true }).waitFor();
    assert.equal(await toggle.isChecked(), true);
    assert.equal((await actions(page)).some(call => call[0] === 'permission'), false);
  });
  await page.close();
  page = await makePage();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Automatic help is off.', { exact: true }).waitFor();
  await check('Returning to open Settings reads an external disable without registering or starting help', async () => {
    await page.evaluate(() => window.emitCallHelp({ enabled: true, status: 'watching', suggestion: null }));
    await page.getByText('Help appears when an app opens or a FaceTime call starts.', { exact: true }).waitFor();
    const before = await page.evaluate(() => window.callReads);
    await page.evaluate(() => { window.callHelp = { enabled: false, status: 'off', suggestion: null }; window.dispatchEvent(new Event('focus')); });
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true }).isChecked(), false);
    assert.equal(await page.evaluate(() => window.callReads), before + 1);
    assert.deepEqual(await actions(page), []);
  });
  await check('Focus skips pending writes and an older read cannot undo a response-only confirmed change', async () => {
    await page.evaluate(() => { window.delayReadNext = true; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => !!window.finishDelayedRead);
    await page.evaluate(() => { window.delaySetting = true; window.silentSetting = true; });
    const toggle = page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true });
    await toggle.click(); assert.equal(await toggle.isDisabled(), true);
    const reads = await page.evaluate(() => window.callReads);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
    assert.equal(await page.evaluate(() => window.callReads), reads);
    await page.evaluate(() => window.finishSetting());
    await page.getByText('Help appears when an app opens or a FaceTime call starts.', { exact: true }).waitFor();
    await page.evaluate(async () => { window.finishDelayedRead({ enabled: false, status: 'off', suggestion: null }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(await toggle.isChecked(), true);
    assert.deepEqual(await actions(page), [['enabled', true]]);
  });
  await check('A newer state event beats an in-flight focus read', async () => {
    const before = await page.evaluate(() => window.callReads);
    await page.evaluate(() => { window.delayReadNext = true; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(value => window.callReads === value + 1, before);
    await page.evaluate(() => window.emitCallHelp({ enabled: false, status: 'off', suggestion: null }));
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    await page.evaluate(async () => { window.finishDelayedRead({ enabled: true, status: 'watching', suggestion: null }); await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(await page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true }).isChecked(), false);
    assert.deepEqual(await actions(page), [['enabled', true]]);
  });
  await check('Focus read failure is recoverable through a later read without another write', async () => {
    await page.evaluate(() => { window.failRead = true; window.dispatchEvent(new Event('focus')); });
    await page.getByText('Could not check automatic help. Try again.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true }).isDisabled(), true);
    await page.evaluate(() => { window.failRead = false; });
    await page.getByRole('button', { name: 'Check again', exact: true }).click();
    await page.getByText('Automatic help is off.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('switch', { name: 'Show help when I open supported apps', exact: true }).isEnabled(), true);
    assert.deepEqual(await actions(page), [['enabled', true]]);
  });
  await page.close();
  page = await makePage({ card: true });
  await check('Preview card is explicit, offers exactly three guides, and does nothing until selection', async () => {
    await page.getByText('Demo preview', { exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'FaceTime help', exact: true }).count(), 1);
    assert.equal(await page.getByText('Choose a guide for your open app.', { exact: true }).count(), 1);
    assert.equal(await page.locator('[data-call-lesson]').count(), 3);
    assert.equal(await page.locator('.call-help-body > p').count(), 1);
    for (const label of ['microphone', 'camera', 'leave call']) assert.equal(await page.getByRole('button', { name: `Learn about ${label}`, exact: true }).count(), 1);
    assert.equal(await page.locator('.tutorial-scrim').count(), 0);
    assert.deepEqual(await actions(page), []);
    await fitCard(page);
    const body = await page.locator('.call-help-body').boundingBox();
    for (const id of ['facetime-mic', 'facetime-camera', 'facetime-end']) {
      const bounds = await choice(page, id).boundingBox();
      assert.ok(bounds && body && bounds.y >= body.y - 1 && bounds.y + bounds.height <= body.y + body.height + 1, `${id} must fit without scrolling at default size`);
    }
    await page.screenshot({ path: 'test-results/call-help-preview-360.png' });
  });
  await check('Each suggestion choice sends its own supported FaceTime guide ID', async () => {
    for (const id of ['facetime-mic', 'facetime-camera', 'facetime-end']) {
      await choice(page, id).click();
      assert.deepEqual((await actions(page)).at(-1), ['choose', id]);
    }
  });
  await check('Choice failure is recoverable; Not now can dismiss a pending choice and stale failure stays hidden', async () => {
    await page.evaluate(() => { window.failChoice = true; });
    await choice(page, 'facetime-end').click();
    await page.getByRole('alert').waitFor();
    await fitCard(page);
    assert.equal(await choice(page, 'facetime-end').isEnabled(), true);
    await page.evaluate(() => { window.failChoice = false; window.delayChoice = true; });
    await choice(page, 'facetime-mic').click();
    assert.equal(await choice(page, 'facetime-camera').isDisabled(), true);
    await fitCard(page);
    assert.equal(await page.getByRole('button', { name: 'Not now', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Close FaceTime help', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: 'Not now', exact: true }).click();
    await page.evaluate(() => window.rejectChoice());
    await page.getByText('No help right now.', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-call-lesson]').count(), 0);
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.deepEqual((await actions(page)).filter(call => call[0] === 'dismiss'), [['dismiss']]);
  });
  await check('Detected offer is labeled, Escape dismisses, and turning offers off never starts a lesson', async () => {
    await page.evaluate(() => window.emitCallHelp({ enabled: true, status: 'watching', suggestion: { id: 'detected-2', source: 'detected' } }));
    await page.getByText('FaceTime call detected', { exact: true }).waitFor();
    assert.equal(await page.getByText('For FaceTime calls.', { exact: true }).count(), 1);
    await page.keyboard.press('Escape');
    await page.getByText('No help right now.', { exact: true }).waitFor();
    await page.evaluate(() => window.emitCallHelp({ enabled: true, status: 'watching', suggestion: { id: 'detected-3', source: 'detected' } }));
    const before = (await actions(page)).filter(call => call[0] === 'choose').length;
    await page.getByRole('button', { name: 'Turn off automatic help', exact: true }).click();
    await page.getByRole('button', { name: 'Automatic help is off', exact: true }).waitFor();
    assert.equal((await actions(page)).filter(call => call[0] === 'choose').length, before);
    assert.deepEqual((await actions(page)).at(-1), ['enabled', false]);
  });
  await check('At 200% the complete popup fits without any scrolling', async () => {
    await page.evaluate(() => { window.emitCallHelp({ enabled: true, status: 'watching', suggestion: { id: 'preview-large', source: 'preview' } }); localStorage.setItem('helpos:text-scale', '2'); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: '2' })); });
    await page.setViewportSize({ width: 720, height: 680 });
    await page.waitForFunction(() => window.calls.some(call => call[0] === 'scale' && call[1] === 2));
    await fitCard(page);
    for (const id of ['facetime-mic', 'facetime-camera', 'facetime-end']) {
      const target = choice(page, id);
      const bounds = await target.boundingBox();
      const body = await page.locator('.call-help-body').boundingBox();
      assert.ok(bounds && body && bounds.y >= body.y - 1 && bounds.y + bounds.height <= body.y + body.height + 1, `${id} must be fully visible without scrolling`);
    }
    for (const name of ['Not now', 'Turn off automatic help', 'Close FaceTime help']) {
      const bounds = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 680, `${name} stays visible`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await page.getByText('Demo preview', { exact: true }).isVisible(), true);
    await page.screenshot({ path: 'test-results/call-help-preview-200.png' });
    await page.setViewportSize({ width: 540, height: 600 });
    await fitCard(page, 600);
    await page.screenshot({ path: 'test-results/call-help-preview-200-clamped.png' });
    await page.getByRole('button', { name: 'Close FaceTime help', exact: true }).click();
  });
  await page.close();
  for (const [app, name, ids] of [['facetime', 'FaceTime', ['facetime-mic', 'facetime-camera', 'facetime-end']], ['safari', 'Safari', ['safari-zoom', 'safari-reader', 'safari-bookmark', 'safari-reopen-tab']], ['finder', 'Finder', ['finder-downloads']]]) {
    page = await makePage({ card: true, app, source: 'activation' });
    await check(`${name} activation shows only matching guides, with no call claim, prompt, or automatic start`, async () => {
      await page.getByRole('heading', { name: `${name} help`, exact: true }).waitFor();
      assert.equal(await page.locator('.call-help-chip').textContent(), 'Choose a guide');
      assert.equal(await page.getByText('FaceTime call detected', { exact: true }).count(), 0);
      assert.deepEqual(await page.locator('[data-call-lesson]').evaluateAll(elements => elements.map(el => el.dataset.callLesson)), ids);
      assert.deepEqual(await actions(page), []);
      assert.equal(await page.locator('.tutorial-scrim').count(), 0);
      if (app === 'facetime') await page.getByText('For FaceTime calls.', { exact: true }).waitFor();
      for (const id of ids) {
        await choice(page, id).click();
        assert.deepEqual((await actions(page)).at(-1), ['choose', id]);
      }
      for (const [scale, width, max] of [[1, 360, 600], [2, 720, 680], [2, 540, 600]]) {
        await page.evaluate(value => { localStorage.setItem('helpos:text-scale', String(value)); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: String(value) })); }, scale);
        await page.setViewportSize({ width, height: max });
        await page.waitForFunction(value => window.calls.some(call => call[0] === 'scale' && call[1] === value), scale);
        await fitCard(page, max);
        await page.screenshot({ path: `test-results/app-help-${app}-${scale}-${width}.png` });
      }
      await page.getByRole('button', { name: `Close ${name} help`, exact: true }).click();
      assert.equal((await actions(page)).filter(call => call[0] === 'dismiss').length, 1);
    });
    await page.close();
    page = await makePage({ card: true, app, source: 'preview' });
    await check(`${name} internal preview stays labeled and does not promise a Practice scene`, async () => {
      await page.getByText('Demo preview', { exact: true }).waitFor();
      await page.getByText('Choose a guide for your open app.', { exact: true }).waitFor();
      assert.deepEqual(await page.locator('[data-call-lesson]').evaluateAll(elements => elements.map(el => el.dataset.callLesson)), ids);
      await fitCard(page);
      assert.deepEqual(await actions(page), []);
    });
    if (app === 'safari') await check('Four Safari preview guides, pending choice, and retry fit every supported text size without scrolling', async () => {
      for (const [scale, width, maximum] of [[1, 360, 600], [1.25, 450, 600], [1.5, 540, 600], [2, 720, 680], [2, 540, 600]]) {
        await page.evaluate(value => { localStorage.setItem('helpos:text-scale', String(value)); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: String(value) })); }, scale);
        await page.setViewportSize({ width, height: maximum });
        await page.waitForFunction(value => window.calls.some(call => call[0] === 'scale' && call[1] === value), scale);
        await fitCard(page, maximum);
        assert.equal(await page.locator('[data-call-lesson]').count(), 4);
        await page.getByText('Choose a guide for your open app.', { exact: true }).waitFor();
        await page.screenshot({ path: `test-results/safari-help-preview-${scale}-${width}.png` });
      }
      await page.evaluate(() => { window.failChoice = true; });
      await choice(page, 'safari-reader').click();
      await page.getByRole('alert').waitFor();
      await fitCard(page, 600);
      await page.screenshot({ path: 'test-results/safari-help-retry-200-540.png' });
      await page.evaluate(() => { window.failChoice = false; window.delayChoice = true; });
      await choice(page, 'safari-bookmark').click();
      await page.getByRole('status').waitFor();
      await fitCard(page, 600);
      assert.equal(await page.getByRole('button', { name: 'Not now', exact: true }).isEnabled(), true);
      await page.getByRole('button', { name: 'Not now', exact: true }).click();
      await page.evaluate(() => window.finishChoice());
      await page.getByText('No help right now.', { exact: true }).waitFor();
    });
    await page.close();
  }
  for (const id of ['facetime-mic', 'facetime-camera', 'facetime-end', 'safari-zoom', 'safari-reader', 'safari-bookmark', 'safari-reopen-tab', 'finder-downloads']) {
    page = await makePage();
    await check(`Retired Practice hash ${id} returns the current Home without starting a guide`, async () => {
      await page.goto(`${baseURL}/#practice/${id}`);
      await page.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
      assert.equal(await page.locator('.practice-page, .context-banner, .tutorial-scrim').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Open voice guide', exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: /Practice/ }).count(), 0);
      assert.deepEqual(await actions(page), []);
    });
    await page.close();
  }
  page = await makePage();
  await check('Unsupported preview hashes do not select or start a lesson', async () => {
    await page.goto(`${baseURL}/#practice/unsupported-lesson`);
    await page.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
    assert.equal(await page.locator('.practice-page').count(), 0);
    assert.deepEqual(await actions(page), []);
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-call-suggestion-results.json', JSON.stringify({ environment: 'Isolated browser with bridge stubs and simulated native height resizing; does not register the app watcher or validate actual app activation, scheduling or native placement', passed: results.length, results, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'test-results/call-help-failure.png', fullPage: true });
  await writeFile('test-results/ui-call-suggestion-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
