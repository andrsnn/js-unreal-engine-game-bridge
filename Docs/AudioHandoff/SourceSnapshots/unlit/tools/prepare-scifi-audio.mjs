import{spawnSync}from'node:child_process';import{writeFileSync}from'node:fs';
const source='media/raw/audio-source/kenney-scifi/Audio/',dest='public/audio/';
const choices={pulse:'laserSmall_000',plasma:'laserLarge_002',rail:'laserLarge_004',defense:'laserSmall_003',armor:'impactMetal_001',chest:'doorOpen_002',missile:'thrusterFire_001',arc:'laserRetro_003','beam-loop':'forceField_000','engine-rebuilt':'engineCircular_000','engine-azure':'spaceEngineSmall_002','engine-vulcan':'spaceEngineLarge_001','engine-boost':'thrusterFire_002'};
const ledger=[];
for(const[name,file]of Object.entries(choices)){
 const r=spawnSync('ffmpeg',['-v','error','-i',source+file+'.ogg','-f','f32le','-ac','1','-ar','48000','pipe:1'],{maxBuffer:8e6});if(r.status)throw Error(r.stderr.toString());let samples=Float32Array.from({length:r.stdout.length/4},(_,i)=>r.stdout.readFloatLE(i*4));
 if(name==='missile')samples=samples.slice(0,48000*.8);const loop=name.startsWith('engine')||name==='beam-loop';if(loop){const fade=7200,n=samples.length;for(let i=0;i<fade;i++){const t=i/fade;samples[n-fade+i]=samples[n-fade+i]*(1-t)+samples[i]*t;}samples=samples.slice(fade);}
 const peak=samples.reduce((p,x)=>Math.max(p,Math.abs(x)),0);const bytes=Buffer.alloc(samples.length*4);samples.forEach((x,i)=>{const fade=loop?1:Math.min(1,i/48,(samples.length-1-i)/480);bytes.writeFloatLE(x/Math.max(.01,peak)*.72*fade,i*4);});
 const output=dest+name+(loop?'':'-0')+'.ogg';const enc=spawnSync('ffmpeg',['-v','error','-y','-f','f32le','-ac','1','-ar','48000','-i','pipe:0','-c:a','libvorbis','-q:a','5',output],{input:bytes});if(enc.status)throw Error(enc.stderr.toString());ledger.push({output,source:file+'.ogg',loop,seconds:samples.length/48000});
}
writeFileSync('reports/scifi-audio-assets.json',JSON.stringify(ledger,null,2));console.log(ledger);
