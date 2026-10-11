import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const rate=48000,out='public/audio/refined',report='reports/readability-repair';mkdirSync(out,{recursive:true});mkdirSync(report,{recursive:true});
function decode(file){const r=spawnSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-ac','1','-ar',String(rate),'pipe:1'],{maxBuffer:30e6});if(r.status)throw Error(r.stderr.toString());return Float32Array.from({length:r.stdout.length/4},(_,i)=>r.stdout.readFloatLE(i*4));}
const cache=new Map();const raw=f=>{if(!cache.has(f))cache.set(f,decode(f));return cache.get(f)};
function transient(src,seconds,pitch=1){let peak=0,start=0;for(let i=0;i<src.length;i+=240){let energy=0;for(let j=i;j<Math.min(i+960,src.length);j++)energy+=src[j]*src[j];if(energy>peak){peak=energy;start=i;}}start=Math.max(0,start-240);const a=new Float32Array(seconds*rate);for(let i=0;i<a.length;i++){const p=start+i*pitch,j=Math.floor(p);a[i]=(src[j]??0)*(1-p+j)+(src[j+1]??0)*(p-j);}return a;}
function filter(a,low,high){let lp=0,bass=0;const k=1-Math.exp(-2*Math.PI*low/rate),h=1-Math.exp(-2*Math.PI*high/rate);return a.map(x=>{lp+=(x-lp)*k;bass+=(lp-bass)*h;return lp-bass})}
const ledger=[];
function save(name,a,sources,target=.09,ceiling=.76){let energy=0,peak=0;const dc=a.reduce((s,x)=>s+x,0)/a.length;a=a.map((x,i)=>(x-dc)*Math.min(1,i/160,(a.length-1-i)/1600));for(const x of a){energy+=x*x;peak=Math.max(peak,Math.abs(x));}const rms=Math.sqrt(energy/a.length);if(rms<.00001)throw Error(name+' silent');const gain=Math.min(target/rms,ceiling/peak),b=Buffer.alloc(a.length*4);a.forEach((x,i)=>b.writeFloatLE(x*gain,i*4));const r=spawnSync('ffmpeg',['-v','error','-y','-f','f32le','-ac','1','-ar',String(rate),'-i','pipe:0','-c:a','libvorbis','-q:a','5',`${out}/${name}.ogg`],{input:b});if(r.status)throw Error(r.stderr.toString());ledger.push({name,seconds:a.length/rate,rms:rms*gain,peak:peak*gain,sources});}
for(const kind of ['step','stepSand','stepStone','stepSnow'])for(let v=0;v<6;v++){
 const file=`public/audio/sa3/${kind}-${v%3}.ogg`,duration=kind==='stepSnow'?.24:kind==='stepSand'?.22:.18;
 const a=filter(transient(raw(file),duration,.94+v*.025),kind==='stepStone'?4200:kind==='stepSnow'?2100:2900,90);
 // One close dry heel/toe contact; remove generated room/tail swishes.
 for(let i=0;i<a.length;i++)a[i]*=Math.exp(-i/rate/(kind==='stepStone'?.07:.09));
 save(`${kind}-${v}`,a,[file],.065,.46);
}
const families={pulse:['laserSmall_000',.24,'rifle',.22],rotary:['impactMetal_003',.19,'lmg',.08],plasma:['laserLarge_002',.44,'shotgun',.35],rail:['laserLarge_004',.48,'sniper',.16],missile:['thrusterFire_001',.65,'bolt',.45]};
for(const [kind,[laser,duration,mechanical,energyMix]] of Object.entries(families))for(let v=0;v<3;v++){
 const aPath=`public/audio/${mechanical}-${mechanical==='bolt'?0:v%2}.ogg`,bPath=`media/raw/audio-source/kenney-scifi/Audio/${laser}.ogg`;
 const a=filter(transient(raw(aPath),duration,.87+v*.025),kind==='rotary'?6500:4200,55),b=filter(transient(raw(bPath),duration,.86+v*.035),3200,120);
 const norm=x=>{const p=x.reduce((p,v)=>Math.max(p,Math.abs(v)),.001);return x.map(v=>v/p)};const dry=norm(a),energy=norm(b);
 const mixed=dry.map((x,i)=>{const t=i/rate;return x*(1-energyMix)*Math.exp(-t/(duration*.43))+energy[i]*energyMix*Math.exp(-t/(duration*.55));});
 save(`${kind}-${v}`,mixed,[aPath,bPath],kind==='rotary'?.105:.12);
}
writeFileSync(report+'/audio-assets.json',JSON.stringify(ledger,null,2));console.log(JSON.stringify({clips:ledger.length,totalSeconds:ledger.reduce((s,v)=>s+v.seconds,0),maxPeak:Math.max(...ledger.map(v=>v.peak))}));
