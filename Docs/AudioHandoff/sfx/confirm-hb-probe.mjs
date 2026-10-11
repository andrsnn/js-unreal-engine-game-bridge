import fs from'node:fs/promises';
const browser=globalThis.__audioDeadlineBrowser;if(!browser)throw Error('Run in guarded confirmation batch');
const out='G:/sfx/evidence/hardburn/published-confirm-'+Date.now();await fs.mkdir(out,{recursive:true});
const report={game:'hardburn',url:'http://100.69.252.53:5181/',out,freshStorage:true,originalInputOnly:false,diagnosticAudioProbe:true,noGameplayStateChanges:true,errors:[],missing:[]};let context,page;
const limit=setTimeout(()=>context?.close().catch(()=>{}),240000);
try{
 context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:0.25});globalThis.__audioDeadlineContext=context;page=await context.newPage();await context.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve();});
 page.on('pageerror',e=>report.errors.push(e.stack));page.on('response',r=>{if(r.status()>=400)report.missing.push({url:r.url(),status:r.status()})});
 await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:60000});report.entry=await page.evaluate(()=>[...document.scripts].map(s=>s.src).find(s=>s?.includes('/assets/index-')));await page.waitForFunction(()=>window.__FF?.world?.audio,null,{timeout:90000});await page.evaluate(async()=>{await __FF.world.audio.preload});
 report.scope='Current published actual audio engine regression using public unlock/weapon/setLevel APIs; no gameplay or fresh-campaign claim';await page.evaluate(async()=>{await __FF.world.audio.unlock()});
 const snapshot=()=>page.evaluate(()=>({context:__FF.world.audio.context.state,stats:{...__FF.world.audio.stats},prefs:{...__FF.world.audio.prefs},errors:__FF.frameLog.errors}));
 report.before=await snapshot();if(report.before.context!=='running'||report.before.stats.loaded!==321||report.before.stats.missing||report.before.stats.audioPass!==7||report.before.errors.length)throw Error('Published New Game audio not ready');
 const peak=()=>page.evaluate(async()=>{const a=__FF.world.audio,b=new Float32Array(a.meter.fftSize);let peak=0;for(let i=0;i<12;i++){a.meter.getFloatTimeDomainData(b);for(const x of b)peak=Math.max(peak,Math.abs(x));await new Promise(r=>setTimeout(r,50));}return peak});
 report.weaponTriggered=await page.evaluate(()=>__FF.world.audio.weapon('proj'));report.runningPeak=await peak();if(report.runningPeak<=.00003)throw Error('Published game output is silent');
 await page.evaluate(()=>__FF.world.audio.setLevel('muted',true));await page.waitForTimeout(900);report.muted=await snapshot();report.mutePeak=await peak();if(!report.muted.prefs.muted||report.mutePeak>.00003)throw Error('Published UI MUTE failed');
 await page.evaluate(()=>__FF.world.audio.setLevel('muted',false));await page.waitForTimeout(500);report.restored=await snapshot();await page.evaluate(()=>__FF.world.audio.weapon('proj'));report.restorePeak=await peak();if(report.restored.prefs.muted||report.restorePeak<=.00003)throw Error('Published UI sound restore failed');
 if(report.restored.errors.length||report.errors.length||report.missing.length)throw Error('Published runtime/asset errors');report.ok=true;
}catch(e){report.errors.push(e.stack);process.exitCode=1;await page?.screenshot({path:out+'/failed.png',timeout:10000}).catch(()=>{});console.log('FAILED',e.stack)}
finally{clearTimeout(limit);await context?.close();if(globalThis.__audioDeadlineContext===context)delete globalThis.__audioDeadlineContext;await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,ok:report.ok,errors:report.errors.length,missing:report.missing.length}));}
export{report};
