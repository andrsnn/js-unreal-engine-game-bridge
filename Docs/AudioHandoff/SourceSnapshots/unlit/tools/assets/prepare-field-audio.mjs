/** Bake compact layered CC0 Foley. Run with Node + ffmpeg; raw libraries stay outside git. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const rate=48000,output='public/audio/field-v2';
const raw=resolve(process.argv[2]??'../space-game-asset-sources/audio');
const roots={impact:raw+'/kenney-impact/Audio/',ui:raw+'/kenney-interface/Audio/',sci:'media/raw/audio-source/kenney-scifi/Audio/',physical:'public/audio/physical-v1/',reload:'media/raw/audio-source/'};
const links={impact:'https://kenney.nl/assets/impact-sounds',ui:'https://kenney.nl/assets/interface-sounds',sci:'https://kenney.nl/assets/sci-fi-sounds',physical:'https://opengameart.org/content/the-free-firearm-sound-library',reload:'https://opengameart.org/content/gun-reload-sounds'};
const cache=new Map(),credits={};
mkdirSync(output,{recursive:true});
function run(args,input){const r=spawnSync('ffmpeg',['-v','error',...args],{input,maxBuffer:100e6});if(r.status)throw Error(r.stderr.toString());return r.stdout;}
function decode(file){if(!cache.has(file)){const b=run(['-i',file,'-ac','1','-ar',String(rate),'-f','f32le','pipe:1']);cache.set(file,Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4)));}return cache.get(file);}
const peak=a=>a.reduce((p,x)=>Math.max(p,Math.abs(x)),0);
function source(bank,file,gain=1,delay=0,speed=1,low=35,high=12000,start=0,seconds=4){return {bank,file,gain,delay,speed,low,high,start,seconds};}
const imp=(name,v,...rest)=>source('impact',`${name}_${String(v%5).padStart(3,'0')}.ogg`,...rest);
const ui=(name,v,...rest)=>source('ui',`${name}_${String(1+v%4).padStart(3,'0')}.ogg`,...rest);
const sci=(name,v,...rest)=>source('sci',`${name}_${String(v%5).padStart(3,'0')}.ogg`,...rest);
const phys=(name,v,...rest)=>source('physical',`${name}-${v%4}.ogg`,...rest);
function save(name,seconds,layers,loop=false){
 let a=new Float32Array(Math.ceil(seconds*rate));
 for(const s of layers){let pcm=decode(roots[s.bank]+s.file);pcm=pcm.slice(Math.floor(s.start*rate),Math.floor((s.start+s.seconds)*rate));if(!pcm.length)throw Error(`Empty ${s.file}`);
  // Strip leading silence for immediate feedback, preserve quiet tails and natural texture.
  const gate=peak(pcm)*.012,attack=pcm.findIndex(x=>Math.abs(x)>gate);if(attack>0)pcm=pcm.slice(Math.max(0,attack-96));
  const rawPeak=peak(pcm)||1;pcm=pcm.map(x=>x/rawPeak);
  const b=run(['-f','f32le','-ar',String(rate),'-ac','1','-i','pipe:0','-af',`highpass=f=${s.low},lowpass=f=${s.high}`,'-f','f32le','pipe:1'],Buffer.from(pcm.buffer));pcm=Float32Array.from({length:b.length/4},(_,i)=>b.readFloatLE(i*4));
  if(loop){const overlap=Math.min(Math.round(rate*.12),Math.floor(pcm.length*.2)),joined=pcm.slice(0,pcm.length-overlap);for(let k=0;k<overlap;k++){const w=k/overlap;joined[k]=pcm[joined.length+k]*(1-w)+pcm[k]*w;}pcm=joined;}
  for(let i=Math.round(s.delay*rate),j=0;i<a.length;i++,j+=s.speed){if(j>=pcm.length-1){if(!loop)break;j%=pcm.length-1;}const k=Math.floor(j);a[i]+=(pcm[k]+(pcm[k+1]-pcm[k])*(j-k))*s.gain;}
 }
 const gain=.72/(peak(a)||1);a=a.map((x,i)=>x*gain*(loop?1:Math.min(1,i/32,(a.length-1-i)/Math.min(rate*.07,a.length*.18))));
 if(loop){const seam=Math.round(rate*.18),original=a.slice();a=original.slice(0,original.length-seam);for(let i=0;i<seam;i++){const w=i/seam;a[i]=original[a.length+i]*(1-w)+original[i]*w;}}
 run(['-y','-f','f32le','-ar',String(rate),'-ac','1','-i','pipe:0','-c:a','libvorbis','-q:a','4',`${output}/${name}.ogg`],Buffer.from(a.buffer));
 const decoded=decode(`${output}/${name}.ogg`);if(peak(decoded)>.9)throw Error(`Codec peak ${name}`);
 credits[name]={licence:'CC0-1.0',sources:layers.map(s=>({file:s.file,url:links[s.bank],...(s.bank==='physical'?{editedSource:'physical-v1; source cuts in existing weapon credits'}:{}),start:s.start})),edit:loop?'layered, filtered, crossfaded loop':'layered, trimmed, filtered, faded; -2.85 dB source headroom'};
}
const recipes={
 uiTick:v=>[.09,[ui('click',v,.75),imp('impactGeneric_light',v,.12,.008,1.5)]],
 uiConfirm:v=>[.25,[ui('click',v,.5),ui('open',v,.4,.035,1.2)]],
 uiPurchase:v=>[.6,[ui('drop',v,.7),imp('impactGlass_light',v,.28,.065,1.1),ui('open',v,.22,.15)]],
 uiReveal:v=>[.8,[ui('open',v,.65,0,.8),imp('impactGlass_medium',v,.22,.06,.85),ui('click',v,.2,.18)]],
 uiCapture:v=>[.16,[ui('click',v,.65),imp('impactMetal_light',v,.22,.012,1.4)]],
 lampClick:v=>[.16,[ui('click',v,.55),imp('impactTin_medium',v,.2,.018,1.2)]],
 pickup:v=>[.4,[ui('drop',v,.6),ui('open',v,.26,.07,1.3)]],
 read:v=>[.23,[ui('open',v,.65),ui('click',v,.3,.055)]],
 chest:v=>[.85,[sci('doorOpen',v%3,.7,0,.85),imp('impactMetal_medium',v,.32,.025)]],
 refit:v=>[.55,[imp('impactMetal_heavy',v,.6),sci('doorClose',v%3,.4,.075,1.2)]],
 body:v=>[.3,[imp('impactPunch_heavy',v,.8),imp('impactSoft_heavy',v,.38,.013,.9)]],
 fleshImpact:v=>[.28,[imp('impactSoft_medium',v,.6),imp('impactPunch_medium',v,.45,.009)]],
 fleshDeath:v=>[.8,[imp('impactSoft_heavy',v,.8),imp('footstep_concrete',v,.3,.16,.65),imp('impactSoft_medium',v,.4,.32,.85)]],
 stone:v=>[.48,[imp('impactMining',v,.8),imp('impactGeneric_light',v,.22,.025,.7)]],
 metalImpact:v=>[.42,[imp('impactMetal_light',v,.75),imp('impactPlate_light',v,.4,.015)]],
 metalDeath:v=>[1.2,[imp('impactMetal_heavy',v,.7),imp('impactPlate_heavy',v,.5,.13,.8),imp('impactMetal_medium',v,.28,.34,.85)]],
 shield:v=>[.5,[sci('forceField',v,.65,0,1.3),imp('impactGlass_light',v,.25,.007)]],
 landThud:v=>[.4,[imp('impactSoft_heavy',v,.6),imp('footstep_concrete',v,.5,.008,.85)]],
 stepDeck:v=>[.25,[imp('footstep_wood',v,.5),imp('impactMetal_light',v,.12,.014,.8)]],
 stepStone:v=>[.24,[imp('footstep_concrete',v,.7),imp('impactMining',v,.09,.008,1.7)]],
 stepSnow:v=>[.3,[imp('footstep_snow',v,.75),imp('impactSoft_medium',v,.12)]],
 step:v=>[.27,[imp('footstep_grass',v,.7),imp('impactSoft_medium',v,.1)]],
 gunMechanism:v=>[.19,[source('reload','bolt.wav',.75,0,1+v*.02,150,8000,0,.3)]],
 eject:v=>[.25,[source('reload','reload.wav',.65,0,1+v*.025,100,9000,.14,.24),imp('impactMetal_light',v,.1,.05,1.6)]],
 insert:v=>[.48,[source('reload','reload.wav',.7,0,1+v*.02,100,9000,1.03,.48),imp('impactMetal_medium',v,.12,.045)]],
 bolt:v=>[.45,[source('reload','bolt.wav',.75,0,.96+v*.02,100,11000,0,.65)]],
 shellRack:v=>[.42,[source('reload','bolt.wav',.75,0,.8+v*.02,150,8500,0,.65),imp('impactTin_medium',v,.18,.13)]],
 gunCrack:v=>[.085,[phys('rifle',v,.65,0,1.12,3200,12000,0,.1)]],
 gunTail:v=>[.62,[phys('sniper',v,.55,0,.95,90,1500,.04,.6)]],
 kick:v=>[.22,[phys('shotgun',v,.6,0,.95,45,500,0,.22)]],
 launchThump:v=>[.8,[phys('missile',v,.8),imp('impactMetal_medium',v,.2,.04)]],
 missileCrump:v=>[1.9,[phys('explosion',v,.8),imp('impactMetal_heavy',v,.22,.14,.7)]],
 deathCrash:v=>[2.3,[phys('explosion',v,.7,0,.75),imp('impactMetal_heavy',v,.38,.25,.6)]],
 bossDeath:v=>[2.4,[phys('explosion',v,.65,0,.75),phys('explosion',(v+1)%4,.38,.22,.6),imp('impactMining',v,.32,.55,.65)]],
 chargeRumble:v=>[1.2,[sci('spaceEngineLow',v,.55,0,.7,45,1100),sci('forceField',v,.28,.12,.55,120,2800)]],
 warnNest:v=>[1.6,[sci('spaceEngineLow',v,.55,0,.55,55,1800),imp('impactMining',v,.28,.2,.75),imp('impactMining',(v+1)%5,.34,.7,.85)]],
 warnFoundry:v=>[1.4,[sci('engineCircular',v,.6,0,.65,60,2500),imp('impactBell_heavy',v,.3,.1,.65),imp('impactMetal_heavy',v,.3,.65)]],
 warnSettlement:v=>[1.2,[imp('impactBell_heavy',v,.55,0,.7),imp('impactBell_heavy',(v+1)%5,.4,.35,.8)]],
 contactHorn:v=>[1.2,[sci('spaceEngineLarge',v,.65,0,.55,80,2200),imp('impactBell_heavy',v,.25,.13,.6)]],
 missileAlert:v=>[.8,[imp('impactBell_heavy',v,.7,0,1.35),imp('impactBell_heavy',(v+1)%5,.5,.22,1.5)]],
 provokeAlarm:v=>[1.1,[imp('impactBell_heavy',v,.65,0,.75),imp('impactMetal_heavy',v,.3,.32),imp('impactBell_heavy',(v+1)%5,.5,.58,.9)]],
 objectiveDone:v=>[.9,[ui('open',v,.55),imp('impactGlass_light',v,.22,.12),ui('drop',v,.25,.28)]],
 level:v=>[1.1,[ui('open',v,.5,0,.8),imp('impactGlass_medium',v,.25,.12,.9),ui('drop',v,.25,.32)]],
};
for(const [kind,make]of Object.entries(recipes))for(let v=0;v<4;v++){const [duration,layers]=make(v);save(`${kind}-${v}`,duration,layers);}
for(const [i,id]of ['rebuilt','azure','vulcan','boost'].entries())save(`engine-${id}`,4,[sci('spaceEngineLow',i,.65,0,.8+i*.09,40,2800),sci('engineCircular',i,.24,0,.9,150,4200),sci('thrusterFire',i,.15,0,.75,60,2200)],true);
writeFileSync(`${output}/sources.json`,JSON.stringify({revision:'field-v2',sampleRate:rate,channels:1,clips:credits},null,2)+'\n');
console.log(`Baked ${Object.keys(credits).length} CC0 layered effects/loops; sources.json records every source.`);
