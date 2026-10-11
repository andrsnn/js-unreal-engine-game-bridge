import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const final='C:/UnlitWorldsCaptures/judge/hardburn-missiles-dark.mp4';
const out='G:/sfx/evidence/hardburn/dark-film';
const ff='C:/ProgramData/chocolatey/bin/ffmpeg.exe';
const fp='C:/ProgramData/chocolatey/bin/ffprobe.exe';
const run=(exe,args)=>{
  const result=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:180000});
  if(result.error||result.status) throw Error(result.error?.message||result.stderr.slice(-2000));
  return result;
};
const bytes=await fs.readFile(final);
await fs.mkdir(out,{recursive:true});
const probe=JSON.parse(run(fp,['-v','error','-show_format','-show_streams','-of','json',final]).stdout);
const duration=Number(probe.format.duration);
if(duration<10||duration>180||bytes.length>=30*1024*1024) throw Error('Shared film outside short-film duration/size limits');
if(!probe.streams.some(stream=>stream.codec_type==='audio')) throw Error('Film has no recorded audio');
const loudness=run(ff,['-hide_banner','-i',final,'-af','ebur128=peak=true','-f','null','-']).stderr;
await fs.writeFile(out+'/loudness.txt',loudness);
const summary=loudness.slice(loudness.lastIndexOf('Summary:'));
const integrated=Number(summary.match(/I:\s*([-\d.]+) LUFS/)[1]);
const peak=Number(summary.match(/Peak:\s*([-\d.]+) dBFS/)[1]);
if(!Number.isFinite(integrated)||!Number.isFinite(peak)||peak>=0) throw Error('Film audio is silent or clips');
run(ff,['-hide_banner','-loglevel','error','-y','-i',final,'-lavfi','showspectrumpic=s=1280x720:legend=1:scale=log:color=intensity','-frames:v','1',out+'/spectrum.png']);
for(const [name,second] of [['frame-start',3],['frame-middle',duration/2],['frame-end',duration-3]])
  run(ff,['-hide_banner','-loglevel','error','-y','-ss',String(second),'-i',final,'-frames:v','1',out+'/'+name+'.png']);
const receipt={final,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,duration,integratedLUFS:integrated,truePeakDBTP:peak,probe,sourceGameplayAcceptance:'Pending separate genuine-save, forty-swarm/mixed-PDC, NORMAL-speed and motor-state capture receipt; media checks alone do not prove these.'};
await fs.writeFile(out+'/media-audit.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({final,duration,bytes:bytes.length,integratedLUFS:integrated,truePeakDBTP:peak,sha256:receipt.sha256}));
