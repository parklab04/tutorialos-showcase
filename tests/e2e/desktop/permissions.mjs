import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';

const profile = await mkdtemp('/private/tmp/helpos-permissions-');
await writeFile(profile + '/call-help.json', JSON.stringify({ enabled: false }));
await mkdir('test-results', { recursive: true });
const executablePath = process.argv[2];
const application = await electron.launch({ ...(executablePath ? { executablePath, args: ['--user-data-dir=' + profile] } : { args: ['.', '--user-data-dir=' + profile] }), cwd: process.cwd(), timeout: 30000 });
const results = [];
try {
  const page = await application.firstWindow();
  await page.getByRole('heading', { name: 'What would you like to do?' }).waitFor();
  // Real preload, authorization and main IPC. Only OS boundaries are mocked.
  // A deliberately broken Koffi loader must never affect permission preflight.
  await application.evaluate(({ app, desktopCapturer, systemPreferences, shell }) => {
    const requireFromApp = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
    const koffi = requireFromApp('koffi');
    globalThis.__permissionTest = { events: [], nativeLoads: 0, accessibility: false, screen: 'denied', axReadError: false };
    koffi.load = () => { globalThis.__permissionTest.nativeLoads++; throw new Error('Fixture: observer unavailable'); };
    desktopCapturer.getSources = async options => { globalThis.__permissionTest.events.push({ type: 'screen-prompt', options }); return []; };
    systemPreferences.isTrustedAccessibilityClient = prompt => {
      const state = globalThis.__permissionTest;
      state.events.push({ type: prompt ? 'accessibility-prompt' : 'accessibility-read' });
      if (state.axReadError && !prompt) throw new Error('Fixture: AX status unavailable');
      return state.accessibility;
    };
    systemPreferences.getMediaAccessStatus = kind => {
      const state = globalThis.__permissionTest;
      state.events.push({ type: 'screen-read', kind });
      return state.screen;
    };
    shell.openExternal = async url => { globalThis.__permissionTest.events.push({ type: 'settings', url }); };
    shell.showItemInFolder = item => { globalThis.__permissionTest.events.push({ type: 'finder', item }); };
  });
  const events = () => application.evaluate(() => globalThis.__permissionTest.events);
  const clear = () => application.evaluate(() => { globalThis.__permissionTest.events = []; });
  const reads = [{ type: 'accessibility-read' }, { type: 'screen-read', kind: 'screen' }];
  const status = await page.evaluate(() => window.helpOS.getStatus());
  assert.equal(status.accessibility, false);
  assert.equal(status.screenCapture, false);
  assert.deepEqual(await events(), reads);
  results.push('Status reads denied OS permissions without prompts, capture or observer loading');

  await clear();
  await application.evaluate(() => { globalThis.__permissionTest.accessibility = true; globalThis.__permissionTest.screen = 'granted'; });
  const grantedStatus = await page.evaluate(() => window.helpOS.getStatus());
  assert.equal(grantedStatus.accessibility, true);
  assert.equal(grantedStatus.screenCapture, true);
  assert.deepEqual(await events(), reads);
  assert.equal(await application.evaluate(() => globalThis.__permissionTest.nativeLoads), 0);
  results.push('Granted OS status remains true when the observer library is unavailable');

  for (const [kind, expected] of [['screen', { type: 'screen-read', kind: 'screen' }], ['accessibility', { type: 'accessibility-read' }]]) {
    await clear();
    assert.deepEqual(await page.evaluate(kind => window.helpOS.requestPermission(kind), kind), { granted: true, settingsOpened: false });
    assert.deepEqual(await events(), [expected]);
  }
  results.push('Both already-granted permissions skip prompts and Settings after one read');

  await clear();
  await application.evaluate(() => { globalThis.__permissionTest.accessibility = false; globalThis.__permissionTest.screen = 'denied'; });
  const screen = await page.evaluate(() => window.helpOS.requestPermission('screen'));
  assert.deepEqual(screen, { granted: false, settingsOpened: true });
  assert.deepEqual(await events(), [
    { type: 'screen-read', kind: 'screen' },
    { type: 'screen-prompt', options: { types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false } },
    { type: 'screen-read', kind: 'screen' },
    { type: 'settings', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture' },
  ]);
  results.push('Denied screen access is read, explicitly requested without thumbnails, rechecked, then opens Settings');

  await clear();
  const accessibility = await page.evaluate(() => window.helpOS.requestPermission('accessibility'));
  assert.deepEqual(accessibility, { granted: false, settingsOpened: true });
  assert.deepEqual(await events(), [
    { type: 'accessibility-read' },
    { type: 'accessibility-prompt' },
    { type: 'accessibility-read' },
    { type: 'settings', url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility' },
  ]);
  results.push('Denied Accessibility access is read, explicitly requested, rechecked, then opens Settings');

  await clear();
  await application.evaluate(() => { globalThis.__permissionTest.screen = 'unknown'; });
  await assert.rejects(page.evaluate(() => window.helpOS.getStatus()), /could not check Screen Recording access/);
  assert.deepEqual(await events(), reads);
  await clear();
  await assert.rejects(page.evaluate(() => window.helpOS.requestPermission('screen')), /could not check Screen Recording access/);
  assert.deepEqual(await events(), [{ type: 'screen-read', kind: 'screen' }]);
  results.push('Unknown screen status rejects status and request without misreporting denial or prompting');

  await clear();
  await application.evaluate(() => { globalThis.__permissionTest.screen = 'granted'; globalThis.__permissionTest.axReadError = true; });
  await assert.rejects(page.evaluate(() => window.helpOS.getStatus()), /AX status unavailable/);
  assert.deepEqual(await events(), [{ type: 'accessibility-read' }]);
  await clear();
  await assert.rejects(page.evaluate(() => window.helpOS.requestPermission('accessibility')), /AX status unavailable/);
  assert.deepEqual(await events(), [{ type: 'accessibility-read' }]);
  results.push('An Accessibility read failure remains an error without a fabricated denied status or prompt');

  await clear();
  await application.evaluate(() => { globalThis.__permissionTest.axReadError = false; });
  await assert.rejects(page.evaluate(() => window.helpOS.requestPermission('camera')));
  assert.deepEqual(await events(), []);
  results.push('Invalid permission kind is rejected before OS reads or side effects');

  await page.evaluate(() => window.helpOS.showAppInFinder());
  const finder = await events();
  assert.equal(finder.length, 1); assert.equal(finder[0].type, 'finder');
  assert.ok(finder[0].item.endsWith(executablePath ? 'HelpOS.app' : 'HelpOS'));
  assert.equal(await application.evaluate(() => globalThis.__permissionTest.nativeLoads), 0);
  results.push('Finder action reveals only the fixed current app path');
  await writeFile('test-results/permission-ipc-results.json', JSON.stringify({ packaged: !!executablePath, results, note: 'Real Electron IPC/preload with OS read, prompt, Settings and Finder boundaries mocked. Koffi loading deliberately fails if called, proving permission status and requests do not depend on UI observation. No user permission changes, prompts or screen captures occur; this does not prove first-launch TCC registration.' }, null, 2));
  console.log(`PASS ${results.length} permission IPC checks (OS boundaries mocked)`);
} catch (error) {
  const diagnostics = await application.evaluate(() => globalThis.__permissionTest ?? null).catch(() => null);
  await writeFile('test-results/permission-ipc-results.json', JSON.stringify({ results, failure: String(error), diagnostics }, null, 2));
  console.error('Permission boundary diagnostics:', JSON.stringify(diagnostics));
  console.error(error); process.exitCode = 1;
} finally { await application.close(); }
