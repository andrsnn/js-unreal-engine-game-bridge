import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const windows=process.platform==='win32';
const sfxRoot=windows?'G:/sfx':'/mnt/g/sfx';
const require=createRequire(windows?'C:/Users/Aidan Anderson/falling-frontier-clone/package.json':'/mnt/c/Users/Aidan Anderson/saltblade/package.json');
const {chromium}=require(windows?'playwright':'@playwright/test');
const out=sfxRoot+'/evidence/hardburn/solar-audio-'+Date.now();
await fs.mkdir(out+'/frames',{recursive:true});
const url='http://100.69.252.53:5181/';
const report={url,out,originalInputOnly:true,freshStorage:true,gameplayStateInjection:false,playbackSpeed:1,errors:[],missing:[],phases:[],frames:[]};
let browser,page,cdp,recording=false,frameNumber=0;
const writes=[];
const watchdog=setTimeout(async()=>{await browser?.close().catch(()=>{});process.exitCode=1},240000);
try {
 const html=await(await fetch(url,{signal:AbortSignal.timeout(10000)})).text();
 report.entry=html.match(/src="([^" ]+\.js)"/)[1];
 const js=Buffer.from(await(await fetch(new URL(report.entry,url),{signal:AbortSignal.timeout(10000)})).arrayBuffer());
 report.entrySha256=createHash('sha256').update(js).digest('hex');
 if(!js.toString().includes('ecmLoops'))throw Error('Published entry lacks solar audio pass; no browser launched');
 browser=await chromium.launch(windows?{headless:true,args:['--use-angle=d3d11','--disable-gpu-sandbox','--disable-background-timer-throttling']}:{headless:true,executablePath:'/home/aidan/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
 report.renderer=windows?'D3D11 headless':'Swiftshader headless';
 const context=await browser.newContext({viewport:{width:1920,height:1080}});
 page=await context.newPage();page.setDefaultTimeout(15000);
 await page.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve()});
 page.on('pageerror',e=>report.errors.push(e.stack));
 page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.missing.push({url:r.url(),status:r.status()})});
 const snap=async label=>report.phases.push({label,...await page.evaluate(()=>({wallEpoch:Date.now()/1000,time:__FF.world.campaign.time,audio:{...__FF.world.audio.stats},intel:__FF.world.solarIntel?.(),frameErrors:[...__FF.frameLog.errors]}))});
 const peak=()=>page.evaluate(async()=>{const a=__FF.world.audio,b=new Float32Array(a.meter.fftSize);let p=0;for(let i=0;i<16;i++){a.meter.getFloatTimeDomainData(b);for(const n of b)p=Math.max(p,Math.abs(n));await new Promise(r=>setTimeout(r,50))}return p});
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 await page.waitForFunction(()=>window.__FF_READY,null,{timeout:120000});
 await page.getByRole('button',{name:'NEW GAME',exact:true}).click();
 await page.locator('[data-faction="corsair"]').click();
 await page.getByRole('button',{name:'BEGIN NEW CAMPAIGN',exact:true}).press('Enter');
 await page.waitForFunction(()=>window.__FF_READY&&!document.querySelector('.hard-burn-menu'),null,{timeout:120000});
 await page.evaluate(async()=>{await __FF.world.audio.preload});await page.keyboard.press('f');
 await page.waitForTimeout(1400);await snap('Fresh Quietwake solar campaign');
 if(report.phases[0].audio.audioPass!==9||report.phases[0].audio.loaded!==321||report.phases[0].audio.missing)throw Error('Published pass9 bank not ready');
 await page.locator('.fleet-pick').click();await page.waitForTimeout(300);
 report.selection=await page.evaluate(()=>{const s=__FF.world.galactic.getSelected()[0];return s?{id:s.campaignUnit.id,role:s.campaignUnit.role}:null});
 if(!report.selection||report.selection.role==='builder')throw Error('Native SELECT FLEET did not select a combat ship');
 await page.keyboard.press('f');await page.waitForTimeout(1800);
 report.selectionAfterFocus=await page.evaluate(id=>{const f=__FF,s=f.world.galactic.units.get(id),r=f.renderer.domElement.getBoundingClientRect(),p=s.pos.clone().project(f.rts.cam);return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2,range:f.rts.spherical.radius}},report.selection.id);
 await page.locator('.shipcard .card-details').click();
 cdp=await context.newCDPSession(page);
 cdp.on('Page.screencastFrame',e=>{
  if(recording){
   const timestamp=e.metadata.timestamp;
   if(!Number.isFinite(timestamp)||timestamp<1e9){report.errors.push('Invalid real screencast timestamp');recording=false}
   else{const file='frames/'+String(frameNumber++).padStart(6,'0')+'.jpg';report.frames.push({file,timestamp});writes.push(fs.writeFile(out+'/'+file,Buffer.from(e.data,'base64')))}
  }
  void cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});
 });
 recording=true;
 await cdp.send('Page.startScreencast',{format:'jpeg',quality:86,maxWidth:1280,maxHeight:720,everyNthFrame:1});
 report.audioStart=await page.evaluate(()=>{const a=__FF.world.audio,output=a.context.createMediaStreamDestination();a.meter.connect(output);window.__sfxOutput=output;window.__sfxChunks=[];window.__sfxRecorder=new MediaRecorder(output.stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000});__sfxRecorder.ondataavailable=e=>{if(e.data.size)__sfxChunks.push(e.data)};const epoch=Date.now()/1000;__sfxRecorder.start(100);return{epoch,context:a.context.currentTime,performance:performance.now()}});
 await page.waitForTimeout(600);
 await page.getByRole('button',{name:/RUN (?:COLD|DARK).*JAMMER BURST/}).click();
 await page.waitForTimeout(1200);await snap('Native paid jammer burst');report.ecmPeak=await peak();
 if(report.phases.at(-1).audio.ecmLoops!==1||report.phases.at(-1).audio.ecmStrength<=0)throw Error('Actual jammer burst did not reach the receiver hiss');
 await page.locator('.solar-toolbar').getByRole('button',{name:'PING',exact:true}).click();
 await page.waitForTimeout(700);await snap('Native active sensor ping');report.pingPeak=await peak();
 if(report.phases.at(-1).audio.lastSensorEvent?.kind!=='ping')throw Error('Actual native ping not reported');
 await page.waitForTimeout(8500);
 await page.locator('.shipcard .card-details').click();
 await page.mouse.click(Math.min(1480,report.selectionAfterFocus.x+260),Math.min(750,report.selectionAfterFocus.y+70),{button:'right'});
 await page.waitForTimeout(8000);await snap('Actual short navigation burn');
 await page.locator('.shipcard .card-details').click();
 const supply=page.locator('[data-fleet-supply]');
 await page.waitForTimeout(1200);report.supply={visible:await supply.isVisible(),enabled:await supply.isEnabled(),title:await supply.getAttribute('title')};
 if(report.supply.enabled){await supply.click();await page.waitForTimeout(1200);await snap('Native paid supply shipment')}
 await page.waitForTimeout(8000);await snap('Real solar traffic and quiet bed');
 report.audioEnd=await page.evaluate(()=>Date.now()/1000);
 const audio=await page.evaluate(async()=>{const b=await new Promise(resolve=>{__sfxRecorder.onstop=()=>resolve(new Blob(__sfxChunks,{type:__sfxRecorder.mimeType}));__sfxRecorder.stop()});__FF.world.audio.meter.disconnect(__sfxOutput);const a=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<a.length;i+=32768)s+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(s)});
 recording=false;await cdp.send('Page.stopScreencast');await Promise.all(writes);
 await fs.writeFile(out+'/audio.webm',Buffer.from(audio,'base64'));
 report.elapsed=report.audioEnd-report.audioStart.epoch;
 const frames=report.frames.filter(f=>f.timestamp<=report.audioEnd);if(frames.length<10)throw Error('Too few real capture frames');
 let concat='';let last=frames.findLastIndex(f=>f.timestamp<=report.audioStart.epoch);if(last<0)last=0;
 for(let i=last;i<frames.length;i++){const begin=Math.max(report.audioStart.epoch,frames[i].timestamp),end=Math.min(report.audioEnd,frames[i+1]?.timestamp??report.audioEnd);if(end>begin)concat+="file '"+frames[i].file+"'\nduration "+(end-begin).toFixed(6)+'\n'}
 concat+="file '"+frames.at(-1).file+"'\n";
 await fs.writeFile(out+'/frames.ffconcat',concat);
 report.timestampClock='CDP screencast metadata epoch and page Date.now epoch, actual wall intervals, no respeed';
 await page.locator('.audio-toggle').click();const mixer=page.locator('.audio-mixer');await mixer.getByRole('button',{name:'MUTE',exact:true}).click();await page.waitForTimeout(700);report.mutePeak=await peak();await mixer.getByRole('button',{name:'UNMUTE',exact:true}).click();await page.waitForTimeout(500);report.restorePeak=await peak();await page.locator('.audio-toggle').click();await page.screenshot({path:out+'/native-final.png'});
 if(report.mutePeak>.00003||report.restorePeak<.00003)throw Error('Actual master mute/restore failed');
 if(report.errors.length||report.missing.length||report.phases.some(p=>p.frameErrors.length))throw Error('Actual runtime/asset errors');
 report.ok=true;
}catch(e){report.ok=false;report.errors.push(e.stack);await page?.screenshot({path:out+'/failed.png',timeout:8000}).catch(()=>{})}
finally{recording=false;await cdp?.send('Page.stopScreencast').catch(()=>{});await Promise.allSettled(writes);await browser?.close().catch(()=>{});clearTimeout(watchdog);await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await fs.writeFile(sfxRoot+'/hardburn-solar-audio-film.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,entry:report.entry,elapsed:report.elapsed,supply:report.supply,phases:report.phases.map(p=>({label:p.label,time:p.time,ecmLoops:p.audio.ecmLoops,trafficLoops:p.audio.trafficLoops,sensorPings:p.audio.sensorPings})),errors:report.errors}));process.exitCode=report.ok?0:1}
