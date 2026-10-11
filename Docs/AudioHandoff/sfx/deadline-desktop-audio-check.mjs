import {launchHidden} from 'file:///C:/Users/Aidan%20Anderson/falling-frontier-clone/desktop/automation.mjs';
import fs from 'node:fs/promises';
import {foreignBrowserOwners} from './deadline-slot.mjs';
const owners=foreignBrowserOwners();if(owners.length)throw Error('Browser slot busy: '+JSON.stringify(owners));
const release='G:/HardBurnDesktop/release',out='G:/sfx/evidence/hardburn/desktop-deadline';
await fs.mkdir(out,{recursive:true});const report={release:JSON.parse(await fs.readFile(release+'/RELEASE.json','utf8')),errors:[],missing:[],originalInputOnly:true};let running;
const limit=setTimeout(async()=>{report.errors.push('Bounded hidden audio check exceeded five minutes');await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await running?.close();process.exit(1)},300000);
try{
 running=await launchHidden({executable:release+'/win-unpacked/HardBurn.exe',userData:out+'/fresh-user-data'});console.log('OWNED_HIDDEN_AUDIO_PID',running.pid);const raced=foreignBrowserOwners();if(raced.length)throw Error('Browser handoff raced: '+JSON.stringify(raced));
 const {page,context}=running;await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve();});
 page.on('pageerror',e=>report.errors.push(e.stack));page.on('response',r=>{if(r.status()>=400)report.missing.push({url:r.url(),status:r.status()})});
 await page.goto('hardburn://game/index.html');await page.waitForFunction(()=>window.__FF_READY,null,{timeout:180000});
 await page.getByRole('button',{name:'NEW GAME',exact:true}).click();await page.getByRole('button',{name:'BEGIN NEW CAMPAIGN',exact:true}).click();await page.waitForFunction(()=>__FF_READY&&!document.querySelector('.hard-burn-menu'),null,{timeout:180000});
 await page.evaluate(async()=>{await __FF.world.audio.preload});await page.getByRole('button',{name:'SELECT FLEET',exact:true}).click();await page.keyboard.press('f');await page.waitForTimeout(1800);
 const snapshot=()=>page.evaluate(()=>({context:__FF.world.audio.context.state,stats:{...__FF.world.audio.stats},prefs:{...__FF.world.audio.prefs},errors:__FF.frameLog.errors}));
 report.before=await snapshot();if(report.before.context!=='running'||report.before.stats.loaded!==321||report.before.stats.missing||report.before.stats.audioPass!==7||report.before.errors.length)throw Error('Packaged New Game audio not ready');
 const peak=()=>page.evaluate(async()=>{const a=__FF.world.audio,b=new Float32Array(a.meter.fftSize);let peak=0;for(let i=0;i<12;i++){a.meter.getFloatTimeDomainData(b);for(const x of b)peak=Math.max(peak,Math.abs(x));await new Promise(r=>setTimeout(r,50));}return peak});
 report.runningPeak=await peak();if(report.runningPeak<=.00003)throw Error('Packaged game output is silent');
 await page.locator('.audio-toggle').click();const mixer=page.locator('.audio-mixer');await mixer.getByRole('button',{name:'MUTE',exact:true}).click();await page.waitForTimeout(900);report.muted=await snapshot();report.mutePeak=await peak();if(!report.muted.prefs.muted||report.mutePeak>.00003)throw Error('Packaged UI MUTE failed');
 await mixer.getByRole('button',{name:'UNMUTE',exact:true}).click();await page.waitForTimeout(500);report.restored=await snapshot();report.restorePeak=await peak();if(report.restored.prefs.muted||report.restorePeak<=.00003)throw Error('Packaged UI sound restore failed');await page.locator('.audio-toggle').click();
 report.status=await page.evaluate(()=>hardBurnDesktop.status());if(!report.status.hidden||report.status.windows.some(w=>w.visible))throw Error('Hidden window invariant failed');
 await page.screenshot({path:out+'/new-game.png'});if(report.errors.length||report.missing.length)throw Error('Packaged runtime/asset errors');report.ok=true;
}catch(e){report.errors.push(e.stack);process.exitCode=1;console.log('FAILED',e.stack)}
finally{await running?.close();clearTimeout(limit);await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,errors:report.errors.length,missing:report.missing.length}));}
