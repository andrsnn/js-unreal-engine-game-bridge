import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';
const game=process.argv[2],main={karvos:'C:/Users/Aidan Anderson/karvos',unlit:'C:/Users/Aidan Anderson/space-game',hardburn:'C:/Users/Aidan Anderson/falling-frontier-clone',saltblade:'C:/Users/Aidan Anderson/saltblade'}[game];if(!main)throw Error('Unknown game');
const git='C:/Program Files/Git/cmd/git.exe',out=`G:/sfx/integration/${game}-${Date.now()}`;await fs.mkdir(out,{recursive:true});
const run=(args,{allowFailure=false}={})=>{const r=spawnSync(git,['-C',main,...args],{encoding:'utf8',timeout:180000,windowsHide:true});if(r.error||(!allowFailure&&r.status))throw Error(JSON.stringify({args,error:r.error,status:r.status,stderr:r.stderr?.slice(-2000),stdout:r.stdout?.slice(-2000)}));return r;};
const before=run(['rev-parse','HEAD']).stdout.trim(),audio=run(['rev-parse','audio/v1']).stdout.trim(),primary=run(['branch','--show-current']).stdout.trim();
if(run(['merge-base','--is-ancestor',before,audio],{allowFailure:true}).status)throw Error('Primary branch advanced; sync/build/check before trying again');
const changed=run(['diff','--name-only',before,audio]).stdout.trim().split(/\r?\n/).filter(Boolean),dirty=run(['diff','--name-only']).stdout.trim().split(/\r?\n/).filter(Boolean),staged=run(['diff','--cached','--name-only']).stdout.trim().split(/\r?\n/).filter(Boolean),overlap=dirty.filter(f=>changed.includes(f));
if(staged.some(f=>changed.includes(f)))throw Error('Overlapping staged work; preserve before integration');
for(const f of overlap){const target=out+'/before/'+f;await fs.mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});try{await fs.copyFile(main+'/'+f,target);}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.writeFile(out+'/before.patch',overlap.length?run(['diff','--binary','--',...overlap]).stdout:'');
let stash=null,merged=false;try{
 if(overlap.length){run(['stash','push','--keep-index','-m',`Audio v1 preserve concurrent ${game} edits`,'--',...overlap]);stash=run(['rev-parse','refs/stash']).stdout.trim();}
 const result=run(['-c','core.safecrlf=false','-c','merge.autoStash=false','merge','--ff-only','audio/v1']);merged=true;await fs.writeFile(out+'/merge.txt',result.stdout+'\n'+result.stderr);
}finally{if(stash){const applied=run(['stash','apply',stash],{allowFailure:true});await fs.writeFile(out+'/stash-restore.txt',applied.stdout+'\n'+applied.stderr);if(applied.status)throw Error('Preserved edits need conflict resolution; original stash retained '+stash);const top=run(['rev-parse','refs/stash'],{allowFailure:true}).stdout.trim();if(top===stash)run(['stash','drop','stash@{0}']);}}
const after=run(['rev-parse','HEAD']).stdout.trim(),remaining=run(['diff','--name-only']).stdout.trim().split(/\r?\n/).filter(Boolean);
const lost=dirty.filter(f=>!changed.includes(f)&&!remaining.includes(f));if(lost.length)throw Error('Unexpected disappearance of concurrent dirty changes '+lost.join(','));
if(game==='karvos'){const source=await fs.readFile(main+'/src/main.js','utf8');for(const needle of ['getEnemies:','getBuildings:','dragonwilds-hud.css'])if(!source.includes(needle))throw Error('Missing preserved integration hook '+needle);}
const report={game,main,primary,before,audio,after,changed,dirty,overlap,remaining,stash,merged,time:new Date().toISOString()};await fs.writeFile(out+'/receipt.json',JSON.stringify(report,null,2));console.log(JSON.stringify({out,game,primary,before,after,overlap,preservedDirty:remaining.length,merged}));
