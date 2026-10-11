import fs from'node:fs/promises';import{createRequire}from'node:module';import{createHash}from'node:crypto';import{foreignBrowserOwners}from'./deadline-slot.mjs';
const out='G:/sfx/evidence/published-confirmation-'+Date.now();await fs.mkdir(out,{recursive:true});const report={startedUTC:new Date().toISOString(),out,games:{},errors:[]};
const notes=['G:/sfx/NOTES.md','G:/JsGameBridge/NOTES.md','C:/AI/cache/tmp/claude/C--Users-Aidan-Anderson/01005298-81f3-4b3a-99f4-3cd0275c83cd/scratchpad/sfx/NOTES.md'];
const note=async message=>{for(const p of notes)await fs.appendFile(p,'\n'+message+'\n');};
let browser;const waitUntil=Date.parse('2026-10-10T22:01:00Z');
while(foreignBrowserOwners().length){if(Date.now()>waitUntil)throw Error('No global browser slot before14:57PDT');console.log('Waiting for owner browser release',new Date().toISOString());await new Promise(resolve=>setTimeout(resolve,2000));}
await note('SFX CLAIMED '+new Date().toISOString()+': one guarded browser/serial current-port audio confirmation requested by owner. ONLY correct published100.69.252.53 addresses for HB5181+UN5336; Salt5203 actual-tailnet check alreadyPASS, no Salt repeat. No recording/build/features. Please hold other browser/Electron until explicit RELEASE; typically2min, bounded12min.');
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json'),{chromium}=require('playwright');
const limit=setTimeout(async()=>{await browser?.close().catch(()=>{});process.exit(1)},Math.min(720000,Math.max(1000,Date.parse('2026-10-10T22:04:00Z')-Date.now())));
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required']});globalThis.__audioDeadlineBrowser=browser;
 const raced=foreignBrowserOwners();if(raced.length)throw Error('Browser handoff raced: '+JSON.stringify(raced));
 for(const game of ['unlit']){
  process.exitCode=0;const {report:r,publishedHB}=await import('file:///G:/sfx/confirm-'+game+'-smoke.mjs');report.games.hardburn=publishedHB;
  if(r.entry){const response=await fetch(r.entry,{signal:AbortSignal.timeout(10000)});r.entryHttpStatus=response.status;r.entrySha256=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
  report.games[r.game]=r;console.log('CHECK_COMPLETE',r.game,r.ok?'PASS':'FAIL');
 }
 report.ok=Object.values(report.games).length===2&&Object.values(report.games).every(r=>r.ok);
}catch(e){report.errors.push(e.stack);report.ok=false;console.log(e.stack)}
finally{
 await browser?.close();clearTimeout(limit);delete globalThis.__audioDeadlineBrowser;report.completedUTC=new Date().toISOString();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await note('SFX BROWSER RELEASED '+report.completedUTC+': current-port confirmation '+(report.ok?'PASS':'FAILED; investigate actual report')+'; G:/sfx/evidence/'+out.split('/').pop()+'/report.json. Own browser closed; no game code/build/recording changes.');console.log(JSON.stringify({out,ok:report.ok,games:Object.fromEntries(Object.entries(report.games).map(([k,v])=>[k,{ok:v.ok,errors:v.errors.length,missing:v.missing.length,entry:v.entry}]))}));process.exitCode=report.ok?0:1;
}
