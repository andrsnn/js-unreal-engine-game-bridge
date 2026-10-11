import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json'),{chromium}=require('playwright');
const game=process.argv[2],port={hardburn:5181,unlit:5336,saltblade:5203}[game];
if(!port)throw Error('Unknown game');
const out=`G:/sfx/evidence/${game}/deadline-${Date.now()}`,url=process.argv.find(x=>x.startsWith('--url='))?.slice(6)??`http://127.0.0.1:${port}/${game==='saltblade'?'?test=1':''}`;
await fs.mkdir(out,{recursive:true});
const report={game,url,out,errors:[],missing:[],actions:[],samples:[],freshStorage:true,originalInputOnly:true,sourcePublication:url.includes(':5191')?'compiled source-stable snapshot':'usual published address'};
const sharedBrowser=globalThis.__audioDeadlineBrowser;
const borrowedProcess=globalThis.__audioDeadlineBorrowed===true;
const browser=sharedBrowser??await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
let context,page,video,born,recordStart,recorded=false;
const hardTimeout=setTimeout(async()=>{report.errors.push('Bounded controller deadline exceeded');await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2)).catch(()=>{});await context?.close().catch(()=>{});if(!sharedBrowser){await browser.close().catch(()=>{});process.exit(1);}},540000);
console.log('OWNED_CONTROLLER_PID',process.pid);
const wait=ms=>page.waitForTimeout(ms),tap=async key=>{await page.keyboard.down(key);await wait(65);await page.keyboard.up(key);await wait(130);};
const note=(action,data)=>{report.actions.push({at:(Date.now()-born)/1000,action,data});console.log(action,data?JSON.stringify(data):'');};
const snap=()=>page.evaluate(game=>{
 if(game==='saltblade'){const s=__saltblade.state();return {audio:__saltblade.audio.status(),mode:s.mode,panel:s.panel,player:{x:s.player.x,y:s.player.y,water:s.player.water,state:s.player.state},enemies:s.enemies.map(e=>({id:e.id,x:e.x,y:e.y,hp:e.hp,state:e.state})),run:s.run};}
 if(game==='unlit')return {audio:__game.audio(),snapshot:__game.snapshot()};
 return {audio:__FF.world.audio.stats,seed:__FF.world.campaign.seed,time:__FF.world.campaign.time,errors:__FF.frameLog.errors};
},game);
async function record(){report.offset=(Date.now()-born)/1000;recordStart=Date.now();await page.evaluate(()=>{const stream=window.__recordOutputs?.find(d=>d.context.state==='running')?.stream??window.__saltblade?.audio.recordingStream();if(!stream)throw Error('No unlocked post-master game audio');const recorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:160000}),chunks=[];recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};window.__deadlineRecording={recorder,chunks};recorder.start(500);});recorded=true;note('Post-master gameplay recording started');}
async function stop(){if(!recorded)return;report.elapsed=(Date.now()-recordStart)/1000;const audio=await page.evaluate(()=>new Promise(resolve=>{const {recorder,chunks}=__deadlineRecording;recorder.onstop=()=>{const f=new FileReader();f.onload=()=>resolve(f.result.split(',')[1]);f.readAsDataURL(new Blob(chunks,{type:'audio/webm'}))};recorder.stop();}));recorded=false;await fs.writeFile(out+'/audio.webm',Buffer.from(audio,'base64'));}
async function outputPeak(){return page.evaluate(async()=>{const d=__recordOutputs?.find(d=>d.context.state==='running');if(!d)return window.__saltblade?.audio.status().peak??null;const source=d.context.createMediaStreamSource(d.stream),meter=d.context.createAnalyser();meter.fftSize=2048;source.connect(meter);await new Promise(r=>setTimeout(r,80));const values=new Float32Array(meter.fftSize);meter.getFloatTimeDomainData(values);source.disconnect();meter.disconnect();return Math.max(...values.map(Math.abs));});}
async function walk(x,z,reach=1.8){
 note(`Walk ${x}, ${z}`);
 for(let i=0;i<100;i++){
  const s=(await snap()).snapshot,p=s.hero?.pos??s.heroPos;if(!p)throw Error('Walking without native hero');const dist=Math.hypot(x-p[0],z-p[2]);if(dist<reach)return;
  const current=s.camera?.yaw??await page.evaluate(()=>Number(__game.state.flags.shipInteriorYaw)||0),yaw=Math.atan2(p[0]-x,p[2]-z),delta=Math.atan2(Math.sin(yaw-current),Math.cos(yaw-current));
  await page.mouse.move(640,360);await page.mouse.down({button:'middle'});await wait(75);await page.mouse.move(640-delta/(s.kind==='ship'?.0035:.005),360,{steps:12});await wait(75);await page.mouse.up({button:'middle'});
  await page.keyboard.down('Shift');await page.keyboard.down('w');await wait(Math.min(600,Math.max(75,dist/12*800)));await page.keyboard.up('w');await page.keyboard.up('Shift');
 }
 throw Error(`Normal walking did not reach ${x}, ${z}`);
}
async function talk(){await tap('e');for(let i=0;i<24&&await page.locator('[data-pirate-conversation]').count();i++)await tap('e');}
try{
 context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:out,size:{width:1280,height:720}}});
 globalThis.__audioDeadlineContext=context;
 await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve();document.exitPointerLock=()=>{};window.__recordOutputs=[];const buses=new WeakMap(),connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(target,...args){if(target===this.context.destination){let bus=buses.get(this.context);if(!bus){bus=this.context.createMediaStreamDestination();buses.set(this.context,bus);__recordOutputs.push(bus);}connect.call(this,bus);}return connect.call(this,target,...args);};});
 born=Date.now();page=await context.newPage();await(await context.newCDPSession(page)).send('Emulation.setFocusEmulationEnabled',{enabled:false});video=page.video();page.setDefaultTimeout(45000);
 page.on('pageerror',e=>{report.errors.push(e.stack);console.log('PAGEERROR',e.message)});page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.missing.push({url:r.url(),status:r.status()});});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:90000});
 if(game==='saltblade'){
  await page.waitForFunction(()=>window.__saltblade?.audio,null,{timeout:120000});
  await page.locator('[data-action="new"]').click();await page.locator('#character-form input[name="name"]').fill('Ash');await page.locator('#character-form button[type="submit"]').click();
  await page.locator('#run-loadout button[type="submit"]').click();await page.locator('[data-action="room"]').first().click();
  await page.waitForFunction(()=>__saltblade.state().panel==='none'&&['fight','master','service'].includes(__saltblade.state().run.phase));
  report.before=await snap();await record();
  const until=Date.now()+42000;let turn=0,maxPeak=0;
  while(Date.now()<until){
   const s=await snap();report.samples.push({at:(Date.now()-recordStart)/1000,...s});maxPeak=Math.max(maxPeak,s.audio.peak);
   if(s.run.phase==='death'){
    note('Actual combat death',s.player);await page.screenshot({path:out+'/death.png'});await wait(650);
    if(await page.locator('[data-action="return-hub"]').isVisible()){await page.locator('[data-action="return-hub"]').click();await wait(650);}
    await page.locator('#run-loadout button[type="submit"]').waitFor({state:'visible'});
    await page.locator('#run-loadout button[type="submit"]').click();await page.locator('[data-action="room"]').first().click();
    await page.waitForFunction(()=>__saltblade.state().panel==='none'&&['fight','master','service'].includes(__saltblade.state().run.phase));note('Original return to camp and next run');continue;
   }
   if(s.panel==='reward'){await page.locator('[data-action="reward"]').first().click();continue;}
   if(s.panel==='route'){await page.locator('[data-action="room"]').first().click();continue;}
   const target=s.enemies.filter(e=>e.hp>0).sort((a,b)=>Math.hypot(a.x-s.player.x,a.y-s.player.y)-Math.hypot(b.x-s.player.x,b.y-s.player.y))[0];
   if(target){
    const screen=await page.evaluate(e=>{const w=__saltblade.platform.scene.world;return {x:w.x+(e.x-e.y)*100*w.scale.x,y:w.y+(e.x+e.y)*50*w.scale.y}},target);
    await page.mouse.move(Math.max(5,Math.min(1275,screen.x)),Math.max(5,Math.min(715,screen.y-30)));
    const dx=target.x-s.player.x,dy=target.y-s.player.y,d=Math.hypot(dx,dy);
    if(d>1.45){const sx=dx-dy,sy=dx+dy,keys=[];if(Math.abs(sx)>.35)keys.push(sx>0?'d':'a');if(Math.abs(sy)>.35)keys.push(sy>0?'s':'w');for(const k of keys)await page.keyboard.down(k);await wait(Math.min(350,d*100));for(const k of keys)await page.keyboard.up(k);}
    if(target.state==='windup'){await page.keyboard.down('Space');await wait(275);await page.keyboard.up('Space');}else if(turn%5===0)await tap('Space');
    await tap(turn%7===0?'u':'j');if(turn%11===3)await tap('q');if(turn%13===6)await tap('g');
   }else await wait(400);
   turn++;
  }
  await wait(Math.max(0,42000-(Date.now()-recordStart)));await stop();report.after=await snap();report.maximumObservedPeak=maxPeak;
  if(!report.after.audio.played.slash||!report.after.audio.played['blade-windup']||report.after.audio.context!=='running')throw Error('Real combat audio not exercised');
  if(report.after.audio.voices>18)throw Error('Voice cap exceeded');
  await page.keyboard.press('Escape');await wait(250);report.paused=await snap();await page.locator('[data-action="mute"]').click();await wait(800);report.mute=await snap();report.mutePeak=await outputPeak();if(!report.mute.audio.muted||report.mutePeak>.00003)throw Error('Persistent Sound mute failed');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__saltblade?.audio,null,{timeout:120000});report.reload=await snap();if(!report.reload.audio.muted)throw Error('Mute not persistent across reload');
  await page.locator('[data-action="mute"]').click();await wait(500);report.restored=await snap();if(report.restored.audio.muted)throw Error('Sound restore failed');
  const background=await context.newPage();await(await context.newCDPSession(background)).send('Emulation.setFocusEmulationEnabled',{enabled:false});await background.goto('about:blank');await background.bringToFront();await wait(500);report.blurred=await snap();if(report.blurred.audio.focused)throw Error('Real browser blur did not suspend sound');await page.bringToFront();await wait(350);report.refocused=await snap();await background.close();if(!report.refocused.audio.focused)throw Error('Real browser focus did not restore sound');note('Normal New Game, combat, mute, reload persistence and focus passed');
 }else if(game==='unlit'){
  await page.locator('[data-new]').click();await page.locator('[data-begin]').click();await page.waitForFunction(()=>window.__game?.ready&&__game.sceneName==='planet'&&!__game.snapshot().menuPaused,null,{timeout:180000});
  if(!await page.locator('[data-galaxy-war]').isVisible())await tap('o');await page.locator('.rescue-node[data-system="helios"]').click();await page.locator('[data-opening-track]').click();await page.waitForFunction(()=>__game.ready&&!__game.snapshot().menuPaused&&__game.snapshot().pirateDock?.stage==='meet',null,{timeout:180000});
  for(const [x,z]of [[-64,72],[-48,65],[-61,80],[-66,84]])await walk(x,z);await talk();note('Sam opening conversation');
  await record();report.cutterAudioOffset=(Date.now()-recordStart)/1000;
  // Genuine cutter contact, before freight handling. No state/terrain injections.
  await tap('3');await page.mouse.move(640,360);await page.mouse.down({button:'middle'});await wait(75);await page.mouse.move(640,485,{steps:12});await wait(75);await page.mouse.up({button:'middle'});await page.mouse.down();await wait(1800);await page.mouse.up();report.cutter=await snap();await page.mouse.move(640,360);await page.mouse.down({button:'middle'});await wait(75);await page.mouse.move(640,235,{steps:12});await wait(75);await page.mouse.up({button:'middle'});
  for(let i=0;i<3;i++){
   if(i===0){await walk(-66,94);await walk(-91,94);}else await walk(-88,64);
   let s=(await snap()).snapshot;await walk(s.pirateDock.sites.freight.x,s.pirateDock.sites.freight.z);await tap('e');await page.waitForFunction(()=>__game.snapshot().pirateDock.carrying,null,{timeout:10000});note('Pick up native freight',i+1);
   if(i===0){await walk(-91,65);await walk(-79,66);}else await walk(-88,64);
   s=(await snap()).snapshot;await walk(s.pirateDock.ramp.x,s.pirateDock.ramp.y);await tap('e');await page.waitForFunction(n=>__game.snapshot().pirateDock.crates===n,i+1,{timeout:10000});note('Load native freight',i+1);
  }
  let s=(await snap()).snapshot;await walk(s.pirateDock.sam.x,s.pirateDock.sam.z);await talk();report.alarm=await snap();
  await tap('2');await page.mouse.move(640,360);await page.mouse.down({button:'right'});await page.mouse.down();await wait(800);await page.mouse.up();await page.mouse.up({button:'right'});report.rifle=await snap();
  s=(await snap()).snapshot;await walk(s.pirateDock.ramp.x,s.pirateDock.ramp.y);await tap('e');await page.waitForFunction(()=>__game.ready&&__game.sceneName==='ship-interior'&&__game.snapshot().kind==='ship',null,{timeout:180000});
  s=(await snap()).snapshot;const helm=s.interactables.find(x=>x.id==='helm');if(!helm)throw Error('No original helm interactable');await walk(helm.position[0],helm.position[2],1.8);await tap('e');await page.waitForFunction(()=>__game.ready&&__game.sceneName==='planet',null,{timeout:180000});await wait(1700);report.before=await snap();report.flightAudioOffset=(Date.now()-recordStart)/1000;const flightStarted=Date.now();
  await page.mouse.move(640,360);await page.keyboard.down('w');await wait(2000);report.samples.push({action:'native W thrust',...(await snap())});await page.keyboard.down('Shift');await wait(1600);report.samples.push({action:'native Shift boost',...(await snap())});await page.keyboard.up('Shift');await page.keyboard.up('w');await tap('x');await wait(1300);report.samples.push({action:'native X brake',...(await snap())});
  await page.keyboard.down('w');await page.keyboard.down('ArrowUp');
  while(Date.now()-flightStarted<42000){const state=await snap();report.samples.push({at:(Date.now()-recordStart)/1000,...state});if(state.snapshot.pirate?.decisionOpen){await page.keyboard.up('w');await page.keyboard.up('ArrowUp');await tap('1');await page.mouse.move(640,360);await page.keyboard.down('w');await page.keyboard.down('ArrowUp');note('Original Keep her, run decision');}await wait(1000);}
  await page.keyboard.up('w');await page.keyboard.up('ArrowUp');report.flightSeconds=(Date.now()-flightStarted)/1000;await stop();report.after=await snap();
  const boost=report.samples.find(x=>x.action==='native Shift boost');if(!boost?.audio.physical?.events?.boost)throw Error('Actual native boost did not reach the physical mixer '+JSON.stringify(boost?.audio));
  if(report.after.audio.revision!==14||report.after.audio.audioPass!==5||report.after.audio.physical.failed)throw Error('Published physical bank incorrect');
  await page.keyboard.press('Escape');await page.locator('[data-settings]').click();await page.locator('[data-mute]').check();await wait(1000);report.mutePeak=await outputPeak();if(!await page.evaluate(()=>__game.audio().settings.muted)||report.mutePeak>.00003)throw Error('Unlit native mixer mute failed');await page.locator('[data-mute]').uncheck();await page.locator('[data-back]').click();await page.locator('[data-resume]').click();note('Opening freight, rifle, helm, throttle, boost and audio controls passed');
 }else{
  await page.waitForFunction(()=>window.__FF_READY,null,{timeout:180000});await page.getByRole('button',{name:'NEW GAME',exact:true}).click();await page.getByRole('button',{name:'BEGIN NEW CAMPAIGN',exact:true}).click();await page.waitForFunction(()=>__FF_READY&&!document.querySelector('.hard-burn-menu'),null,{timeout:180000});await page.evaluate(async()=>{await __FF.modelsReady();await __FF.world.audio.preload;});report.before=await snap();
  await page.getByRole('button',{name:'SELECT FLEET',exact:true}).click();await page.keyboard.press('f');await page.mouse.click(810,410,{button:'right'});await wait(3500);await page.keyboard.down('a');await wait(1100);await page.keyboard.up('a');report.after=await snap();
  await page.locator('.audio-toggle').click();const music=page.locator('[data-audio-bus="music"]'),prefs=await page.evaluate(()=>({...__FF.world.audio.prefs}));await music.press('Home');if(await page.evaluate(()=>__FF.world.audio.prefs.music)!==0)throw Error('Music zero failed');for(let i=0;i<Math.round(prefs.music*100);i++)await music.press('ArrowRight');await page.locator('.audio-mixer').getByRole('button',{name:'MUTE',exact:true}).click();await wait(850);report.mutePeak=await outputPeak();if(report.mutePeak>.00003)throw Error('Hard Burn native mixer mute failed');await page.locator('.audio-mixer').getByRole('button',{name:'UNMUTE',exact:true}).click();await page.locator('.audio-toggle').click();
  if(report.after.audio.loaded!==321||report.after.audio.missing||report.after.errors.length)throw Error('Hard Burn compiled New Game failed');note('New Game, original fleet/move, 321 buffers and native mixer passed');
 }
 if(report.errors.length||report.missing.length)throw Error('Runtime/asset errors recorded');await page.screenshot({path:out+'/new-game.png'});report.ok=true;
}catch(e){report.errors.push(e.stack);console.log('FAILED',e.stack);process.exitCode=1;await page?.screenshot({path:out+'/failed.png',timeout:15000}).catch(()=>{});}
finally{await stop().catch(e=>report.errors.push(e.stack));await context?.close();if(video)report.video=await video.path();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));const timeout=borrowedProcess?null:setTimeout(()=>process.exit(process.exitCode||0),15000);if(!sharedBrowser)await browser.close();if(timeout)clearTimeout(timeout);clearTimeout(hardTimeout);if(globalThis.__audioDeadlineContext===context)delete globalThis.__audioDeadlineContext;console.log(JSON.stringify({out,ok:report.ok,errors:report.errors.length,missing:report.missing.length,elapsed:report.elapsed}));}
export {report};
