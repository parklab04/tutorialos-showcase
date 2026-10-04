import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertCoachPresentation } from './companion-checks.mjs';

// Exercise the real main-process lifecycle while only its OS boundaries are
// mocked. A child process has already exited when its close callback is held.
export async function runGoalHandoffChecks({ application, home, pageForRoute, until, windows, patch, state, live, phaseIs, idleGuide, record }) {
  const holding = count => until(() => application.evaluate((_electron, count) => globalThis.__voiceDesktop.heldOpens.length === count, count), `${count} held app-open callbacks`);
  const release = async (all = false) => {
    await application.evaluate((_electron, all) => {
      const t = globalThis.__voiceDesktop;
      if (all) t.holdOpen = false;
      const callbacks = all ? t.heldOpens.splice(0) : t.heldOpens.splice(0, 1);
      for (const callback of callbacks) callback();
    }, all);
  };
  const passiveActivation = () => application.evaluate(({ app }) => {
    app.emit('activate');
    app.emit('second-instance', {}, ['HelpOS']);
  });
  const noVisibleHelp = async () => assert.ok((await windows()).every(window => !window.visible), 'No Home or automatic offer may interrupt an app-open handoff');
  const prepareVoice = async (text = 'Make text larger') => {
    await home.evaluate(() => window.helpOS.showVoice());
    const voice = await pageForRoute('#voice');
    await voice.getByLabel('Or type a command').fill(text);
    await voice.getByRole('button', { name: 'Review command', exact: true }).click();
    await phaseIs('review');
    return voice;
  };
  const startVoiceHeld = async (text, count = 1) => {
    const voice = await prepareVoice(text);
    await patch({ holdOpen: true });
    await voice.getByRole('button', { name: 'Show me', exact: true }).click();
    await holding(count);
    assert.equal((await live()).status, 'idle');
    return voice;
  };
  const permissionCoach = async id => {
    await until(async () => (await live()).status === 'permission' && (await live()).goal?.id === id, `${id} permission coach`);
    await until(async () => (await windows()).some(window => window.visible && window.url.endsWith('#coach')), 'visible permission coach');
    const coach = await pageForRoute('#coach');
    await assertCoachPresentation({ application, coach, until, mode: 'recovery' });
    await coach.getByRole('button', { name: 'Open Mac Settings', exact: true }).waitFor();
  };
  const reset = async () => {
    await home.evaluate(() => window.helpOS.showHome());
    await idleGuide();
  };
  try {
    await reset();
    await patch({ trusted: false, holdOpen: true });
    await home.evaluate(() => { window.__pendingGoal = window.helpOS.startGoal('zoom-in'); });
    await holding(1);
    await passiveActivation();
    await noVisibleHelp();
    await release(true);
    await home.evaluate(() => window.__pendingGoal);
    await permissionCoach('zoom-in');
    record('Home goal survives passive activation and a second instance during target-app opening, then shows its missing-access coach');
    await reset();

    await startVoiceHeld();
    // Make OS registration read as On without writing the real service. The
    // app's existing availability predicate also needs the packaged boundary.
    await application.evaluate(({ app }) => {
      const t = globalThis.__voiceDesktop;
      t.packagedDescriptor = Object.getOwnPropertyDescriptor(app, 'isPackaged');
      Object.defineProperty(app, 'isPackaged', { configurable: true, get: () => true });
      t.packagedOverrideInstalled = true;
      t.autoHelpEnabled = true;
    });
    assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).enabled, true);
    const contexts = await application.evaluate(() => globalThis.__voiceDesktop.contexts);
    await passiveActivation();
    await application.evaluate(({ app }, id) => app.emit('second-instance', {}, ['HelpOS', '--background', '--app-help', 'com.apple.FaceTime', '--activation-id', id, '--activation-at', String(Date.now())]), randomUUID());
    assert.equal((await home.evaluate(() => window.helpOS.getCallHelpState())).suggestion, null);
    assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.contexts), contexts, 'A pending explicit goal must suppress automatic context inspection/offers');
    assert.equal((await state()).phase, 'review');
    await noVisibleHelp();
    await release(true);
    await permissionCoach('zoom-in');
    await phaseIs('idle');
    await patch({ autoHelpEnabled: false });
    await home.evaluate(() => window.helpOS.getCallHelpState());
    record('Reviewed typed goal survives activation, second instance and an opted-in app-help event without losing its request or showing a competing offer');
    await reset();

    for (const method of ['showHome', 'stopLive', 'cancelVoice']) {
      const voice = await startVoiceHeld();
      const observations = await application.evaluate(() => globalThis.__voiceDesktop.observations);
      if (method === 'cancelVoice') await voice.evaluate(() => window.helpOS.cancelVoice());
      else await home.evaluate(method => window.helpOS[method](), method);
      // Explicit cancellation makes passive reopening available even before
      // the old launch settles. A cancelled voice epoch must not keep a guard.
      await passiveActivation();
      assert.ok((await windows()).some(window => window.visible && window.url.endsWith('/index.html')));
      await release(true);
      await idleGuide();
      assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.observations), observations);
    }
    record('Explicit Home, End guide and voice Cancel invalidate a pending launch; its late completion cannot open a coach or block Home');

    await startVoiceHeld();
    // A new controller request can arrive from the global shortcut while the
    // old renderer's Show me IPC is unresolved. Exercise that same replacement
    // boundary directly, without starting a real or fixture microphone.
    await home.evaluate(() => window.helpOS.showVoice());
    const replacementVoice = await pageForRoute('#voice');
    await replacementVoice.evaluate(() => window.helpOS.submitVoiceText('Turn my camera off'));
    await phaseIs('review');
    await replacementVoice.evaluate(() => { window.__replacementGoal = window.helpOS.useVoiceGoal(); });
    await holding(2);
    const completed = await application.evaluate(() => globalThis.__voiceDesktop.completedOpens);
    await release();
    await until(() => application.evaluate((_electron, previous) => globalThis.__voiceDesktop.completedOpens === previous + 1, completed), 'older open completion');
    await passiveActivation();
    await noVisibleHelp();
    assert.equal((await state()).goal?.id, 'camera-off');
    assert.equal((await live()).status, 'idle');
    await holding(1);
    const openCount = await application.evaluate(() => globalThis.__voiceDesktop.openRequests.length);
    await replacementVoice.evaluate(() => window.helpOS.useVoiceGoal());
    assert.equal(await application.evaluate(() => globalThis.__voiceDesktop.openRequests.length), openCount, 'The old controller finally must not unlock a duplicate replacement launch');
    await holding(1);
    await release(true);
    await permissionCoach('camera-off');
    record('A new voice request replaces a pending launch; the older finally cannot release the newer handoff guard or start its stale goal');
    await reset();

    await patch({ failNextOpen: true });
    const voice = await startVoiceHeld();
    await release(true);
    await phaseIs('error');
    assert.match((await state()).message, /Could not open the guide/);
    await until(async () => (await windows()).some(window => window.visible && window.url.endsWith('#voice')), 'recoverable voice error');
    await voice.evaluate(() => window.helpOS.cancelVoice());
    await passiveActivation();
    assert.ok((await windows()).some(window => window.visible && window.url.endsWith('/index.html')));
    await idleGuide();
    record('Target-open failure clears handoff ownership, restores the voice error panel and permits Home after cancellation');
  } finally {
    await release(true);
    await patch({ trusted: true, autoHelpEnabled: false, failNextOpen: false });
    await application.evaluate(({ app }) => {
      const t = globalThis.__voiceDesktop;
      if (t.packagedOverrideInstalled) {
        if (t.packagedDescriptor) Object.defineProperty(app, 'isPackaged', t.packagedDescriptor);
        else delete app.isPackaged;
      }
      delete t.packagedDescriptor;
      delete t.packagedOverrideInstalled;
    });
    await home.evaluate(() => window.helpOS.getCallHelpState());
  }
}
