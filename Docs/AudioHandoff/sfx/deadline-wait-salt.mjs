import {foreignBrowserOwners} from './deadline-slot.mjs';
import fs from 'node:fs/promises';import {spawn}from'node:child_process';
const end=Date.now()+25*60*1000;
while(Date.now()<end){
 const owners=foreignBrowserOwners();
 const artifactReady=await fs.access('C:/Users/Aidan Anderson/saltblade/dist/index.html').then(()=>true,()=>false);
 if(!owners.length&&artifactReady){
  const now=new Date(),pdt=now.toLocaleTimeString('en-US',{timeZone:'America/Los_Angeles',hour12:false,hour:'2-digit',minute:'2-digit'});
  const msg=`\nSFX CLAIMED ${pdt} PDT: global browser audit EMPTY. One short final Salt usual5203 fresh NG/combat/mute/reload/title-corner restore check NOW, max4min, no recording/build. Please hold further browser/Electron launches until explicit RELEASE. Final47s clip and HB desktop/UN checks complete.\n`;
  for(const p of ['G:/sfx/NOTES.md','G:/JsGameBridge/NOTES.md','C:/AI/cache/tmp/claude/C--Users-Aidan-Anderson/01005298-81f3-4b3a-99f4-3cd0275c83cd/scratchpad/sfx/NOTES.md'])await fs.appendFile(p,msg);
  const child=spawn(process.execPath,['G:/sfx/deadline-salt-smoke.mjs'],{stdio:'inherit',windowsHide:true});
  const status=await new Promise(resolve=>child.once('exit',code=>resolve(code??1)));process.exitCode=status;break;
 }
 console.log(JSON.stringify({timeUTC:new Date().toISOString(),saltArtifactReady:artifactReady,waitingFor:owners.map(({ProcessId,ParentProcessId})=>({pid:ProcessId,parent:ParentProcessId}))}));
 await new Promise(resolve=>setTimeout(resolve,20000));
}
