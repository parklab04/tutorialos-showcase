const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 340, height: 600 } });
const errors = [], results = [];
page.on('pageerror', error => errors.push(error.message));
const base = { sessionId: 'initial', lessonId: 'facetime-mic', status: 'guiding', currentAction: 'mic-off', stepIndex: 0, title: 'Mute your microphone', message: 'Click the highlighted microphone button.', why: 'This long native explanation must not appear in the icon coach.', target: { x: 10, y: 10, width: 40, height: 40 }, observationSource: 'accessibility', verification: null, permission: { accessibility: true, screenCapture: false }, canConfirm: false };
const zoom = { lessonId: 'safari-zoom', currentAction: 'zoom-in', stepIndex: 1, title: 'Click Zoom In', message: 'Click “Zoom In” in the open menu.', why: '' };
const manualZoom = { ...zoom, completionMode: 'manual', goal: { id: 'zoom-in', label: 'Make text larger', app: 'safari' }, canComplete: true, why: 'Choose Complete when the text is large enough.' };
const zoomShortcuts = ['Zoom in: Command and Plus', 'Zoom out: Command and Minus'];
await page.addInitScript(initial => {
  window.calls = []; window.testState = { ...initial, coachLayoutId: 'fixture-initial' }; window.layoutSequence = 0;
  window.permissionResult = { granted: false, settingsOpened: true };
  window.helpOS = {
    getLiveState: async () => window.testState,
    reportCoachScale: async scale => window.calls.push(['scale', scale]),
    reportCoachHeight: async (height, layoutId) => {
      if (!layoutId) throw new Error('A native height report requires a layout ID');
      window.coachHeight = height; window.calls.push(['height', height, layoutId]);
      if (window.delayHeight) return new Promise((_resolve, reject) => { window.rejectHeight = () => reject(new Error('Old layout failed')); });
    },
    onLiveState: callback => { window.updateState = value => {
      window.testState = { ...value, coachLayoutId: Object.hasOwn(value, 'coachLayoutId') ? value.coachLayoutId : `fixture-layout-${++window.layoutSequence}` };
      callback(window.testState);
    }; return () => {}; },
    switchLiveLesson: async id => {
      window.calls.push(['switch', id]);
      if (window.delaySwitch) await new Promise((resolve, reject) => { window.finishSwitch = resolve; window.rejectSwitch = () => reject(new Error('Simulated failure')); });
      const next = { ...window.testState, sessionId: `switch-${id}-${Date.now()}`, lessonId: id, currentAction: id === 'facetime-camera' ? 'camera-off' : id === 'facetime-end' ? 'end-call' : 'mic-off', status: 'guiding', stepIndex: 0, verification: null, canConfirm: false };
      window.updateState(next); return next;
    },
    stopLive: async () => window.calls.push(['stop']),
    pauseLive: async () => { window.calls.push(['pause']); window.updateState({ ...window.testState, status: 'paused' }); },
    resumeLive: async () => { window.calls.push(['resume']); window.updateState({ ...window.testState, status: 'guiding' }); },
    retryLive: async () => { window.calls.push(['retry']); if (window.accessGranted || window.permissionResult.granted) window.updateState({ ...window.testState, status: 'guiding', permission: { accessibility: true, screenCapture: false } }); },
    getStatus: async () => { window.calls.push(['get-status']); if (window.delayStatus) return new Promise(resolve => { window.finishStatus = resolve; }); return { accessibility: !!window.accessGranted }; },
    confirmLive: async () => window.calls.push(['confirm']),
    completeGoal: async () => {
      window.calls.push(['complete-goal']);
      if (window.delayComplete) await new Promise(resolve => { window.finishComplete = resolve; });
      window.updateState({ ...window.testState, status: 'complete', title: 'Complete', message: 'You marked this request complete.', why: '', target: null, canComplete: false, verification: 'self-confirmed' });
    },
    showHome: async mode => window.calls.push(['home', mode]),
    requestPermission: async kind => {
      window.calls.push(['permission', kind]); window.updateState({ ...window.testState, status: 'paused' });
      if (window.delayPermission) await new Promise(resolve => { window.finishPermission = resolve; });
      if (window.failPermission) throw new Error('Simulated permission failure');
      return window.permissionResult;
    },
    showAppInFinder: async () => window.calls.push(['show-app']),
  };
}, base);
const meaningful = () => page.evaluate(() => window.calls.filter(([type]) => !['height', 'scale'].includes(type)));
let sequence = 0;
const show = async (value, heading) => {
  await page.evaluate(state => window.updateState(state), { ...base, ...value, sessionId: `sample-${++sequence}` });
  await page.getByRole('heading', { name: heading, exact: true }).waitFor();
};
const shortcuts = async (names = []) => {
  const note = page.getByRole('complementary', { name: 'Keyboard alternative', exact: true });
  await note.waitFor({ state: names.length ? 'visible' : 'hidden' });
  if (!names.length) return;
  for (const name of names) await note.getByRole('group', { name, exact: true }).waitFor();
  assert.equal(await note.locator('.live-shortcut-row').count(), names.length);
  assert.equal(await note.locator('button, a, input, [tabindex]').count(), 0, 'Shortcut hints are readable text, not extra controls');
};
const fit = async (maximumHeight = 740) => {
  await page.waitForFunction(() => {
    const content = document.querySelector('.live-coach-content');
    if (!content) return false;
    const shell = getComputedStyle(content.parentElement);
    const spacing = [shell.borderTopWidth, shell.borderBottomWidth, shell.marginTop, shell.marginBottom].reduce((sum, value) => sum + (parseFloat(value) || 0), 0);
    return Math.abs(window.coachHeight - Math.ceil(content.getBoundingClientRect().height + spacing)) <= 1;
  });
  const natural = await page.evaluate(() => window.coachHeight);
  assert.ok(Number.isFinite(natural) && natural > 0 && natural <= maximumHeight, `Natural height ${natural} exceeds ${maximumHeight}`);
  await page.setViewportSize({ width: page.viewportSize().width, height: Math.max(280, natural) });
  const boxes = await page.evaluate(() => {
    const selectors = ['.native-coach', '.native-coach-body', '.native-coach-footer', '.live-coach-content'];
    return {
      width: innerWidth, height: innerHeight,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1,
      containers: [...selectors.map(selector => document.querySelector(selector)), ...document.querySelectorAll('.live-shortcut-note, .live-shortcut-row, .live-shortcut-keys')].map(el => ({ selector: el.className, scrollHeight: el.scrollHeight, height: el.clientHeight, scrollWidth: el.scrollWidth, width: el.clientWidth, overflowY: getComputedStyle(el).overflowY })),
      targets: [...document.querySelectorAll('.native-coach h2, .native-coach p, .native-coach button, .live-action-icon, .live-control-tab svg, .live-control-tab span, .live-shortcut-row, .live-shortcut-keys kbd')].filter(el => el.getClientRects().length && !el.closest('details:not([open])')).map(el => { const r = el.getBoundingClientRect(); return { label: el.textContent || 'icon', x: r.x, y: r.y, width: r.width, height: r.height }; }),
    };
  });
  assert.ok(boxes.documentFits, 'Document must not scroll');
  for (const box of boxes.containers) {
    assert.ok(box.scrollHeight <= box.height + 1 && box.scrollWidth <= box.width + 1, `${box.selector} has clipped or scrolling content`);
    assert.equal(['auto', 'scroll'].includes(box.overflowY), false, `${box.selector} must not scroll`);
  }
  for (const box of boxes.targets) assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= boxes.width + 1 && box.y + box.height <= boxes.height + 1, `${box.label} must fit without scrolling`);
  const tabFits = await page.locator('.live-control-tab:visible').evaluateAll(elements => elements.every(el => [...el.children].every(child => { const inner = child.getBoundingClientRect(); const outer = el.getBoundingClientRect(); return inner.x >= outer.x - 1 && inner.right <= outer.right + 1; })));
  assert.ok(tabFits, 'Every tab icon and word must stay inside its own button');
  // Let the compositor finish the resized native-window fixture before capture.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return natural;
};
const check = async (name, run) => { await run(); results.push(name); console.log('PASS', name); };
const openGuides = async () => {
  if (!(await page.locator('.companion-guides').getAttribute('open'))) {
    if (await page.locator('.companion-guides').evaluate(el => !el.open)) await page.getByText('Guides', { exact: true }).click();
  }
};
try {
  await page.goto(`${baseURL}/#coach`);
  await page.getByRole('heading', { name: 'Click to mute', exact: true }).waitFor();
  await check('One compact instruction bubble with reachable controls and optional Guides', async () => {
    assert.equal(await page.locator('[data-presentation="companion"]').count(), 1);
    assert.equal(await page.locator('.native-coach-header, .live-action-icon').count(), 0);
    assert.equal(await page.getByText('Click the outlined button in FaceTime.', { exact: true }).count(), 0);
    assert.equal(await page.getByText(base.why, { exact: true }).count(), 0);
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.equal(await page.getByText('FaceTime · Click guide', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).innerText(), 'Close help');
    await openGuides();
    for (const name of ['Microphone guide', 'Camera guide', 'End call guide']) assert.equal(await page.getByRole('tab', { name, exact: true }).count(), 1);
    await page.getByText('Guides', { exact: true }).click();
    await shortcuts();
    assert.deepEqual(await meaningful(), []); await fit();
    await page.screenshot({ path: 'test-results/coach-no-scroll-default.png' });
  });
  await check('Height reports require a layout ID, remeasure equal-size layouts, and ignore superseded failures', async () => {
    const heightCalls = () => page.evaluate(() => window.calls.filter(([type]) => type === 'height'));
    const initialCalls = await heightCalls();
    assert.ok(initialCalls.length && initialCalls.every(call => typeof call[2] === 'string' && call[2].length));
    await show({ coachLayoutId: undefined }, 'Click to mute');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await heightCalls(), initialCalls, 'No native report before a layout identity is supplied');
    await page.evaluate(() => { window.delayHeight = true; window.updateState({ ...window.testState, coachLayoutId: 'held-layout' }); });
    await page.waitForFunction(() => !!window.rejectHeight);
    const heldHeight = (await heightCalls()).at(-1)[1];
    await page.evaluate(() => { window.delayHeight = false; window.updateState({ ...window.testState, coachLayoutId: 'replacement-layout' }); });
    await page.waitForFunction(() => window.calls.some(call => call[0] === 'height' && call[2] === 'replacement-layout'));
    assert.equal((await heightCalls()).at(-1)[1], heldHeight, 'A new ID reports even if content height is identical');
    await page.evaluate(() => window.rejectHeight());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('heading', { name: 'Try again', exact: true }).count(), 0);
    assert.equal(await page.locator('[data-presentation="companion"]').count(), 1);
  });
  const cases = [
    [{ currentAction: 'mic-on' }, 'Click to unmute'],
    [{ lessonId: 'facetime-camera', currentAction: 'camera-off' }, 'Turn camera off'],
    [{ lessonId: 'facetime-camera', currentAction: 'camera-on' }, 'Turn camera on'],
    [{ lessonId: 'facetime-end', currentAction: 'end-call' }, 'Click to leave'],
    [{ status: 'paused' }, 'Paused'],
    [{ status: 'complete', verification: 'observed' }, 'Done'],
    [{ status: 'waiting-control', title: 'The camera button is covered.' }, 'Move a window'],
    [{ status: 'waiting-control', title: 'Reveal call buttons' }, 'Reveal call buttons'],
    [{ status: 'waiting-control', title: 'HelpOS could not confirm the button state.' }, 'Button state unclear'],
    [{ status: 'waiting-control', title: 'Move the FaceTime window', message: 'Make room for help.' }, 'Move FaceTime'],
    [{ status: 'waiting-app' }, 'Show your call'],
    [{ status: 'error' }, 'Try again'],
    [{ status: 'permission', permission: { accessibility: false, screenCapture: false } }, 'Allow Accessibility'],
    [{ status: 'observing' }, 'Finding button'],
    [{ lessonId: 'safari-zoom', status: 'waiting-control', canConfirm: true }, 'Text larger?'],
    [zoom, 'Click Zoom In', zoomShortcuts],
    [manualZoom, 'Click Zoom In', zoomShortcuts],
    [{ lessonId: 'safari-reader', currentAction: 'show-reader', stepIndex: 1 }, 'Click Show Reader', ['Show Reader: Shift and Command and R']],
    [{ lessonId: 'safari-bookmark', currentAction: 'add-bookmark', stepIndex: 1 }, 'Click Add Bookmark', ['Add a bookmark: Command and D']],
    [{ lessonId: 'safari-reopen-tab', currentAction: 'reopen-closed-tab', stepIndex: 1 }, 'Reopen the tab', ['Reopen the tab: Shift and Command and T']],
    [{ lessonId: 'safari-zoom', status: 'waiting-control', currentAction: 'open-view-menu', stepIndex: 0, title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.', why: '', target: null, canConfirm: false }, 'Zoom In is unavailable'],
    [{ lessonId: 'finder-downloads', currentAction: 'open-downloads' }, 'Click Downloads', ['Open Downloads: Option and Command and L']],
  ];
  for (const [scale, width, maxHeight] of [[1, 320, 600], [2, 640, 740], [2, 540, 600]]) {
    await check(`${cases.length} states without scroll at ${scale * 100}% and ${width}px`, async () => {
      await page.setViewportSize({ width, height: maxHeight });
      await page.evaluate(value => { localStorage.setItem('helpos:text-scale', String(value)); window.dispatchEvent(new StorageEvent('storage', { key: 'helpos:text-scale', newValue: String(value) })); }, scale);
      await page.waitForFunction(value => Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - value * 16) < .1, scale);
      for (const [value, heading, hintNames] of cases) {
        await show(value, heading);
        await shortcuts(hintNames);
        if (value.message === 'Make room for help.') assert.equal(await page.getByText('Make room for help.', { exact: true }).count(), 1);
        if (['waiting-app', 'waiting-control'].includes(value.status) && !value.lessonId) {
          assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
        }
        if (heading === 'Zoom In is unavailable') {
          assert.equal(await page.getByText('Try another webpage, then open View.', { exact: true }).count(), 1);
          assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isVisible(), true);
          assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isVisible(), true);
        }
        await fit(maxHeight);
        if ((scale === 1 && width === 320) || (scale === 2 && width === 640)) {
          if (value.completionMode === 'manual') await page.screenshot({ path: `test-results/companion-goal-${scale * 100}.png` });
          if (value.status === 'permission') await page.screenshot({ path: `test-results/companion-recovery-${scale * 100}.png` });
        }
        if (heading === 'Reveal call buttons') await page.screenshot({ path: `test-results/coach-reveal-auto-${scale * 100}-${width}.png` });
        if (heading === 'Button state unclear') await page.screenshot({ path: `test-results/coach-ambiguous-auto-${scale * 100}-${width}.png` });
        if (heading === 'Zoom In is unavailable') {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await page.screenshot({ path: `test-results/coach-safari-zoom-unavailable-${scale * 100}-${width}.png` });
        }
        if (hintNames && ['Click Zoom In', 'Click Zoom In', 'Click Downloads'].includes(heading)) {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const label = heading === 'Click Zoom In' ? 'zoom-legacy' : heading === 'Click Zoom In' ? 'zoom-manual' : 'downloads-three-keys';
          await page.screenshot({ path: `test-results/coach-shortcut-${label}-${scale * 100}-${width}.png` });
        }
      }
      await show({ lessonId: 'facetime-camera', currentAction: 'camera-off' }, 'Turn camera off'); await fit(maxHeight);
      await page.screenshot({ path: `test-results/coach-no-scroll-${scale * 100}-${width}.png` });
    });
  }
  await check('Shortcut hints are suppressed before commands and whenever click guidance is unavailable', async () => {
    const hiddenCases = [
      [{ ...zoom, currentAction: 'open-view-menu', stepIndex: 0 }, 'Click View'],
      [{ lessonId: 'safari-reader', currentAction: 'open-view-menu', stepIndex: 0 }, 'Click View'],
      [{ lessonId: 'safari-bookmark', currentAction: 'open-bookmarks-menu', stepIndex: 0 }, 'Click Bookmarks'],
      [{ lessonId: 'safari-reopen-tab', currentAction: 'open-history-menu', stepIndex: 0 }, 'Click History'],
      [{ ...zoom, status: 'waiting-app', target: null }, 'Open Safari'],
      [{ ...zoom, status: 'waiting-control', target: null, title: 'HelpOS could not find the button on this screen.' }, 'Find the button'],
      [{ ...zoom, status: 'waiting-control', target: null, title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.' }, 'Zoom In is unavailable'],
      [{ ...zoom, status: 'permission', target: null, permission: { accessibility: false, screenCapture: false } }, 'Allow Accessibility'],
      [{ ...zoom, status: 'waiting-control', target: null, canConfirm: true }, 'Text larger?'],
      [{ ...zoom, status: 'error', target: null }, 'Try again'],
      [{ ...zoom, status: 'paused', target: null }, 'Paused'],
      [{ ...zoom, status: 'observing', target: null }, 'Finding button'],
      [{ ...zoom, status: 'complete', target: null, verification: 'self-confirmed' }, 'Done'],
      [{ ...zoom, target: null }, 'Finding button'],
      [{ ...zoom, canConfirm: true }, 'Text larger?'],
      [{ lessonId: 'safari-bookmark', currentAction: 'save-bookmark', stepIndex: 2 }, 'Click Add'],
      [{ lessonId: 'facetime-mic', currentAction: 'mic-off' }, 'Click to mute'],
      [{ lessonId: 'facetime-camera', currentAction: 'camera-off' }, 'Turn camera off'],
      [{ lessonId: 'facetime-end', currentAction: 'end-call' }, 'Click to leave'],
      [{ lessonId: 'facetime-mic', currentAction: 'zoom-in' }, 'Click Zoom In'],
    ];
    for (const [value, heading] of hiddenCases) {
      await show(value, heading);
      await shortcuts();
    }
    await show(zoom, 'Click Zoom In');
    await shortcuts(zoomShortcuts);
  });
  await check('Keyboard alternatives preserve legacy confirmation and learner-controlled Complete', async () => {
    await show(zoom, 'Click Zoom In');
    const before = await meaningful();
    await shortcuts(zoomShortcuts);
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).count(), 0);
    // The native observer, not a hint click or key listener, supplies menu closure.
    await page.evaluate(() => window.updateState({ ...window.testState, status: 'waiting-control', target: null, canConfirm: true }));
    await page.getByRole('heading', { name: 'Text larger?', exact: true }).waitFor();
    await shortcuts();
    assert.deepEqual(await meaningful(), before, 'Hints and menu closure cannot confirm an outcome');
    await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).click();
    assert.deepEqual((await meaningful()).slice(before.length), [['confirm']]);

    await show({ ...manualZoom, currentAction: 'open-view-menu', stepIndex: 0, title: 'Click View', message: 'Click “View” in the top menu bar.', why: '', canComplete: false }, 'Click View');
    await shortcuts();
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).count(), 0);
    const manualBefore = await meaningful();
    await page.evaluate(value => window.updateState({ ...window.testState, ...value }), manualZoom);
    await page.getByRole('heading', { name: 'Click Zoom In', exact: true }).waitFor();
    await shortcuts(zoomShortcuts);
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).getAttribute('title'), 'Confirm that you completed this task');
    assert.equal(await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).count(), 0);
    assert.deepEqual(await meaningful(), manualBefore, 'Showing an observed command enables only the supplied manual completion state');
    await page.evaluate(() => { window.delayComplete = true; });
    await page.getByRole('button', { name: 'Complete', exact: true }).click();
    await page.getByRole('button', { name: 'Closing…', exact: true }).waitFor();
    await shortcuts();
    assert.equal(await page.getByRole('button', { name: 'Closing…', exact: true }).isDisabled(), true);
    assert.deepEqual((await meaningful()).slice(manualBefore.length), [['complete-goal']]);
    await page.evaluate(() => { window.delayComplete = false; window.finishComplete(); });
    await page.getByRole('heading', { name: 'Complete', exact: true }).waitFor();
    await shortcuts();
  });
  await check('Each goal asks the learner about the desired result before Complete', async () => {
    const before = await meaningful();
    for (const [id, question] of [['mute', 'Microphone muted?'], ['unmute', 'Microphone on?'], ['camera-off', 'Camera off?'], ['camera-on', 'Camera on?'], ['zoom-in', 'Page large enough?']]) {
      const safari = id === 'zoom-in';
      await show({ lessonId: safari ? 'safari-zoom' : id.startsWith('camera') ? 'facetime-camera' : 'facetime-mic', currentAction: safari ? 'zoom-in' : id.startsWith('camera') ? 'camera-toggle' : 'mic-toggle', completionMode: 'manual', goal: { id, label: 'Requested result', app: safari ? 'safari' : 'facetime' }, canComplete: true }, safari ? 'Click Zoom In' : id.startsWith('camera') ? 'Click camera' : 'Click microphone');
      assert.equal(await page.getByText(question, { exact: true }).isVisible(), true);
      assert.equal(await page.getByRole('button', { name: 'Complete', exact: true }).getAttribute('aria-describedby'), 'goal-result-question');
      assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isEnabled(), true);
      assert.equal(await page.getByText('Guides', { exact: true }).count(), 0);
      await fit(650);
    }
    assert.deepEqual(await meaningful(), before, 'Result questions never assert or submit success');
  });
  await check('Legacy Safari unavailable Zoom In explains recovery without a retry click or premature confirmation', async () => {
    await show({ lessonId: 'safari-zoom', status: 'waiting-control', currentAction: 'open-view-menu', stepIndex: 0, title: 'Zoom In is unavailable', message: 'Try another webpage, then open View.', why: '', target: null, canConfirm: false }, 'Zoom In is unavailable');
    await page.getByText('Try another webpage, then open View.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).count(), 0);
    const before = await meaningful();
    await page.evaluate(target => window.updateState({ ...window.testState, status: 'guiding', currentAction: 'zoom-in', stepIndex: 1, target, title: 'Click Zoom In', message: 'Click “Zoom In” in the open menu.' }), base.target);
    await page.getByRole('heading', { name: 'Click Zoom In', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Zoom In is unavailable', exact: true }).count(), 0);
    assert.deepEqual(await meaningful(), before, 'Fresh target renders without a renderer retry, target action, or confirmation');
    await fit(600);
  });
  await check('FaceTime acquires a new observed target without asking for a coach click', async () => {
    await show({ status: 'waiting-control', title: 'Show call buttons', target: null }, 'Reveal call buttons');
    await page.getByText('Keep your pointer over FaceTime.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Pause', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isVisible(), true);
    const before = await meaningful();
    await page.evaluate(target => window.updateState({ ...window.testState, status: 'guiding', target }), base.target);
    await page.getByRole('heading', { name: 'Click to mute', exact: true }).waitFor();
    assert.deepEqual(await meaningful(), before, 'New observer state must render without a renderer retry or input action');
    await show({ status: 'error' }, 'Try again');
    assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).isVisible(), true);
    for (const [lessonId, heading] of [['safari-zoom', 'Open Safari'], ['finder-downloads', 'Open Finder']]) {
      await show({ lessonId, status: 'waiting-app' }, heading);
      assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), lessonId === 'safari-zoom' ? 0 : 1);
      await show({ lessonId, status: 'waiting-control', title: 'Find the button', canConfirm: false }, 'Find the button');
      assert.equal(await page.getByRole('button', { name: 'Check again', exact: true }).count(), lessonId === 'safari-zoom' ? 0 : 1);
    }
    await show({}, 'Click to mute');
  });
  await check('Direct and keyboard tabs switch in place after completion', async () => {
    await openGuides();
    await page.getByRole('tab', { name: 'End call guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Click to leave', exact: true }).waitFor();
    assert.deepEqual((await meaningful()).at(-1), ['switch', 'facetime-end']);
    await page.getByRole('tab', { name: 'End call guide', exact: true }).press('Home');
    await page.getByRole('heading', { name: 'Click to mute', exact: true }).waitFor();
    await show({ status: 'complete', verification: 'observed' }, 'Done');
    await openGuides();
    await page.getByRole('tab', { name: 'Camera guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Turn camera off', exact: true }).waitFor();
    assert.equal((await meaningful()).some(call => call[0] === 'home'), false);
  });
  await check('Explicit access request keeps pending and Settings feedback fully visible', async () => {
    await show({ status: 'permission', permission: { accessibility: false, screenCapture: false } }, 'Allow Accessibility');
    await page.evaluate(() => { window.delayPermission = true; });
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Checking access', exact: true }).waitFor(); await fit(600);
    assert.equal(await page.getByRole('button', { name: 'Checking…', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Close help', exact: true }).isEnabled(), true);
    await page.evaluate(() => window.finishPermission());
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor(); await fit(600);
    const requests = (await meaningful()).filter(call => call[0] === 'permission').length;
    await page.getByRole('button', { name: 'Check access', exact: true }).click();
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    assert.equal((await meaningful()).filter(call => call[0] === 'permission').length, requests, 'Check access must not re-prompt');
    assert.deepEqual((await meaningful()).at(-1), ['get-status']);
    await page.getByRole('button', { name: 'Find HelpOS', exact: true }).click();
    assert.deepEqual((await meaningful()).at(-1), ['show-app']);
    assert.ok((await meaningful()).some(call => call[0] === 'permission' && call[1] === 'accessibility'));
    await page.screenshot({ path: 'test-results/coach-no-scroll-permission.png' });
    await page.evaluate(() => { window.delayPermission = false; window.permissionResult = { granted: true, settingsOpened: false }; });
    await show({ status: 'permission' }, 'Allow Accessibility');
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Access ready', exact: true }).waitFor(); await fit(600);
    await page.getByRole('button', { name: 'Continue guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Click to mute', exact: true }).waitFor();
    assert.deepEqual((await meaningful()).at(-1), ['retry']);
  });
  await check('Confirmed permission does not mask subsequent window guidance', async () => {
    await show({ status: 'permission', permission: { accessibility: false, screenCapture: false } }, 'Allow Accessibility');
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Access ready', exact: true }).waitFor();
    await page.evaluate(() => window.updateState({ ...window.testState, status: 'waiting-app', permission: { accessibility: true, screenCapture: false } }));
    await page.getByRole('heading', { name: 'Show your call', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Access ready', exact: true }).count(), 0);
    await fit(600);
  });
  await check('Fresh live permission clears Settings feedback before the target is found', async () => {
    await page.evaluate(() => { window.permissionResult = { granted: false, settingsOpened: true }; });
    await show({ status: 'permission', permission: { accessibility: false, screenCapture: false } }, 'Allow Accessibility');
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).waitFor();
    await page.evaluate(() => { window.delayStatus = true; window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !!window.finishStatus);
    const reads = (await meaningful()).filter(call => call[0] === 'get-status').length;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    assert.equal((await meaningful()).filter(call => call[0] === 'get-status').length, reads, 'Coalesce duplicate return events');
    await page.evaluate(() => window.updateState({ ...window.testState, status: 'waiting-control', title: 'Show call buttons', permission: { accessibility: true, screenCapture: false } }));
    await page.getByRole('heading', { name: 'Reveal call buttons', exact: true }).waitFor();
    await page.evaluate(() => { window.finishStatus({ accessibility: false }); window.delayStatus = false; });
    await page.getByRole('heading', { name: 'Reveal call buttons', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Turn on HelpOS', exact: true }).count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'Access ready', exact: true }).count(), 0);
    await fit(600);
  });
  await check('Permission failure and confirmation offer only explicit actions', async () => {
    await page.evaluate(() => { window.failPermission = true; });
    await show({ status: 'permission' }, 'Allow Accessibility');
    await page.getByRole('button', { name: 'Open Mac Settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Try again', exact: true }).waitFor(); await fit(600);
    await show({ lessonId: 'safari-zoom', status: 'waiting-control', canConfirm: true }, 'Text larger?');
    await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).click();
    assert.deepEqual((await meaningful()).at(-1), ['confirm']);
    await show({ lessonId: 'safari-zoom', status: 'waiting-control', title: 'Find the button', canConfirm: false }, 'Find the button');
    assert.equal(await page.getByRole('button', { name: 'Yes, it is larger', exact: true }).count(), 0);
  });
  await check('Pause, Resume and Close remain reachable while switching; late failure is ignored', async () => {
    await show({}, 'Click to mute'); await fit(600);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('heading', { name: 'Paused', exact: true }).waitFor(); await fit(600);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('heading', { name: 'Click to mute', exact: true }).waitFor();
    await page.evaluate(() => { window.delaySwitch = true; });
    await openGuides();
    await page.getByRole('tab', { name: 'Camera guide', exact: true }).click();
    await page.getByRole('heading', { name: 'Finding button', exact: true }).waitFor(); await fit(600);
    assert.equal(await page.getByRole('tab', { name: 'End call guide', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Close help', exact: true }).click();
    await page.evaluate(() => window.rejectSwitch());
    assert.equal(await page.getByRole('heading', { name: 'Try again', exact: true }).count(), 0);
    assert.deepEqual((await meaningful()).at(-1), ['stop']);
    await page.keyboard.press('Escape');
    assert.deepEqual((await meaningful()).at(-1), ['stop']);
  });
  assert.deepEqual(errors, []);
  await writeFile('test-results/ui-coach-results.json', JSON.stringify({ environment: 'Isolated renderer with bridge stubs and simulated native content-height resizing; no live screen, native permission or actual call test', passed: results.length, stateLayoutChecks: cases.length * 3, results, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/coach-no-scroll-failure.png', fullPage: true });
  await writeFile('test-results/ui-coach-results.json', JSON.stringify({ results, errors, failure: String(error) }, null, 2));
  console.error(error); process.exitCode = 1;
} finally { await browser.close(); }
