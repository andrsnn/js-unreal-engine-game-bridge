import fs from'node:fs/promises';import{foreignBrowserOwners}from'./deadline-slot.mjs';
// Browser owner invokes between its own actions; never closes its browser or page.
export async function run(browser,ownerPage){
 const others=foreignBrowserOwners();if(others.length)throw Error('Another browser owner still running: '+JSON.stringify(others));
 const previous={argv:process.argv,exit:process.exitCode,browser:globalThis.__audioDeadlineBrowser,context:globalThis.__audioDeadlineContext};
 const report={startedUTC:new Date().toISOString(),browserReused:true,foreignBrowserClosed:false,games:{},errors:[]};
 globalThis.__audioDeadlineBrowser=browser;const timer=setTimeout(()=>globalThis.__audioDeadlineContext?.close().catch(()=>{}),720000);
 try{for(const game of ['hardburn','unlit','salt']){process.exitCode=0;const{report:r}=await import('file:///G:/sfx/confirm-'+game+'-smoke.mjs?borrowed='+Date.now());report.games[r.game]=r;}report.ok=Object.keys(report.games).length===3&&Object.values(report.games).every(r=>r.ok);}catch(e){report.errors.push(e.stack);report.ok=false;}
 finally{clearTimeout(timer);await globalThis.__audioDeadlineContext?.close().catch(()=>{});process.argv=previous.argv;process.exitCode=previous.exit;for(const[key,value]of[['__audioDeadlineBrowser',previous.browser],['__audioDeadlineContext',previous.context]])if(value===undefined)delete globalThis[key];else globalThis[key]=value;await ownerPage?.bringToFront().catch(()=>{});report.completedUTC=new Date().toISOString();await fs.writeFile('G:/sfx/evidence/current-port-borrowed.json',JSON.stringify(report,null,2));}
 return{ok:report.ok,browserReused:true,foreignBrowserClosed:false,receipt:'G:/sfx/evidence/current-port-borrowed.json',games:Object.fromEntries(Object.entries(report.games).map(([k,v])=>[k,{ok:v.ok,out:v.out,errors:v.errors.length,missing:v.missing.length}]))};
}
