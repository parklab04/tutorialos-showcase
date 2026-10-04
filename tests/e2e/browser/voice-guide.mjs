import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated bridge fixtures: no real microphone, recognition, OS actions or clicks.
const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const results = [];
const errors = [];
const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
const makePage = async (route = 'voice', scale = 1, width = 420) => {
  const page = await browser.newPage({ viewport: { width, height: 850 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ scale }) => {
    localStorage.setItem('helpos:text-scale', String(scale));
    window.calls = [];
    window.voiceSubscribers = new Set(); window.liveSubscribers = new Set();
    window.voiceState = { phase: 'idle', transcript: '', message: '', goal: null, shortcut: 'Control+Option+Space', shortcutAvailable: true };
    window.liveState = { sessionId: '', lessonId: null, status: 'idle', stepIndex: 0, title: '', message: '', why: '', target: null, observationSource: 'none', verification: null, canComplete: false, permission: { accessibility: true, screenCapture: true } };
    window.emitVoice = value => { window.voiceState = value; for (const callback of window.voiceSubscribers) callback(value); };
    window.emitLive = value => { window.liveState = { ...value, coachLayoutId: value.coachLayoutId ?? 'voice-fixture' }; for (const callback of window.liveSubscribers) callback(window.liveState); };
    window.helpOS = {
      getStatus: async () => ({ desktop: true, platform: 'darwin', accessibility: true, screenCapture: true, aiConfigured: false, version: 'test' }),
      getLiveState: async () => structuredClone(window.liveState), onLiveState: callback => { window.liveSubscribers.add(callback); return () => window.liveSubscribers.delete(callback); },
      getVoiceState: async () => structuredClone(window.voiceState), onVoiceState: callback => { window.voiceSubscribers.add(callback); return () => window.voiceSubscribers.delete(callback); },
      showVoice: async () => window.calls.push(['show-voice']),
      startVoice: () => { window.calls.push(['record']); window.emitVoice({ ...window.voiceState, phase: 'listening', transcript: '', goal: null }); return window.delayRecord ? new Promise((resolve, reject) => { window.finishRecord = resolve; window.failRecord = () => reject(new Error('Late start error')); }) : Promise.resolve(window.voiceState); },
      stopVoice: async () => { window.calls.push(['stop-recording']); window.emitVoice({ ...window.voiceState, phase: 'processing' }); return window.voiceState; },
      cancelVoice: async () => { window.calls.push(['cancel-voice']); window.emitVoice({ ...window.voiceState, phase: 'idle', transcript: '', message: '', goal: null }); return window.voiceState; },
      submitVoiceText: async text => { window.calls.push(['review', text]); window.emitVoice({ ...window.voiceState, phase: 'review', transcript: text, goal: { id: 'mute', label: 'Mute microphone', app: 'facetime' } }); return window.voiceState; },
      useVoiceGoal: () => { window.calls.push(['use-voice-goal']); return window.delayShow ? new Promise(resolve => { window.finishShow = resolve; }) : Promise.resolve(); },
      reportVoiceHeight: async height => { window.voiceHeight = height; },
      reportVoiceScale: async scale => { window.voiceScale = scale; },
      reportCoachHeight: async height => { window.coachHeight = height; }, reportCoachScale: async () => {},
      startGoal: async id => { window.calls.push(['start-goal', id]); return window.liveState; },
      startLive: async id => { window.calls.push(['start-live', id]); return window.liveState; },
      stopLive: async () => { window.calls.push(['close-guide']); window.emitLive({ ...window.liveState, status: 'idle', target: null }); },
      completeGoal: () => { window.calls.push(['complete-goal']); return window.delayComplete ? new Promise(resolve => { window.finishComplete = resolve; }) : Promise.resolve(); },
      retryLive: async () => window.calls.push(['retry']), pauseLive: async () => window.calls.push(['pause']), resumeLive: async () => window.calls.push(['resume']),
      requestPermission: async kind => { window.calls.push(['permission', kind]); return { granted: false, settingsOpened: false }; },
    };
  }, { scale });
  await page.goto(`${baseURL}/${route ? '#' + route : ''}`);
  return page;
};
const calls = page => page.evaluate(() => window.calls);
const setVoice = (page, patch) => page.evaluate(value => window.emitVoice({ ...window.voiceState, ...value }), patch);
const setGoal = (page, patch = {}) => page.evaluate(value => window.emitLive({ ...window.liveState, sessionId: 'goal-1', lessonId: 'facetime-mic', status: 'guiding', currentAction: 'mic-toggle', title: 'Mute microphone', message: 'Click the microphone to change its setting.', why: 'Choose Complete when your microphone is muted.', target: { x: 800, y: 500, width: 50, height: 50 }, goal: { id: 'mute', label: 'Mute microphone', app: 'facetime' }, completionMode: 'manual', canComplete: true, ...value }), patch);
const fit = async (page, kind, maxHeight = 850) => {
  const content = kind === 'voice' ? '.voice-panel-content' : '.live-coach-content';
  const property = kind === 'voice' ? 'voiceHeight' : 'coachHeight';
  await page.waitForFunction(({ content, property, kind }) => {
    const el = document.querySelector(content); if (!el) return false;
    const shell = getComputedStyle(el.parentElement);
    const spacing = kind === 'coach' ? [shell.borderTopWidth, shell.borderBottomWidth, shell.marginTop, shell.marginBottom].reduce((sum, value) => sum + (parseFloat(value) || 0), 0) : 14;
    return Math.abs(window[property] - Math.ceil(el.getBoundingClientRect().height + spacing)) <= 1;
  }, { content, property, kind });
  const height = await page.evaluate(property => window[property], property);
  assert.ok(height <= maxHeight, `${kind} height ${height} must fit ${maxHeight}`);
  await page.setViewportSize({ width: page.viewportSize().width, height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const boxes = await page.locator(`${content} button, ${content} input, ${content} h1, ${content} h2, ${content} p, ${content} kbd`).evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { label: el.textContent || el.getAttribute('placeholder'), x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight }; }));
  for (const box of boxes) assert.ok(box.x >= -1 && box.y >= -1 && box.right <= box.width + 1 && box.bottom <= box.height + 1, `${box.label} fits without scrolling`);
  assert.equal(await page.locator(content).evaluate(el => ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)), false);
};
let page;
try {
  page = await makePage('', 1, 1180);
  await check('Home is live-only and opens voice without recording or starting a guide', async () => {
    await page.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
    assert.equal(await page.getByText(/Practice/).count(), 0);
    assert.equal(await page.locator('.mode-picker, .practice-page').count(), 0);
    assert.deepEqual(await calls(page), []);
    await page.getByRole('button', { name: 'Open voice guide', exact: true }).click();
    assert.deepEqual(await calls(page), [['show-voice']]);
    await page.screenshot({ path: 'test-results/voice-home.png' });
  });
  await check('Direct commands choose the five distinct manual goals', async () => {
    for (const [name, id] of [['Mute microphone FaceTime', 'mute'], ['Unmute microphone FaceTime', 'unmute'], ['Turn camera off FaceTime', 'camera-off'], ['Turn camera on FaceTime', 'camera-on'], ['Make text larger Safari', 'zoom-in']]) {
      await page.getByRole('button', { name, exact: true }).click();
      assert.deepEqual((await calls(page)).at(-1), ['start-goal', id]);
    }
    await page.goto(`${baseURL}/#practice/facetime-mic`);
    await page.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
    assert.equal(await page.locator('.practice-page').count(), 0);
  });
  await page.close(); page = await makePage();
  await check('Voice panel never starts recording on mount and always offers explicit controls plus typing', async () => {
    await page.getByRole('heading', { name: 'Voice guide', exact: true }).waitFor();
    assert.deepEqual(await calls(page), []);
    assert.equal(await page.getByRole('button', { name: 'Record', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('Or type a command', { exact: true }).isEnabled(), true);
    await fit(page, 'voice', 680);
    await page.screenshot({ path: 'test-results/voice-idle.png' });
  });
  await check('Record and Stop are explicit, with no guide started from a transcript', async () => {
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByText('Listening… speak your command.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Stop', exact: true }).isEnabled(), true);
    assert.equal(await page.getByLabel('Or type a command', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByText('Checking your command…', { exact: true }).waitFor();
    await setVoice(page, { phase: 'review', transcript: 'mute my microphone', goal: { id: 'mute', label: 'Mute microphone', app: 'facetime' } });
    await page.getByRole('button', { name: 'Show me', exact: true }).waitFor();
    assert.deepEqual(await calls(page), [['record'], ['stop-recording']]);
  });
  await check('Editing a recognized command requires a fresh review before Show me', async () => {
    await page.getByLabel('Or type a command', { exact: true }).fill('Please mute my microphone');
    assert.equal(await page.getByRole('button', { name: 'Show me', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Review command', exact: true }).click();
    assert.deepEqual((await calls(page)).at(-1), ['review', 'Please mute my microphone']);
    await page.getByRole('button', { name: 'Show me', exact: true }).waitFor();
    await page.evaluate(() => { window.delayShow = true; });
    await page.getByRole('button', { name: 'Show me', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Show me', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Show me', exact: true }).evaluate(el => { el.click(); el.click(); });
    assert.equal((await calls(page)).filter(call => call[0] === 'use-voice-goal').length, 1);
    await page.evaluate(() => window.finishShow());
  });
  await check('Cancel remains usable during pending recognition and ignores its late failure', async () => {
    await setVoice(page, { phase: 'idle', transcript: '', goal: null });
    await page.evaluate(() => { window.delayRecord = true; });
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => window.failRecord());
    await page.getByText('Say “mute my microphone.”', { exact: true }).waitFor();
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Record', exact: true }).isEnabled(), true);
    await page.keyboard.press('Escape');
    assert.equal((await calls(page)).filter(call => call[0] === 'cancel-voice').length, 2);
  });
  await check('Voice errors keep typed fallback and retry available without permission loops', async () => {
    await setVoice(page, { phase: 'error', transcript: '', goal: null, message: 'On-device speech is unavailable. Type a command instead.' });
    await page.getByRole('alert').waitFor();
    assert.equal(await page.getByLabel('Or type a command', { exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Record', exact: true }).isEnabled(), true);
    assert.equal((await calls(page)).some(call => call[0] === 'permission'), false);
    await fit(page, 'voice', 680);
  });
  await page.close();
  page = await makePage('voice', 2, 480);
  await check('Voice review at 200 percent keeps every control visible without inner scrolling', async () => {
    await setVoice(page, { phase: 'review', transcript: 'Turn my camera off', goal: { id: 'camera-off', label: 'Turn camera off', app: 'facetime' } });
    await page.getByRole('button', { name: 'Show me', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Review command', exact: true }).count(), 0);
    await fit(page, 'voice', 740);
    await page.screenshot({ path: 'test-results/voice-review-200.png' });
  });
  await check('Large voice text reports its scale and a long permission error fits the wider panel', async () => {
    await page.waitForFunction(() => window.voiceScale === 2);
    await page.setViewportSize({ width: 720, height: 780 });
    await setVoice(page, { phase: 'error', transcript: '', goal: null, message: 'Allow HelpOS in Mac Settings → Privacy & Security → Speech Recognition, then try again.' });
    await page.getByRole('alert').waitFor();
    await fit(page, 'voice', 740);
    assert.equal(await page.getByLabel('Or type a command', { exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), true);
    await page.screenshot({ path: 'test-results/voice-error-200.png' });
  });
  await page.close(); page = await makePage('coach', 1, 360);
  await check('Compact goal bubble preserves requested result and never auto-completes', async () => {
    await setGoal(page);
    await page.getByRole('heading', { name: 'Click microphone', exact: true }).waitFor();
    await page.getByText('Microphone muted?', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-presentation="companion"]').count(), 1);
    assert.equal(await page.getByRole('tablist').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).isEnabled(), true);
    assert.deepEqual(await calls(page), []);
    await setGoal(page, { status: 'waiting-control', title: 'Show call buttons', message: 'Move pointer over FaceTime', target: null, why: '' });
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).isEnabled(), true);
    assert.deepEqual(await calls(page), []);
  });
  await check('Complete is explicit, suppresses double submission, and Close help remains independent', async () => {
    await page.evaluate(() => { window.delayComplete = true; });
    await page.getByRole('button', { name: 'Complete', exact: true }).click();
    await page.getByRole('button', { name: 'Closing…', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Closing…', exact: true }).evaluate(el => { el.click(); el.click(); });
    assert.equal((await calls(page)).filter(call => call[0] === 'complete-goal').length, 1);
    await page.getByRole('button', { name: 'Close help', exact: true }).click();
    await page.evaluate(() => window.finishComplete());
    assert.deepEqual(await calls(page), [['complete-goal'], ['close-guide']]);
  });
  await check('Goal completion cannot be enabled by missing evidence or permission', async () => {
    for (const patch of [{ status: 'observing', title: 'Finding button', target: null, canComplete: false }, { status: 'permission', title: 'Allow access', target: null, canComplete: false, permission: { accessibility: false, screenCapture: false } }, { status: 'paused', target: null, canComplete: false }]) {
      await setGoal(page, { sessionId: JSON.stringify(patch), ...patch });
      await page.getByRole('button', { name: 'Complete', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isEnabled(), true);
    }
  });
  await page.close(); page = await makePage('coach', 2, 540);
  await check('Manual goal at 200 percent shows complete instructions and completion controls without scrolling', async () => {
    await setGoal(page, { sessionId: 'large-goal' });
    await page.getByRole('heading', { name: 'Click microphone', exact: true }).waitFor();
    await fit(page, 'coach', 850);
    await page.screenshot({ path: 'test-results/voice-goal-coach-200.png' });
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-voice-guide-results.json', JSON.stringify({ environment: 'Isolated browser bridge fixtures; no real recognition, microphone use, app actions, or native window closure', passed: results.length, results, errors }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: 'test-results/voice-guide-failure.png', fullPage: true });
  await writeFile('test-results/ui-voice-guide-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
