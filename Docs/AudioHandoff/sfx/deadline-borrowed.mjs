import fs from 'node:fs/promises';
import {foreignBrowserOwners} from './deadline-slot.mjs';
// Called by the browser owner between its own actions. This creates and closes
// only SFX contexts, restores process/global state, and never closes its browser.
export async function run(browser,ownerPage){
 const owners=foreignBrowserOwners();if(owners.length)throw Error('Borrowed batch awaits other browser release: '+JSON.stringify(owners));
 const previous={argv:process.argv,exit:process.exitCode,browser:globalThis.__audioDeadlineBrowser,borrowed:globalThis.__audioDeadlineBorrowed,context:globalThis.__audioDeadlineContext},reports=[];
 globalThis.__audioDeadlineBrowser=browser;globalThis.__audioDeadlineBorrowed=true;process.exitCode=0;
 const timer=setTimeout(()=>globalThis.__audioDeadlineContext?.close().catch(()=>{}),720000);
 try{for(const game of ['unlit']){
  process.argv=[process.execPath,'G:/sfx/deadline-play.mjs',game,...(game==='saltblade'?['--url=http://127.0.0.1:5191/?test=1']:[])];
  const module=await import('file:///G:/sfx/deadline-unlit-smoke.mjs?borrowed='+Date.now());reports.push(module.report);if(!module.report.ok)break;
 }}finally{
  clearTimeout(timer);process.argv=previous.argv;process.exitCode=previous.exit;
  for(const [key,value]of [['__audioDeadlineBrowser',previous.browser],['__audioDeadlineBorrowed',previous.borrowed],['__audioDeadlineContext',previous.context]])if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  await ownerPage?.bringToFront().catch(()=>{});
 }
 const result={ok:reports.length===1&&reports.every(r=>r.ok&&!r.errors.length&&!r.missing.length),browserReused:true,foreignBrowserClosed:false,saltAcceptedCapture:'G:/sfx/evidence/saltblade/deadline-1791664471089/audio-acceptance.json',reports:reports.map(r=>({game:r.game,out:r.out,ok:r.ok,errors:r.errors.length,missing:r.missing.length}))};
 await fs.writeFile('G:/sfx/evidence/deadline-borrowed-result.json',JSON.stringify(result,null,2));return result;
}
