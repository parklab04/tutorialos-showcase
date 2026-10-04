import assert from 'node:assert/strict';

// These checks inspect only the isolated HelpOS windows. A fixture target is
// geometry supplied to the real presenter, not evidence of native app accuracy.
export async function assertCoachPresentation({ application, coach, overlay, until, mode = 'companion', target = null, passive = false }) {
  await coach.locator(`[data-presentation="${mode}"]`).waitFor();
  await until(async () => {
    const scale = await coach.evaluate(() => Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16)));
    return application.evaluate(({ BrowserWindow, screen }, { mode, target, passive, scale }) => {
    const coach = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#coach'));
    if (!coach?.isVisible()) return false;
    const bounds = coach.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const clear = !target || bounds.x + bounds.width <= target.x - 6 || bounds.x >= target.x + target.width + 6 ||
      bounds.y + bounds.height <= target.y - 6 || bounds.y >= target.y + target.height + 6;
    const expectedWidth = Math.max(1, Math.min(Math.round((mode === 'companion' ? 320 : 360) * scale), area.width - 32));
    return bounds.width === expectedWidth && clear && bounds.x >= area.x && bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width && bounds.y + bounds.height <= area.y + area.height &&
      (!passive || !coach.isFocused());
    }, { mode, target, passive, scale });
  }, `${mode} native coach is visible, on-screen and clear of the target${passive ? ' without taking focus' : ''}`);
  await until(() => coach.evaluate(mode => {
    const content = document.querySelector(`[data-presentation="${mode}"]`);
    // Closed native <details> can retain descendant layout boxes; only painted
    // controls belong to the compact surface being checked for clipping.
    const controls = [...document.querySelectorAll('button,summary,h1,h2,p,.live-shortcut-note')].filter(element => element.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
    if (!content || !controls.length) return false;
    const scale = Math.max(1, Math.min(2, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16));
    const expectedWidth = (mode === 'companion' ? 320 : 360) * scale;
    return innerWidth <= expectedWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1 &&
      document.documentElement.scrollHeight <= innerHeight + 1 &&
      controls.every(element => {
        const rect = element.getBoundingClientRect();
        return rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
      });
  }, mode), `${mode} content and actions fit without scrolling`);
  await coach.getByRole('button', { name: 'Close help', exact: true }).waitFor();
  if (overlay) {
    assert.equal(await overlay.locator('.companion-bubble').count(), 0, 'Only the coach may render guidance text');
    assert.equal(await overlay.getByRole('button').count(), 0, 'The full-screen overlay has no action controls');
    assert.equal(await overlay.locator('.tutorial-scrim').count(), 0, 'Companion guidance must not dim the screen');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('#overlay')).isFocusable()), false);
  }
}

export async function chooseFaceTimeGuide(coach, name) {
  const tab = coach.getByRole('tab', { name, exact: true });
  if (!await tab.isVisible()) await coach.getByText('Guides', { exact: true }).click();
  await tab.click();
}

export async function assertGuidanceHidden({ application, overlay, until }) {
  await until(() => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .filter(window => /#coach$|#overlay$/.test(window.webContents.getURL())).every(window => !window.isVisible())), 'all guidance windows hidden');
  assert.equal(await overlay.evaluate(() => window.helpOS.getGuidePointer()), null, 'Ending a guide clears its cursor feed');
}
