import './browser-safety.cjs';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const base=JSON.parse(readFileSync('shots/earned-route-r117-final/earned-save.json','utf8'));
const dir='shots/port-audio-r118-critic';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({args:['--use-gl=angle','--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1600,height:900}}),checks=[],errors=[],evidence={};
page.on('pageerror',e=>errors.push(String(e)));
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,JSON.stringify(detail??''));};
const state=()=>page.evaluate(()=>window.__game.state);
const snap=()=>page.evaluate(()=>window.__game.snapshot());
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('starweave_save_v1')));
const step=n=>page.evaluate(n=>window.__game.step(1/60,n),n);
const ready=async()=>{await page.waitForFunction(()=>window.__game?.ready);await page.evaluate(()=>window.__game.pause(true));};
const dock=async()=>{await page.keyboard.down('KeyE');await step(1);await page.keyboard.up('KeyE');await step(220);if(!(await snap()).docked)throw Error('Normal E docking failed');};
async function fixture(patch={}){const s=structuredClone(base);Object.assign(s,{hullHp:20,credits:1000},patch);await page.evaluate(s=>{localStorage.setItem('starweave_save_v1',JSON.stringify(s));history.replaceState(null,'','/?seed=42');},s);await page.reload();await ready();await dock();}
const repair=()=>page.locator('[data-port-repair]').click();
const shot=async n=>{evidence[n]=await snap();await page.screenshot({path:`${dir}/${n}.png`});};
const fit=async id=>{await page.locator('[data-swslot="segment:0"]').click();await page.locator(`[data-swuse="${id}"]`).click();};
try{
 await page.goto('http://localhost:5198/?seed=42');await ready();evidence.scripts=await page.locator('script[src]').evaluateAll(e=>e.map(e=>e.src));
 for(const system of ['helios','sirocco','cindral','pelagia','pale']){
  await fixture({travel:{...base.travel,system}});await repair();const s=await state(),disk=await saved();check(system+' normal E dock + full repair + immediate stored pair',s.hullHp===68&&s.credits===808&&disk.hullHp===68&&disk.credits===808);await page.reload();await ready();check(system+' immediate reload retains hull and credits',(await state()).hullHp===68&&(await state()).credits===808);
 }
 for(const [hull,credits,outHull,outCredits] of [[20,3,20,3],[20,4,21,0],[20.5,11,22.5,3],[67.75,1,68,0],[67.74,1,67.74,1],[67,3,67,3],[67,4,68,0],[68,100,68,100]]){
  await fixture({hullHp:hull,credits});const label=await page.locator('[data-port-repair]').innerText();if(await page.locator('[data-port-repair]').isEnabled())await repair();const s=await state();check(`boundary ${hull} hull / ${credits} credits`,Math.abs(s.hullHp-outHull)<.00001&&s.credits===outCredits,{label,hull:s.hullHp,credits:s.credits});await page.reload();await ready();check(`boundary ${hull}/${credits} durable without explicit save`,Math.abs((await state()).hullHp-outHull)<.00001&&(await state()).credits===outCredits);
 }
 await fixture({hullHp:20.5,credits:11,ownedParts:[...base.ownedParts,'seg_hauler']});await page.locator('[data-tab="shipwright"]').click();await fit('seg_hauler');
 const canvas=page.locator('[data-swcanvas]'),box=await canvas.boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:8});await page.mouse.up();await page.mouse.wheel(0,-220);await page.waitForTimeout(200);
 const beforeDraft=await page.locator('[data-swstats]').innerText(),beforeSelect=await page.locator('[data-swsel]').innerText();await canvas.evaluate(e=>window.criticCanvas=e);
 const beforeImg=await canvas.screenshot();await repair();const afterImg=await canvas.screenshot();check('partial service preserves draft, selection and canvas instance',beforeDraft===await page.locator('[data-swstats]').innerText()&&beforeSelect===await page.locator('[data-swsel]').innerText()&&await canvas.evaluate(e=>e===window.criticCanvas));check('orbit/zoom camera pixel image unchanged across repair',beforeImg.equals(afterImg));
 check('partial service on large draft repairs committed hull only',(await state()).hullHp===22.5&&(await state()).credits===3);await page.locator('[data-swapply]').click();check('applying bigger hull grants no free healing',(await state()).hullHp===22.5);await fit('seg_runner');await page.locator('[data-swapply]').click();check('down/up cycle retains paid hull',(await state()).hullHp===22.5);await fit('seg_hauler');await page.locator('[data-swapply]').click();check('second upgrade grants no hull',(await state()).hullHp===22.5);await page.reload();await ready();check('partial + applied refit persist without explicit save',(await state()).hullHp===22.5&&(await state()).credits===3&&(await state()).ship.segments[0]==='seg_hauler');
 await fixture({skills:['start','sd1','sd2','sd3']});const skillQuote=await page.locator('[data-port-hull]').innerText();await repair();check('skill hull maximum paid and stored',skillQuote==='HULL 20 / 75'&&(await state()).hullHp===75&&(await saved()).hullHp===75&&(await saved()).credits===780);
 await fixture({hullHp:20,credits:11});await page.setViewportSize({width:540,height:900});await shot('narrow-damaged-market');
 for(const width of [540,390]){await page.setViewportSize({width,height:900});await page.locator('[data-tab="shipwright"]').click();await shot(`narrow-damaged-${width}`);const hit=await page.locator('[data-port-repair]').evaluate(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hits:[.25,.5,.75,.9].map(x=>{const t=document.elementFromPoint(r.x+r.width*x,r.y+r.height*.65);return {at:x,text:t?.textContent,ours:t===e||e.contains(t)};})};});check(`repair button unobscured at ${width}`,hit.hits.every(x=>x.ours),hit);}
 await page.setViewportSize({width:1600,height:900});await fixture({hullHp:20,credits:8,cargo:{food:1}});await repair();await page.locator('[data-sell="food"]').click();check('selling cargo refreshes repair affordability',await page.locator('[data-port-repair]').isEnabled(),{credits:(await state()).credits,text:await page.locator('[data-port-repair]').innerText()});

 for(const width of [390,540,768,900,1600]){
  await page.setViewportSize({width,height:900});
  for(const tab of ['market','shipwright']){
   await fixture({hullHp:20,credits:11});await page.locator('[data-tab="'+tab+'"]').click();
   const repairHit=await page.locator('[data-port-repair]').evaluate(e=>{const r=e.getBoundingClientRect();return {text:e.textContent,rect:{x:r.x,y:r.y,w:r.width,h:r.height},hits:[.05,.5,.95].flatMap(x=>[.15,.5,.85].map(y=>{let t=document.elementFromPoint(r.x+r.width*x,r.y+r.height*y);return t===e||e.contains(t);} ))};});
   check(width+' '+tab+' partial quote fully exposed',repairHit.text==='Patch +2 hull · 8 cr'&&repairHit.hits.every(Boolean),repairHit);
   await shot('partial-'+tab+'-'+width);
   const r=await page.locator('[data-port-repair]').boundingBox();await page.mouse.click(r.x+r.width*.95,r.y+r.height*.85);check(width+' '+tab+' far right lower repair hit spends exact quote',(await state()).hullHp===22&&(await state()).credits===3);
   await page.locator('[data-port-audio]').click();
   const settings=page.locator('[data-audio-settings]');
   const audioHit=await settings.evaluate(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,within:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,controls:[...e.querySelectorAll('input,button')].map(c=>{const r=c.getBoundingClientRect(),t=document.elementFromPoint(r.x+r.width*.5,r.y+r.height*.5);return t===c||c.contains(t);})};});
   check(width+' '+tab+' audio panel and all controls exposed',audioHit.within&&audioHit.controls.every(Boolean),audioHit);
   await shot('audio-'+tab+'-'+width);
   const before=await state();await page.locator('[data-mute]').check();
   await page.locator('[data-volume="music"]').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
   check(width+' '+tab+' audio keyboard settings persist',await page.evaluate(()=>{const a=JSON.parse(localStorage.getItem('starweave_audio'));return a.muted===true&&a.music===.01;}));
   await settings.locator('[data-close]').click();
   check(width+' '+tab+' audio preserves paid hull/economy/committed ship',JSON.stringify((await state()).ship)===JSON.stringify(before.ship)&&(await state()).credits===before.credits&&(await state()).hullHp===before.hullHp);
  }
  await page.locator('[data-undock]').click();await step(1);
  const floating=page.getByRole('button',{name:'♫ Audio',exact:true});
  const launchHit=await floating.evaluate(e=>{const r=e.getBoundingClientRect(),t=document.elementFromPoint(r.x+r.width*.5,r.y+r.height*.5);return t===e||e.contains(t);});
  await floating.click();check(width+' undocked Audio opens',launchHit&&await page.locator('[data-audio-settings]').isVisible()&&!(await snap()).docked);await page.locator('[data-audio-settings] [data-close]').click();
 }
 await page.setViewportSize({width:1600,height:900});await fixture({hullHp:20,credits:1000,ownedParts:[...base.ownedParts,'seg_hauler']});await page.locator('[data-tab="shipwright"]').click();await fit('seg_hauler');
 const c=page.locator('[data-swcanvas]'),cb=await c.boundingBox();await page.mouse.move(cb.x+cb.width*.4,cb.y+cb.height*.5);await page.mouse.down();await page.mouse.move(cb.x+cb.width*.65,cb.y+cb.height*.7,{steps:6});await page.mouse.up();await page.mouse.wheel(0,-180);await page.waitForTimeout(150);
 const draftBefore=await page.locator('[data-swstats]').innerText(),selectionBefore=await page.locator('[data-swsel]').innerText(),imageBefore=await c.screenshot();await c.evaluate(e=>window.criticAudioCanvas=e);
 await page.locator('[data-port-audio]').click();await page.locator('[data-mute]').uncheck();await page.locator('[data-audio-settings] [data-close]').click();
 check('Audio preserves unapplied draft selection canvas and exact orbit image',draftBefore===await page.locator('[data-swstats]').innerText()&&selectionBefore===await page.locator('[data-swsel]').innerText()&&await c.evaluate(e=>e===window.criticAudioCanvas)&&imageBefore.equals(await c.screenshot()));
 check('no browser runtime errors',errors.length===0,errors);
}catch(e){errors.push(String(e));console.error(e);await shot('failure').catch(()=>{});}
finally{writeFileSync('reports/port-audio-r118-critic-checks.json',JSON.stringify({checks,evidence,errors},null,2));await browser.close();}
