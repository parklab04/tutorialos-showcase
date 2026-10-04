import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', {recursive:true});
const packagedExecutable=process.argv[2];
const stem=packagedExecutable?'packaged-electron':'electron';
const application = await electron.launch({...(packagedExecutable?{executablePath:packagedExecutable,args:[]}:{args:['.']}),cwd:process.cwd(),timeout:30000});
const results=[];
const errors=[];
const check=async(name,run)=>{await run();results.push({name,passed:true});console.log('PASS',name);};
const untilState=async(page,predicate)=>{
  const deadline=Date.now()+20000;
  do {
    const state=await page.evaluate(()=>window.helpOS.getLiveState());
    if(predicate(state))return state;
    await new Promise(resolve=>setTimeout(resolve,100));
  }while(Date.now()<deadline);
  throw new Error('Expected live state did not arrive');
};
try {
  const page=await application.firstWindow();
  page.on('pageerror',error=>errors.push(error.message));
  await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor();
  await check('Built renderer loads in Electron with isolated preload',async()=>{
    assert.equal(await page.evaluate(()=>typeof window.helpOS?.getStatus),'function');
    assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
    const preferences=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.sandbox,true);
    assert.equal(await page.locator('.lesson-row').count(),8);
    await page.screenshot({path:`test-results/${stem}-home.png`});
  });
  await check('Real Electron practice responds to clicks and completes',async()=>{
    await page.getByRole('button',{name:'Mute and unmute Start practice',exact:true}).click();
    await page.locator('[data-guide-target="microphone"]').click();
    await page.locator('[data-guide-target="microphone"]').click();
    await page.getByText('You clicked the controls in practice.',{exact:true}).waitFor();
    await page.keyboard.press('Escape');
  });
  await check('All three new Safari practice guides complete inside Electron without native Safari actions',async()=>{
    for(const [title,targets] of [
      ['Read without distractions',['view-menu','show-reader']],
      ['Save this page',['bookmarks-menu','add-bookmark','save-bookmark']],
      ['Bring back a closed tab',['history-menu','reopen-closed-tab']],
    ]) {
      await page.getByRole('button',{name:`${title} Start practice`,exact:true}).click();
      await page.getByRole('region',{name:'Safari Practice scene',exact:true}).waitFor();
      for(const target of targets) await page.locator(`[data-guide-target="${target}"]`).click();
      await page.getByText('You clicked the controls in practice.',{exact:true}).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor();
    }
  });
  await check('Native permission probe returns actual booleans',async()=>{
    const status=await page.evaluate(()=>window.helpOS.getStatus());
    assert.equal(status.desktop,true);assert.equal(status.platform,'darwin');
    assert.equal(typeof status.accessibility,'boolean');assert.equal(typeof status.screenCapture,'boolean');
    console.log('NATIVE STATUS',JSON.stringify(status));
    results.push({name:'Native environment',status});
  });
  let coach;
  await check('FaceTime live guide opens a native coach without starting a call',async()=>{
    const coachReady=application.waitForEvent('window',{predicate:async window=>{
      await window.waitForLoadState('domcontentloaded');
      return window.url().endsWith('#coach');
    },timeout:20000});
    await page.evaluate(()=>window.helpOS.startLive('facetime-mic'));
    await untilState(page,state=>['permission','waiting-app','waiting-control'].includes(state.status));
    coach=await coachReady;
    assert.ok(coach,'Native coach exists');
    await coach.locator('.native-coach').waitFor();
    await application.evaluate(async({BrowserWindow})=>{
      const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('#coach'));
      for(let attempt=0;attempt<50&&!window.isVisible();attempt++) await new Promise(resolve=>setTimeout(resolve,100));
    });
    const state=await page.evaluate(()=>window.helpOS.getLiveState());
    assert.equal(state.verification,null);assert.equal(state.target,null);
    console.log('FACETIME STATE',JSON.stringify(state));
    await coach.screenshot({path:`test-results/${stem}-native-coach.png`});
    const visible=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(window=>({url:window.webContents.getURL(),visible:window.isVisible(),focusable:window.isFocusable(),bounds:window.getBounds()})));
    console.log('NATIVE WINDOWS',JSON.stringify(visible));
    assert.equal(visible.find(window=>window.url.endsWith('#overlay')).visible,false);
    assert.equal(visible.find(window=>window.url.endsWith('#overlay')).focusable,false);
    assert.equal(visible.find(window=>window.url.endsWith('#coach')).visible,true);
    const stop=await coach.getByRole('button',{name:'End guide',exact:true}).boundingBox();
    const viewport=await coach.evaluate(()=>({width:innerWidth,height:innerHeight}));
    assert.ok(stop && stop.y+stop.height<=viewport.height,'Stop visible without scrolling');
  });
  await check('Pause and resume work through real IPC; stop hides native windows',async()=>{
    await coach.getByRole('button',{name:'Pause guide',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.helpOS.getLiveState())).status,'paused');
    await coach.getByRole('button',{name:'Resume guide',exact:true}).click();
    await coach.getByRole('button',{name:'End guide',exact:true}).click();
    assert.equal((await page.evaluate(()=>window.helpOS.getLiveState())).status,'idle');
    const visible=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(window=>/#(coach|overlay)$/.test(window.webContents.getURL())).map(window=>window.isVisible()));
    assert.deepEqual(visible,[false,false]);
  });
  await check('Help window can be reopened after stopping; Escape stops native guidance',async()=>{
    await page.evaluate(()=>window.helpOS.showHome());
    await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor();
    await page.evaluate(()=>window.helpOS.startLive('finder-downloads'));
    await coach.locator('.native-coach').waitFor();
    await coach.keyboard.press('Escape');
    await untilState(page,state=>state.status==='idle');
  });
  await check('Explicit recovery to practice reloads home into practice mode',async()=>{
    await page.evaluate(()=>window.helpOS.showHome());
    await page.getByRole('radio',{name:/On my Mac/}).click();
    await page.getByRole('button',{name:'Mute and unmute Start live guide',exact:true}).click();
    await untilState(page,state=>['waiting-app','permission','waiting-control'].includes(state.status));
    await coach.getByRole('button',{name:'Switch to Practice',exact:true}).click();
    await page.locator('[data-mode="practice"][aria-checked="true"]').waitFor();
    await page.getByRole('heading',{name:'What would you like to learn?'}).waitFor();
    assert.equal(await page.getByRole('radio',{name:/Practice/}).getAttribute('aria-checked'),'true');
    assert.equal(await page.getByRole('button',{name:/Start practice$/}).count(),8);
  });
  assert.deepEqual(errors,[]);
  await writeFile(`test-results/${stem}-results.json`,JSON.stringify({packaged:!!packagedExecutable,results,errors},null,2));
} catch(error) {
  await writeFile(`test-results/${stem}-results.json`,JSON.stringify({packaged:!!packagedExecutable,results,errors,failure:String(error)},null,2));
  console.error(error);process.exitCode=1;
} finally {await application.close();}
