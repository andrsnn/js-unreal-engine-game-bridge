import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json');
const {chromium}=require('playwright');
const game=process.argv[2],mode=process.argv[3]||'new',version=process.argv[4]||'1';
const realFight=game==='hardburn'&&Number(version)>=6;
const port={hardburn:5190,karvos:5191,unlit:5192}[game];if(!port)throw Error('Unknown game');
const url=process.env.AUDIO_URL||`http://127.0.0.1:${port}/`,out=Number(version)>=2?`G:/sfx/evidence/${game}/pass${version}/${mode}`:`G:/sfx/evidence/${game}/${mode}-v${version}`;await fs.mkdir(out,{recursive:true});
const errors=[],missing=[],actions=[];let context,page,video,offset,elapsed,before,after,recorded=false;
let storageState;
if(game==='unlit'&&mode==='fixture') {const save=Number(version)>=3?'owner7-rest-native-last-save.json':'owner-fixes-mine-native-last-save.json';storageState=JSON.parse(await fs.readFile('C:/Users/Aidan Anderson/space-game-asset-sources/owner-more/'+save,'utf8'));for(const o of storageState.origins)o.origin=url.slice(0,-1);actions.push({action:'Resume existing native gameplay save',file:save});}
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const snapshot=()=>page.evaluate(game=>{
 if(game==='hardburn'){const f=__FF;return {audio:f.world.audio.stats,time:f.world.campaign?.time,frameErrors:f.frameLog?.errors,weaponEvents:f.world.fittedWeaponEvents?.slice(-80),raid:f.world.campaign?.openingRaid,units:f.world.campaign?.units?.map(u=>({id:u.id,hp:u.hp,dead:u.dead,x:u.x,z:u.z}))};}
 if(game==='karvos'){const k=karvos,s=k.state;return {audio:s.audioMixStatus,mode:s.mode,started:s.started,pos:s.pos.toArray(),health:s.health,ammo:s.ammo,reserve:s.reserve,shotSerial:s.shotSerial,kills:s.kills,musicVolume:s.musicVolume};}
 return {audio:__game.audio(),snapshot:__game.snapshot()};
},game);
const held=async(key,ms)=>{await page.keyboard.down(key);try{await page.waitForTimeout(ms);}finally{await page.keyboard.up(key);}};
try{
 context=await browser.newContext({storageState,reducedMotion:'reduce',viewport:{width:1280,height:720},recordVideo:{dir:out,size:{width:1280,height:720}}});
 await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve();document.exitPointerLock=()=>{};window.__recordOutputs=[];const destinations=new WeakMap(),connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(target,...rest){if(target instanceof AudioDestinationNode){let bus=destinations.get(this.context);if(!bus){bus=this.context.createMediaStreamDestination();destinations.set(this.context,bus);__recordOutputs.push(bus);}connect.call(this,bus);}return connect.call(this,target,...rest);};});
 if(realFight){const bytes=await fs.readFile('G:/HardBurnScratch/expanse-89/depth90/latest-save.json');const saved=JSON.parse(bytes.toString('utf8'));await context.addInitScript(s=>localStorage.setItem('ff-galaxy-v1',JSON.stringify(s)),saved);actions.push({action:'Continue exact genuine paid campaign; no injected units/resources/damage',save:'G:/HardBurnScratch/expanse-89/depth90/latest-save.json',sha256:createHash('sha256').update(bytes).digest('hex'),time:saved.time,seed:saved.seed});}
 if(game==='hardburn'&&mode==='fixture'&&!realFight){const {ordnanceState}=await import('file:///G:/sfx/hardburn/tools/owner-ordnance-state-14.mjs');await context.addInitScript(s=>localStorage.setItem('ff-galaxy-v1',JSON.stringify(s)),ordnanceState('frenzy'));}
 const born=Date.now();page=await context.newPage();video=page.video();page.setDefaultTimeout(180000);
 page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.message);});page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))missing.push({url:r.url(),status:r.status()});});
 console.log('NAVIGATE',game,mode);await page.goto(url,{waitUntil:'domcontentloaded',timeout:180000});console.log('LOADED',game,mode);
 if(game==='hardburn'){
  await page.waitForFunction(()=>window.__FF_READY,null,{timeout:240000});
  if(mode==='fixture')await page.getByRole('button',{name:'CONTINUE CAMPAIGN',exact:true}).click();else{await page.getByRole('button',{name:'NEW GAME',exact:true}).click();await page.getByRole('button',{name:'BEGIN NEW CAMPAIGN',exact:true}).click();}
  await page.waitForFunction(()=>window.__FF_READY&&!document.querySelector('.hard-burn-menu'),null,{timeout:240000});
  await page.evaluate(async()=>{await __FF.modelsReady();await __FF.world.audio.preload;await __FF.world.audio.context.resume();});
  if(mode==='fixture'&&!realFight){const {startOrdnance}=await import('file:///G:/sfx/hardburn/tools/owner-ordnance-state-14.mjs');await page.evaluate(startOrdnance,'frenzy');}
 }else if(game==='karvos'){
  await page.waitForFunction(()=>window.karvos?.ready,null,{timeout:240000});
  if(await page.locator('#newGame').isVisible()){await page.locator('#newGame').click();await page.waitForFunction(()=>window.karvos?.ready,null,{timeout:240000});}
  await page.locator('#beginGame').click();await page.waitForFunction(()=>karvos.state.started&&karvos.state.mode==='game',null,{timeout:120000});
  await page.evaluate(async()=>{await karvos.fieldAudio.audio.ready();});
 }else{
  if(mode==='fixture')await page.locator('[data-continue]').click();else{await page.locator('[data-new]').click({force:true});await page.locator('[data-new-form] input').fill('Audio v1 new journey');await page.locator('[data-begin]').click({force:true});}
  for(let attempt=0;attempt<15;attempt++){try{await page.waitForFunction(mode=>window.__game?.ready&&(mode==='fixture'?__game.sceneName==='dungeon':__game.sceneName!=='title'),mode,{timeout:20000});break;}catch(e){if(attempt===14)throw e;if(mode==='fixture'&&await page.locator('[data-continue]').isVisible())await page.locator('[data-continue]').click({force:true});console.log('WAITING',game,mode,attempt+1);}}
  if(await page.locator('[data-galaxy-war]').isVisible()){if(mode==='new'){await page.locator('[data-system="helios"]').click();await page.locator('[data-opening-track]').click();}else await page.keyboard.press('Escape');}
  await page.waitForFunction(()=>!__game.snapshot().menuPaused,null,{timeout:120000});
 }
 console.log('READY',game,mode);before=await snapshot();if(Number(version)>=2){const actual=game==='unlit'?before.audio?.audioPass:before.audio?.audioPass;if(actual!==Number(version))throw Error('Wrong audio pass '+actual+' expected '+version);}
 await page.screenshot({path:out+'/start.png'});
 await page.mouse.click(640,360);await page.evaluate(async()=>{for(const d of __recordOutputs)if(d.context.state==='suspended')await d.context.resume();});
 await page.waitForTimeout(1500);
 if(mode==='new'){
  const initial=await snapshot();await held(game==='hardburn'?'a':'w',1500);const moved=await snapshot();actions.push({action:'Normal New Game and input',initial,moved});
  await page.screenshot({path:out+'/new-game.png'});
 }
 if(realFight){
  const resumed=await page.evaluate(()=>({time:__FF.world.campaign.time,seed:__FF.world.campaign.seed}));const expected=actions.find(a=>a.sha256);if(resumed.seed!==expected.seed||resumed.time<expected.time||resumed.time>expected.time+90)throw Error('Genuine checkpoint seed/time mismatch '+JSON.stringify(resumed));
  const baseline=await page.evaluate(()=>__FF.world.t);
  await page.getByRole('button',{name:'SELECT FLEET',exact:true}).click();
  await page.evaluate(()=>{__FF.world.galactic.setStance('aggressive');__FF.world.galactic.fleetOrder('attack');__FF.world.galactic.fleetOrder('focus');});
  let exchanged=false;
  for(let attempt=0;attempt<36;attempt++){
   exchanged=await page.evaluate(at=>{const w=__FF.world,local=[...w.galactic.units.values()].filter(u=>u.systemId===w.campaign.activeSystem),own=new Set(local.filter(u=>u.faction==='player').map(u=>u.grp.id)),targets=new Set(local.filter(u=>u.faction!=='player').map(u=>u.name));return(w.fittedWeaponEvents??[]).some(e=>e.at>=at&&own.has(e.id)&&targets.has(e.target));},baseline);
   if(exchanged)break;
   if(attempt%4===0)console.log('WAITING REAL LOCAL EXCHANGE',attempt,await page.evaluate(()=>({time:__FF.world.campaign.time,events:__FF.world.fittedWeaponEvents?.slice(-2),raid:__FF.world.campaign.openingRaid?.stage})));
   await page.waitForTimeout(5000);
  }
  if(!exchanged)throw Error('No genuine local player-target exchange within 180 seconds');
  await page.keyboard.press('b');await page.waitForTimeout(1200);
  actions.push({action:'Original selectCombat / aggressive stance / attack / focus / B closeBattle; recording anchored to actual local player-target weapon event',baseline,evidence:await snapshot()});
  before=await snapshot();
 }
 offset=(Date.now()-born)/1000;
 await page.evaluate(()=>{const d=__recordOutputs.find(d=>d.context.state==='running');if(!d)throw Error('Game audio output was not connected');const chunks=[],recorder=new MediaRecorder(d.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:160000});recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};window.__recording={recorder,chunks};recorder.start(500);});
 recorded=true;const started=Date.now();
 if(game==='hardburn'){
  if(realFight){
   await page.waitForTimeout(12000);await page.screenshot({path:out+'/combat.png'});await page.mouse.wheel(0,220);await page.waitForTimeout(11000);await page.mouse.wheel(0,-220);await page.waitForTimeout(17000);
  }else if(mode==='fixture'){
   await page.waitForTimeout(11000);await page.screenshot({path:out+'/combat.png'});await page.mouse.wheel(0,-300);await page.waitForTimeout(7000);await page.mouse.wheel(0,300);await page.waitForTimeout(Number(version)>=4?22000:17000);
  }else{
   await page.getByRole('button',{name:'SELECT FLEET',exact:true}).click();await page.keyboard.press('f');await page.waitForTimeout(7000);await page.mouse.click(790,380,{button:'right'});await page.waitForTimeout(7000);await page.mouse.wheel(0,-250);await page.waitForTimeout(8000);await page.screenshot({path:out+'/drive.png'});await page.mouse.wheel(0,250);await page.waitForTimeout(13000);
  }
 }else if(game==='karvos'){
  await held('w',3500);await held('d',1200);await page.keyboard.press('y');await page.mouse.move(640,340);await page.mouse.down({button:'right'});await page.mouse.down();await page.waitForTimeout(1700);await page.mouse.up();await page.mouse.up({button:'right'});await page.keyboard.press('r');await page.waitForTimeout(4000);await page.screenshot({path:out+'/fire-reload.png'});await held('s',2000);await page.mouse.down({button:'right'});for(let i=0;i<6;i++){await page.mouse.down();await page.waitForTimeout(400);await page.mouse.up();await page.waitForTimeout(550);}await page.mouse.up({button:'right'});await page.keyboard.press('r');await page.waitForTimeout(4000);await held('a',1500);await held('w',2500);await page.waitForTimeout(8500);
 }else{
  await page.mouse.move(640,360);await page.keyboard.press('2');await page.mouse.down({button:'right'});await page.mouse.down();
  for(let i=0;i<6;i++){await held(i%2?'a':'d',2500);await page.mouse.move(640+(i%2?40:-40),360);await page.keyboard.press('r');await page.waitForTimeout(2300);if(i===2)await page.screenshot({path:out+'/combat.png'});}
  await page.mouse.up();await page.mouse.up({button:'right'});await page.keyboard.press('3');await page.mouse.down();await page.waitForTimeout(4500);await page.mouse.up();await page.waitForTimeout(1500);
 }
 elapsed=(Date.now()-started)/1000;after=await snapshot();
 const audio=await page.evaluate(()=>new Promise(resolve=>{const {recorder,chunks}=__recording;recorder.onstop=()=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(new Blob(chunks,{type:'audio/webm'}));};recorder.stop();}));recorded=false;await fs.writeFile(out+'/audio.webm',Buffer.from(audio,'base64'));await page.screenshot({path:out+'/end.png'});
 const levels=await page.evaluate(async game=>{
  const d=__recordOutputs.find(d=>d.context.state==='running');const analyser=d.context.createAnalyser(),tap=d.context.createMediaStreamSource(d.stream);tap.connect(analyser);const buffer=new Float32Array(analyser.fftSize);
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),peak=()=>{analyser.getFloatTimeDomainData(buffer);return Math.max(...buffer.map(Math.abs));};
  let prefs,save,muted,zero,restored;
  if(game==='hardburn'){const a=__FF.world.audio;prefs={...a.prefs};a.setLevel('muted',true);await wait(650);muted={peak:peak(),value:a.prefs.muted};a.setLevel('muted',false);a.setLevel('music',0);zero={music:a.prefs.music};for(const [key,value]of Object.entries(prefs))a.setLevel(key,value);restored={...a.prefs};}
  else if(game==='karvos'){const a=karvos.state;prefs={master:a.audioVolume,music:a.audioMix.music,muted:a.audioMuted};a.audioMuted=true;await wait(650);muted={peak:peak(),value:a.audioMuted};a.audioMuted=false;a.audioMix.music=0;await wait(200);zero={music:a.audioMix.music};a.audioVolume=prefs.master;a.audioMix.music=prefs.music;a.audioMuted=prefs.muted;restored={master:a.audioVolume,music:a.audioMix.music,muted:a.audioMuted};}
  else{const {gameAudio:a}=await import('/src/core/audio.ts');prefs={...a.settings};a.setSettings({muted:true});await wait(650);muted={peak:peak(),value:a.settings.muted};a.setSettings({muted:false,music:0});zero={music:a.settings.music};a.setSettings(prefs);restored={...a.settings};}
  tap.disconnect();analyser.disconnect();if(muted.peak>.00003||muted.value!==true||zero.music!==0)throw Error('Runtime mixer mute/zero failed '+JSON.stringify({muted,zero}));return {prefs,muted,zero,restored};
 },game);actions.push({action:'Real output mute and music zero/restore',levels});

 console.log('RECORDED',JSON.stringify({game,mode,elapsed,errors,missing,audioBefore:before?.audio?.revision??before?.audio?.loaded,audioAfter:after?.audio?.motion??after?.audio?.events}));
}catch(e){errors.push(e.stack);process.exitCode=1;console.log('FAILED',e.stack);await page?.screenshot({path:out+'/failed.png',timeout:20000}).catch(()=>{});}
finally{if(recorded)await page?.evaluate(()=>__recording.recorder.stop()).catch(()=>{});await context?.close();if(video)await fs.writeFile(out+'/video-path.txt',await video.path());await fs.writeFile(out+'/report.json',JSON.stringify({game,mode,url,offset,elapsed,before,after,actions,errors,missing},null,2));const shutdown=setTimeout(()=>process.exit(process.exitCode||0),15000);await browser.close();clearTimeout(shutdown);}
if(errors.length||missing.length)process.exitCode=1;
