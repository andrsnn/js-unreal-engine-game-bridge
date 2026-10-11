import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire('/mnt/c/Users/Aidan Anderson/saltblade/package.json');
const {chromium}=require('@playwright/test');
const out='/mnt/g/sfx/evidence/saltblade/openworld-'+Date.now();await fs.mkdir(out,{recursive:true});
const url=process.env.SFX_SALT_URL||'http://100.69.252.53:5203/?test=1';
const report={url,out,startedUTC:new Date().toISOString(),originalInputOnly:true,gameplayStateInjection:false,errors:[],missing:[],snapshots:[]};
let browser,context,page;const watchdog=setTimeout(async()=>{await browser?.close().catch(()=>{});process.exitCode=1},180000);
try{
 browser=await chromium.launch({headless:true,executablePath:'/home/aidan/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
 context=await browser.newContext({viewport:{width:1280,height:720}});
 await context.addInitScript(()=>{
  Element.prototype.requestPointerLock=()=>Promise.resolve();
  const connect=AudioNode.prototype.connect;window.__sfxMeters=[];
  AudioNode.prototype.connect=function(...args){const result=connect.apply(this,args);if(args[0] instanceof AudioDestinationNode){const meter=this.context.createAnalyser();meter.fftSize=2048;connect.call(this,meter);window.__sfxMeters.push(meter)}return result};
 });
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('pageerror',e=>report.errors.push(e.stack));page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.missing.push({url:r.url(),status:r.status()})});
 const snap=async label=>{const s=await page.evaluate(()=>{const w=window.__world,s=w?.sim.s;let peak=0,rms=0;for(const m of window.__sfxMeters){const a=new Float32Array(m.fftSize);m.getFloatTimeDomainData(a);let e=0;for(const v of a){peak=Math.max(peak,Math.abs(v));e+=v*v}rms=Math.max(rms,Math.sqrt(e/a.length))}return {audio:w?.sfx?.status?.(),mode:s?.mode,noise:s?.noise,giant:s?.giant.state,position:s?.mode==='fly'?{x:s.craft.x,y:s.craft.y,z:s.craft.z}:s?.player,peak,rms,map:w?.mapOpen}});report.snapshots.push({label,...s});return s};
 const measure=async label=>{let peak=0,rms=0;for(let i=0;i<12;i++){await page.waitForTimeout(100);const s=await snap(label);peak=Math.max(peak,s.peak);rms=Math.max(rms,s.rms)}return{peak,rms}};
 await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.waitForFunction(()=>window.__world?.sfx?.status,null,{timeout:60000});
 report.before=await snap('fresh-camp-before-input');await page.keyboard.press('e');await page.waitForTimeout(900);report.board=await snap('board-native-E');if(report.board.mode!=='fly')throw Error('Native boarding failed');
 await page.keyboard.down('Space');await page.keyboard.down('d');await page.keyboard.down('s');report.flapping=await measure('native-flapping');await page.waitForTimeout(4500);await page.keyboard.up('Space');report.gliding=await measure('native-gliding');await page.keyboard.up('d');await page.keyboard.up('s');
 if(report.flapping.peak<.0001||report.gliding.peak<.00003)throw Error('Flight mix silent');
 await page.keyboard.press('m');await page.waitForTimeout(500);report.mapPaused=await measure('map-paused');if(report.mapPaused.peak>.00003)throw Error('Map audio did not stop');await page.keyboard.press('m');await page.waitForTimeout(300);report.mapRestored=await measure('map-restored');if(report.mapRestored.peak<.00003)throw Error('Map resume silent');
 const toggle=page.locator('[data-world-audio]');if(await toggle.count()!==1)throw Error('World sound control missing');await toggle.click();await page.waitForTimeout(600);report.muted=await measure('native-mute');if(report.muted.peak>.00003)throw Error('Master mute leaked');await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__world?.sfx?.status);report.reloadMuted=await snap('reload-muted');if(!report.reloadMuted.audio?.muted)throw Error('Mute preference not persisted');await page.locator('[data-world-audio]').click();report.restored=await measure('native-restore');if(report.restored.peak<.00003)throw Error('Trusted restore silent');
 await page.screenshot({path:out+'/openworld-sound.png'});
 if(report.errors.length||report.missing.length)throw Error('Runtime or HTTP errors');report.ok=true;
}catch(e){report.errors.push(e.stack);await page?.screenshot({path:out+'/failed.png',timeout:10000}).catch(()=>{});report.ok=false}
finally{await context?.close().catch(()=>{});await browser?.close().catch(()=>{});clearTimeout(watchdog);report.completedUTC=new Date().toISOString();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,errors:report.errors,flapping:report.flapping,gliding:report.gliding,muted:report.muted}));process.exitCode=report.ok?0:1}
