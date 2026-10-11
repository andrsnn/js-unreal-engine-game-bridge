import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Run with Windows Node. The root agent owns browser serialization and invocation.
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json');
const {chromium}=require('playwright');
const url=process.argv[2]||'http://localhost:5191/';
const reportPath=process.argv[3]||'G:/sfx/evidence/karvos/ui-mixer-check.json';
const preferenceKey='karvos.preferences.v1';
const targets={volume:1,combatVolume:.35,environmentVolume:.45,foleyVolume:.6,musicVolume:.4};
const report={url,checks:[],errors:[],missing:[]};
let browser,context,page;
const born=Date.now();
const watchdog=setTimeout(()=>{
 console.error('Karvos UI mixer check exceeded its 300-second deadline.');
 void browser?.close().finally(()=>process.exit(1));
 setTimeout(()=>process.exit(1),5000).unref();
},300000);

const pauseSelector=key=>key==='volume'?'#audioVolume':`#pauseMenu [data-mix="${key}"]`;
const titleSelector=key=>`#start [data-preference="${key}"]`;
async function setRange(selector,value){
 const input=page.locator(selector);
 await input.waitFor({state:'visible',timeout:15000});
 await input.focus();
 // Real trusted keyboard input fires the range's native input handlers.
 await input.press('Home');
 for(let i=0;i<Math.round(value/.05);i++)await input.press('ArrowRight');
 assert(Math.abs(Number(await input.inputValue())-value)<.001,`${selector} did not reach ${value}`);
}
async function saved(){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),preferenceKey);}
async function verifySaved(expected){
 const actual=await saved();
 for(const [key,value]of Object.entries(expected))assert(Math.abs(actual[key]-value)<.001,`${key} was not saved`);
 return actual;
}
async function pause(){
 await page.keyboard.press('Escape');
 await page.locator('#pauseMenu:not(.hidden)').waitFor({state:'visible',timeout:15000});
}
async function resume(){
 await page.locator('#resumeGame').click();
 await page.locator('#pauseMenu').waitFor({state:'hidden',timeout:15000});
}
async function measureOutput(milliseconds=900){
 return page.evaluate(async milliseconds=>{
  const {analyser}=window.__karvosMixerProbe,values=new Float32Array(analyser.fftSize);
  let peak=0,squares=0,count=0;
  const until=performance.now()+milliseconds;
  while(performance.now()<until){
   analyser.getFloatTimeDomainData(values);
   for(const v of values){peak=Math.max(peak,Math.abs(v));squares+=v*v;count++;}
   await new Promise(resolve=>setTimeout(resolve,30));
  }
  return {peak,rms:Math.sqrt(squares/Math.max(1,count)),milliseconds};
 },milliseconds);
}

try{
 browser=await chromium.launch({headless:true,timeout:30000,
  executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required',
   '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
 context=await browser.newContext({viewport:{width:1280,height:720},reducedMotion:'reduce'});
 await context.addInitScript(()=>{
  Element.prototype.requestPointerLock=()=>Promise.resolve();
  Element.prototype.requestFullscreen=()=>Promise.resolve();
  document.exitPointerLock=()=>{};
  document.exitFullscreen=()=>Promise.resolve();
 });
 page=await context.newPage();
 page.setDefaultTimeout(15000);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('favicon.ico'))report.missing.push({url:response.url(),status:response.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.karvos?.ready,null,{timeout:150000});
 // Fresh isolated browser storage makes this the actual title New Game button.
 assert(await page.locator('#beginGame').isVisible(),'Fresh title did not show New Game');
 await page.locator('#beginGame').click();
 await page.waitForFunction(()=>karvos.state.started&&karvos.state.mode==='game',null,{timeout:30000});
 await page.evaluate(async()=>{
  await karvos.fieldAudio.audio.ready();
  const stream=karvos.fieldAudio.audio.recordingStream();
  if(!stream)throw Error('Trusted New Game input did not unlock audio');
  const Audio=window.AudioContext||window.webkitAudioContext,context=new Audio();
  await context.resume();
  const source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
  analyser.fftSize=2048;source.connect(analyser);
  window.__karvosMixerProbe={context,source,analyser};
 });
 await page.waitForTimeout(1600);
 const baseline=await measureOutput();
 assert(baseline.peak>.0001,'New Game did not produce audible output');
 report.checks.push({name:'Normal New Game and real post-master output',baseline});
 await pause();
 const original=Object.fromEntries(await Promise.all(Object.keys(targets).map(async key=>[key,Number(await page.locator(pauseSelector(key)).inputValue())])));

 // Set every real slider independently, and verify its displayed output and storage.
 for(const [key,value]of Object.entries(targets)){
  await setRange(pauseSelector(key),value);
  const output=key==='volume'?'#volumeValue':`#${key}Value`;
  assert.equal((await page.locator(output).textContent()).trim(),`${Math.round(value*100)}%`);
 }
 const customSaved=await verifySaved(targets);
 // Observe settings produced by UI handlers; never assign game state or preferences.
 const actualMix=await page.evaluate(()=>({master:karvos.state.audioVolume,muted:karvos.state.audioMuted,mix:{...karvos.state.audioMix}}));
 assert.equal(actualMix.master,1);assert.equal(actualMix.muted,false);
 for(const bus of ['weapons','impacts','explosions','creatures','reflections'])assert.equal(actualMix.mix[bus],.35);
 for(const bus of ['ambience','engines'])assert.equal(actualMix.mix[bus],.45);
 for(const bus of ['foley','ui','alerts'])assert.equal(actualMix.mix[bus],.6);
 assert.equal(actualMix.mix.music,.4);
 report.checks.push({name:'Trusted master/combat/environment/foley/music sliders, displayed percentages and independent buses',customSaved,actualMix});

 await setRange(pauseSelector('volume'),0);
 await page.waitForFunction(()=>karvos.state.audioMuted&&karvos.state.audioVolume===0,null,{timeout:5000});
 await verifySaved({...targets,volume:0});
 await resume();
 await page.keyboard.down('w');await page.waitForTimeout(450);await page.keyboard.up('w');
 await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
 await page.waitForTimeout(750);
 const masterZero=await measureOutput();
 assert(masterZero.peak<.00003,'Master zero did not silence the real output');
 report.checks.push({name:'Master slider zero derives mute and silences resumed movement/gunfire',masterZero});

 await pause();await setRange(pauseSelector('volume'),1);
 await page.waitForFunction(()=>!karvos.state.audioMuted,null,{timeout:5000});
 await resume();await page.waitForTimeout(1600);
 const masterRestore=await measureOutput();
 assert(masterRestore.peak>.0001,'Restoring master failed to restore real output');
 report.checks.push({name:'Master restore recovers the real exploration output',masterRestore});

 // Zero all category sliders while master remains one: music and every effects bus
 // must independently honor their controls, including footsteps and UI clicks.
 await pause();
 for(const key of ['combatVolume','environmentVolume','foleyVolume','musicVolume'])await setRange(pauseSelector(key),0);
 await verifySaved({volume:1,combatVolume:0,environmentVolume:0,foleyVolume:0,musicVolume:0});
 await resume();await page.keyboard.down('w');await page.waitForTimeout(500);await page.keyboard.up('w');
 await page.mouse.down();await page.waitForTimeout(250);await page.mouse.up();
 await page.waitForTimeout(800);
 const categoriesZero=await measureOutput();
 assert(categoriesZero.peak<.00003,'Zero category sliders left audio on the real output');
 report.checks.push({name:'All category sliders zero silence real output with master one',categoriesZero});
 await pause();
 for(const [key,value]of Object.entries(targets))await setRange(pauseSelector(key),value);
 await verifySaved(targets);
 await resume();await page.waitForTimeout(1600);
 const categoryRestore=await measureOutput();assert(categoryRestore.peak>.0001,'Category restore failed');
 report.checks.push({name:'Category restoration recovers output',categoryRestore});
 await pause();
 await fs.mkdir(path.dirname(reportPath),{recursive:true});
 await page.screenshot({path:reportPath.replace(/\.json$/,'-pause.png'),timeout:20000});
 await fs.writeFile(reportPath,JSON.stringify({...report,phase:'before reload'},null,2));
 console.log('REAL_OUTPUT_AND_SLIDERS_PASSED',report.checks.length);

 // Reload the same isolated origin and read the actual title settings controls.
 await page.evaluate(async()=>{const p=window.__karvosMixerProbe;p.source.disconnect();p.analyser.disconnect();await p.context.close();delete window.__karvosMixerProbe;});
 await page.reload({waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.karvos?.ready,null,{timeout:120000});
 await page.locator('#start [data-tab="settings"]').click();
 for(const [key,value]of Object.entries(targets))assert(Math.abs(Number(await page.locator(titleSelector(key)).inputValue())-value)<.001,`${key} did not persist through reload into title settings`);
 const reloadSaved=await verifySaved(targets);
 report.checks.push({name:'All five settings persist across reload and appear in actual title controls',reloadSaved});
 for(const [key,value]of Object.entries(original))await setRange(titleSelector(key),value);
 const restoredSaved=await verifySaved(original);
 report.checks.push({name:'Original preferences restored through title UI',restoredSaved});
 assert.equal(report.errors.length,0,'Browser page errors');assert.equal(report.missing.length,0,'Missing game/audio resources');
 report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack||String(error);process.exitCode=1;}
finally{
 clearTimeout(watchdog);
 report.elapsedSeconds=(Date.now()-born)/1000;
 await fs.mkdir(path.dirname(reportPath),{recursive:true});
 await fs.writeFile(reportPath,JSON.stringify(report,null,2));
 console.log(JSON.stringify({ok:report.ok,checks:report.checks.length,elapsedSeconds:report.elapsedSeconds,report:reportPath,
  errors:report.errors.length,missing:report.missing.length,failure:report.failure?.split('\n')[0],
  peaks:report.checks.flatMap(c=>Object.entries(c).filter(([key,value])=>value&&typeof value==='object'&&'peak'in value).map(([key,value])=>({key,peak:value.peak})))}));
 const shutdown=setTimeout(()=>process.exit(process.exitCode||0),15000);
 await browser?.close().catch(()=>{});clearTimeout(shutdown);
}
