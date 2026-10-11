import {readFileSync,writeFileSync} from 'node:fs';
let test=readFileSync('tools/critic-ship-service-r117.mjs','utf8').replaceAll('ship-service-r117-critic','port-audio-r118-critic');
const added=String.raw`
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
`;
test=test.replace(" check('no browser runtime errors'",added+" check('no browser runtime errors'");writeFileSync('tools/critic-port-audio-r118.mjs',test);
