// Encode accepted native segments only. No browser, soundtrack substitution or respeed.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const capture = process.env.SFX_CAPTURE_REPORT || 'G:/sfx/saltblade-shield-delve-film.json';
const report = JSON.parse(fs.readFileSync(capture,'utf8'));
if(!report.ok||!report.originalInputOnly||report.gameplayStateInjection||report.audioPass!==6)
  throw Error('Only accepted native-input audio6 captures may be delivered');
if(report.elapsed<30||report.elapsed>60||report.segments?.length!==2||report.segments.some(x=>x.incomplete))
  throw Error('Expected two complete real segments totaling 30–60 seconds');
const out = report.out.replace('/mnt/g/','G:/');
const destination = process.env.SFX_DELIVERY || 'C:/UnlitWorldsCaptures/judge/saltblade-audio-v6.mp4';
if(fs.existsSync(destination))throw Error('Preserve existing delivered movie: '+destination);
fs.mkdirSync(path.dirname(destination),{recursive:true});
const ffmpeg = process.env.SFX_FFMPEG || 'C:/ProgramData/chocolatey/bin/ffmpeg.exe';
const ffprobe = process.env.SFX_FFPROBE || 'C:/ProgramData/chocolatey/bin/ffprobe.exe';
const receipt = {ok:false,delivery:destination,capture,originalInputOnly:true,gameplayStateInjection:false,
  playbackSpeed:1,sourceDuration:report.elapsed,observed:report.observed,
  shieldObserved:report.shieldObserved,shieldNotObserved:report.shieldNotObserved,
  nativeAcceptance:report.acceptance,framesReviewed:false,spectrumReviewed:false,
  alignment:report.timestampClock,segments:[],errors:[]};
const run = (name,args) => {
  const p=spawnSync(ffmpeg,['-hide_banner','-threads','2','-filter_threads','1','-filter_complex_threads','1',...args],
    {encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});
  fs.writeFileSync(out+'/'+name+'.log',p.stderr||'');
  if(p.error||p.status!==0)throw Error(p.error?.message||p.stderr?.slice(-2200)||name+' failed');
  return p.stderr;
};
const loudness = (name,input) => {
  const log=run(name,['-i',input,'-vn','-af','loudnorm=I=-16:TP=-2.5:LRA=11:print_format=json','-f','null','NUL']);
  const match=log.match(/\{\s*"input_i"[\s\S]*?\}/);
  if(!match)throw Error('Missing loudness measurement '+name);
  const value=JSON.parse(match[0]);
  for(const key of ['input_i','input_tp','input_lra','input_thresh','target_offset'])
    if(!Number.isFinite(Number(value[key])))throw Error('Silent or invalid mix '+name+' '+key);
  return value;
};
const pending = out+'/delivery-pending.mp4';
try {
  const files=[];
  for(const [index,seg] of report.segments.entries()){
    const source=seg.path.replace('/mnt/g/','G:/'),file=out+'/segment-'+index+'.mkv';
    if(!Number.isFinite(seg.elapsed)||seg.elapsed<=0||seg.elapsed>60)throw Error('Invalid segment wall duration');
    // Each source segment gets its own simple image concat input and real postmaster audio.
    // PCM intermediate avoids an unnecessary lossy encode before global mastering.
    run('segment-'+index,['-y','-f','concat','-safe','0','-i',source+'/frames.ffconcat',
      '-threads','2','-i',source+'/audio.webm','-map','0:v:0','-map','1:a:0','-t',String(seg.elapsed),
      '-vf','fps=30','-c:v','libx264','-preset','fast','-threads','2','-crf','24','-maxrate','3500k','-bufsize','7000k',
      '-pix_fmt','yuv420p','-c:a','pcm_s16le','-ar','48000','-ac','2',file]);
    files.push(file);receipt.segments.push({label:seg.label,source,seconds:seg.elapsed,intermediate:file,played:seg.played});
  }
  const concat=out+'/segments.ffconcat';
  fs.writeFileSync(concat,'ffconcat version 1.0\n'+files.map(file=>"file '"+file.replaceAll("'","'\\''")+"'\n").join(''));
  const joined=out+'/joined-native.mkv';
  run('join-native',['-y','-f','concat','-safe','0','-i',concat,'-map','0:v:0','-map','0:a:0','-c','copy',joined]);
  const raw=loudness('loudness-input',joined);receipt.inputLUFS=Number(raw.input_i);receipt.inputDBTP=Number(raw.input_tp);
  const normal=`loudnorm=I=-16:TP=-2.5:LRA=11:measured_I=${raw.input_i}:measured_TP=${raw.input_tp}:measured_LRA=${raw.input_lra}:measured_thresh=${raw.input_thresh}:offset=${raw.target_offset}:linear=true:print_format=json`;
  // Oversampled protection plus conservative target retains AAC headroom.
  const protection='aresample=192000,alimiter=limit=0.75:level=false:latency=true,aresample=48000';
  run('master',['-y','-i',joined,'-map','0:v:0','-map','0:a:0','-t',String(report.elapsed),
    '-c:v','copy','-af',normal+','+protection,'-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',pending]);
  let final=loudness('loudness-final',pending);
  // At most one measured AAC correction, always from original joined PCM.
  if(Math.abs(Number(final.input_i)+16)>.6||Number(final.input_tp)>-.9){
    const requested=-16-Number(final.input_i),headroom=-1.1-Number(final.input_tp);
    const correction=Math.min(requested,headroom);
    receipt.correctionDB=correction;
    run('master-calibration',['-y','-i',joined,'-map','0:v:0','-map','0:a:0','-t',String(report.elapsed),
      '-c:v','copy','-af',normal+`,volume=${correction.toFixed(4)}dB,`+protection,
      '-c:a','aac','-b:a','160k','-ar','48000','-ac','2','-movflags','+faststart',pending]);
    final=loudness('loudness-final-calibrated',pending);
  }
  receipt.loudnessLUFS=Number(final.input_i);receipt.truePeakDBTP=Number(final.input_tp);receipt.lra=Number(final.input_lra);
  run('decode',['-v','error','-i',pending,'-map','0:v:0','-map','0:a:0','-f','null','NUL']);receipt.fullDecode=true;
  const probe=spawnSync(ffprobe,['-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height','-of','json',pending],
    {encoding:'utf8',windowsHide:true,timeout:30000});
  if(probe.error||probe.status!==0)throw Error('Final ffprobe failed: '+(probe.error?.message||probe.stderr));
  receipt.media=JSON.parse(probe.stdout);receipt.duration=Number(receipt.media.format.duration);receipt.bytes=fs.statSync(pending).size;
  if(receipt.bytes>=30000000||Math.abs(receipt.loudnessLUFS+16)>1||receipt.truePeakDBTP>-.8||receipt.duration<30||receipt.duration>60)
    throw Error('Final size/loudness/headroom/duration bound failed');
  receipt.frames=[];let offset=0;
  for(const seg of report.segments){
    for(const fraction of [.2,.65,.9]){
      const time=offset+seg.elapsed*fraction,name=seg.label+'-'+Math.round(fraction*100),file=out+'/'+name+'.png';
      run(name,['-loglevel','error','-y','-ss',time.toFixed(4),'-i',pending,'-frames:v','1',file]);
      receipt.frames.push({file,time});
    }
    offset+=seg.elapsed;
  }
  receipt.spectrum=out+'/spectrum.png';
  run('spectrum',['-loglevel','error','-y','-i',pending,'-lavfi','showspectrumpic=s=1024x384:legend=1:color=intensity','-frames:v','1',receipt.spectrum]);
  // Final destination is never overwritten. Root inspects frames and spectrum separately.
  if(fs.existsSync(destination))throw Error('Delivery appeared during encoding; preserve it');
  fs.copyFileSync(pending,destination,fs.constants.COPYFILE_EXCL);
  receipt.sha256=createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
  receipt.ok=true;
} catch(e) {receipt.errors.push(e.stack);process.exitCode=1;}
finally {
  fs.writeFileSync(out+'/delivery.json',JSON.stringify(receipt,null,2)+'\n');
  fs.writeFileSync('G:/sfx/saltblade-shield-delve-delivery.json',JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt,null,2));
}
