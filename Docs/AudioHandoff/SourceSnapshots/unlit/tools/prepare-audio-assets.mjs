import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root='media/raw/audio-source/',out='public/audio';mkdirSync(out,{recursive:true});
const sources=[['rifle','AR-15/D_32P.wav',.7],['smg','Carl Gustav M45/G_31P.wav',.4],['lmg','AK-47/C_28P.wav',.55],['pistol','1911/A_42P.wav',.6],['shotgun','CD/H_21P.wav',1],['sniper','1917/B_24P.wav',1.2]];
function decode(path){const r=spawnSync('ffmpeg',['-v','error','-i',path,'-f','f32le','-ac','1','-ar','48000','pipe:1'],{maxBuffer:30e6});if(r.status)throw Error(r.stderr.toString());const b=r.stdout;return Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));}
const ledger=[];
function save(name,pcm,start,seconds){let a=pcm.slice(Math.max(0,Math.floor(start*48000)),Math.floor((start+seconds)*48000));const peak=a.reduce((p,x)=>Math.max(p,Math.abs(x)),0);if(peak<.001)throw Error(name+' silent');a=a.map((x,i)=>x/peak*.85*Math.min(1,i/96,(a.length-1-i)/4800));const b=Buffer.alloc(a.length*4);a.forEach((x,i)=>b.writeFloatLE(x,i*4));const r=spawnSync('ffmpeg',['-v','error','-y','-f','f32le','-ar','48000','-ac','1','-i','pipe:0','-c:a','libvorbis','-q:a','5',`${out}/${name}.ogg`],{input:b});if(r.status)throw Error(r.stderr.toString());ledger.push({name,start,seconds:a.length/48000,sourcePeak:peak});}
for(const [name,file,duration]of sources){const pcm=decode(root+'Prepared SFX Library/'+file),peak=pcm.reduce((p,x)=>Math.max(p,Math.abs(x)),0);let starts=[],last=-48000;for(let i=0;i<pcm.length;i++)if(Math.abs(pcm[i])>peak*.08){if(i-last>48000*.5)starts.push(Math.max(0,i/48000-.004));last=i;}if(!starts.length)throw Error(file+' no transient');for(let v=0;v<2;v++)save(`${name}-${v}`,pcm,starts[Math.min(v,starts.length-1)],duration);}
const reload=decode(root+'reload.wav');save('eject-0',reload,.14,.25);save('insert-0',reload,1.03,.48);
const bolt=decode(root+'bolt.wav');let peak=bolt.reduce((p,x)=>Math.max(p,Math.abs(x)),0),onset=bolt.findIndex(x=>Math.abs(x)>peak*.08)/48000;save('bolt-0',bolt,Math.max(0,onset-.004),.65);
writeFileSync('reports/audio-overhaul/recorded-assets.json',JSON.stringify(ledger,null,2));console.log(ledger);
