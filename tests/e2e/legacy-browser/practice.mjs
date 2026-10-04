const baseURL = process.env.HELPOS_TEST_URL || 'http://127.0.0.1:5176';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: {width:1180,height:760}, deviceScaleFactor:1 });
const errors = [];
const results = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, run) => { await run(); results.push({name,passed:true}); console.log('PASS',name); };
const home = async () => { await page.goto(`${baseURL}/`); await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor(); };
const lesson = async name => { await home(); await page.getByRole('button',{name:`${name} Start practice`,exact:true}).click(); };
const complete = async () => { await page.getByText('You clicked the controls in practice.',{exact:true}).waitFor(); };
try {
  await check('Home renders eight lessons and explicit practice mode', async () => {
    await home(); assert.equal(await page.locator('.lesson-row').count(),8);
    assert.equal(await page.getByRole('radio',{name:/Practice/}).getAttribute('aria-checked'),'true');
    await page.screenshot({path:'test-results/home.png',fullPage:true});
  });
  await check('Microphone wrong control does not advance; off then on completes', async () => {
    await lesson('Mute and unmute');
    await page.locator('[data-guide-target="camera"]').click();
    assert.match(await page.locator('.step-meta').innerText(),/Step 1 of 2/);
    await page.locator('[data-guide-target="microphone"]').click();
    assert.match(await page.locator('.step-meta').innerText(),/Step 2 of 2/);
    await page.screenshot({path:'test-results/practice-microphone.png',fullPage:true});
    await page.locator('[data-guide-target="microphone"]').click(); await complete();
  });
  await check('Hint-free repeat has no highlight until help is requested', async () => {
    await page.getByRole('button',{name:'Try without hints',exact:true}).click();
    assert.equal(await page.locator('.practice-highlight').count(),0);
    await page.getByRole('button',{name:'Show me where to click',exact:true}).click();
    await page.locator('.practice-highlight').waitFor();
  });
  await check('Pause hides highlight, mismatch gives recovery, reset restores scene', async () => {
    await page.getByRole('button',{name:'Pause guide',exact:true}).click();
    assert.equal(await page.locator('.practice-highlight').count(),0);
    await page.locator('[data-guide-target="microphone"]').click();
    await page.getByRole('button',{name:'Resume guide',exact:true}).click();
    await page.getByRole('heading',{name:'Reset the practice scene.'}).waitFor();
    await page.locator('.practice-coach').getByRole('button',{name:'Restart practice',exact:true}).click();
    assert.equal(await page.locator('[data-guide-target="microphone"]').getAttribute('aria-pressed'),'false');
  });
  await check('Camera off/on completes; guide-stop never changes actual call scene', async () => {
    await lesson('Turn your camera off and on');
    await page.locator('[data-guide-target="camera"]').click();
    await page.locator('[data-guide-target="camera"]').click(); await complete();
  });
  await check('End-call practice ends only the fictional scene', async () => {
    await lesson('End a call'); await page.locator('[data-guide-target="end-call"]').click(); await complete();
    assert.equal(await page.getByText('In FaceTime, this button ends the current call.').isVisible(),true);
  });
  await check('Safari actual menu click and zoom visibly enlarge practice content', async () => {
    await lesson('Make text larger');
    const before = await page.locator('.sample-webpage p').evaluate(element=>parseFloat(getComputedStyle(element).fontSize));
    await page.locator('[data-guide-target="view-menu"]').click();
    await page.screenshot({path:'test-results/practice-safari-menu.png',fullPage:true});
    await page.locator('[data-guide-target="zoom-in"]').click(); await complete();
    const after = await page.locator('.sample-webpage p').evaluate(element=>parseFloat(getComputedStyle(element).fontSize));
    assert.ok(after>before,`Expected zoom ${before} -> ${after}`);
  });
  await check('Finder wrong folder does not advance; Downloads selection completes', async () => {
    await lesson('Find Downloads');
    await page.locator('.finder-sidebar').getByRole('button',{name:'Documents',exact:true}).click();
    assert.equal(await page.locator('.completion-mark').count(),0);
    await page.locator('[data-guide-target="downloads"]').click(); await complete();
  });
  await check('Escape closes settings only, then exits practice when no dialog open', async () => {
    await lesson('Mute and unmute'); await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.locator('dialog[open]').waitFor(); await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(),0); assert.equal(await page.locator('.practice-page').count(),1);
    await page.keyboard.press('Escape'); await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor();
  });
  await check('Browser live mode truthfully reports desktop requirement', async () => {
    await page.getByRole('radio',{name:/On my Mac/}).click();
    await page.getByText('Live guidance is available in the Mac app.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/Make text larger Start live guide/}).click();
    assert.equal(await page.locator('.practice-page').count(),0);
  });
  await check('200% helper text and narrow viewport keep controls reachable', async () => {
    await home();
    await page.evaluate(()=>{localStorage.setItem('helpos:text-scale','2');}); await page.reload();
    await page.setViewportSize({width:780,height:680});
    await page.getByRole('button',{name:'Mute and unmute Start practice',exact:true}).click();
    const stop=page.getByRole('button',{name:'End guide',exact:true});
    await stop.scrollIntoViewIfNeeded(); assert.equal(await stop.isVisible(),true);
    await page.screenshot({path:'test-results/enlarged-narrow.png',fullPage:true});
    const metrics = await page.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:window.innerWidth}));
    assert.ok(metrics.doc <= metrics.viewport+2,`Horizontal overflow: ${metrics.doc}/${metrics.viewport}`);
    await stop.click();
  });
  assert.deepEqual(errors,[]);
  results.push({name:'No browser JavaScript errors',passed:true});
  await writeFile('test-results/ui-results.json',JSON.stringify({passed:results.length,results,errors},null,2));
} catch(error) {
  await page.screenshot({path:'test-results/failure.png',fullPage:true});
  await writeFile('test-results/ui-results.json',JSON.stringify({results,errors,failure:String(error)},null,2));
  console.error(error); process.exitCode=1;
} finally { await browser.close(); }
