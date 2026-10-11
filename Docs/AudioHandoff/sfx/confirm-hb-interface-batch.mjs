import fs from'node:fs/promises';import{createRequire}from'node:module';import{createHash}from'node:crypto';import{foreignBrowserOwners}from'./deadline-slot.mjs';
const out='G:/sfx/evidence/published-confirmation-'+Date.now();await fs.mkdir(out,{recursive:true});const report={startedUTC:new Date().toISOString(),out,games:{},errors:[]};
const notes=['G:/sfx/NOTES.md','G:/JsGameBridge/NOTES.md','C:/AI/cache/tmp/claude/C--Users-Aidan-Anderson/01005298-81f3-4b3a-99f4-3cd0275c83cd/scratchpad/sfx/NOTES.md'];
const note=async message=>{for(const p of notes)await fs.appendFile(p,'\n'+message+'\n');};
let browser;
await note('SFX CLAIMED '+new Date().toISOString()+': one owned SOFTWARE-rendered browser/serial current-port audio confirmation; GPU capture queue untouched. ONLY published100.69.252.53:5181 audio; native keyboard BEGIN at1920x1080, other2 current-port checks retained. No capture/build/gamecode changes. No recording/build/features. Other owners may continue their captures; typically2min, bounded12min.');
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json'),{chromium}=require('playwright');
const limit=setTimeout(async()=>{await browser?.close().catch(()=>{});process.exit(1)},Math.min(720000,Math.max(1000,Date.parse('2026-10-10T22:07:00Z')-Date.now())));
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});globalThis.__audioDeadlineBrowser=browser;
 // One owned CPU-rendered SFX browser; no hardware GPU work or second SFX browser.
 for(const game of ['hardburn']){
  process.exitCode=0;const {report:r}=await import('file:///G:/sfx/confirm-hb-interface.mjs');
  if(r.entry){const response=await fetch(r.entry,{signal:AbortSignal.timeout(10000)});r.entryHttpStatus=response.status;r.entrySha256=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');}
  report.games[r.game]=r;console.log('CHECK_COMPLETE',r.game,r.ok?'PASS':'FAIL');
 }
 report.ok=Object.values(report.games).length===1&&Object.values(report.games).every(r=>r.ok);
}catch(e){report.errors.push(e.stack);report.ok=false;console.log(e.stack)}
finally{
 await browser?.close();clearTimeout(limit);delete globalThis.__audioDeadlineBrowser;report.completedUTC=new Date().toISOString();await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await note('SFX BROWSER RELEASED '+report.completedUTC+': current-port confirmation '+(report.ok?'PASS':'FAILED; investigate actual report')+'; G:/sfx/evidence/'+out.split('/').pop()+'/report.json. Own browser closed; no game code/build/recording changes.');console.log(JSON.stringify({out,ok:report.ok,games:Object.fromEntries(Object.entries(report.games).map(([k,v])=>[k,{ok:v.ok,errors:v.errors.length,missing:v.missing.length,entry:v.entry}]))}));process.exitCode=report.ok?0:1;
}
