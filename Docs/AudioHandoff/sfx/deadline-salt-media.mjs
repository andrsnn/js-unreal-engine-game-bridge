import fs from 'node:fs/promises';import{spawnSync}from'node:child_process';
const root='G:/sfx/evidence/saltblade/deadline-1791664471089',r=JSON.parse(await fs.readFile(root+'/report.json','utf8'));
const run=(args)=>{const p=spawnSync('C:/ProgramData/chocolatey/bin/ffmpeg.exe',args,{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,windowsHide:true});if(p.status||p.error)throw Error(p.stderr?.slice(-1800));return p.stderr;};
run(['-hide_banner','-loglevel','error','-i',root+'/audio.webm','-f','null','-']);
const text=run(['-hide_banner','-i',root+'/audio.webm','-af','ebur128=peak=true:framelog=verbose','-f','null','-']);await fs.writeFile(root+'/loudness.txt',text);
for(const time of [5,21])run(['-hide_banner','-loglevel','error','-y','-ss',String(time+r.offset),'-i',r.video,'-frames:v','1',root+`/combat-${time}.png`]);
await fs.writeFile(root+'/media-audit.json',JSON.stringify({audioFullDecodePassed:true,captureElapsed:r.elapsed,runtimeAssetsMissing:r.missing.length,controllerFailure:r.errors,loudnessSummary:text.slice(text.lastIndexOf('Summary:')),gameplayAndMuteChecksCompleted:!!r.mute&&!!r.reload&&!!r.restored},null,2));console.log(text.slice(text.lastIndexOf('Summary:')));
