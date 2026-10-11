import fs from'node:fs/promises';import{createHash}from'node:crypto';import vm from'node:vm';import path from'node:path';
const hash=b=>createHash('sha256').update(b).digest('hex'),result={time:new Date().toISOString(),games:{}};
const hb='C:/Users/Aidan Anderson/falling-frontier-clone',un='C:/Users/Aidan Anderson/space-game';
const code=await fs.readFile(hb+'/src/audio.js','utf8'),combat=await import('file:///G:/sfx/hardburn/src/audio-combat.js'),box={COMBAT_BANKS:combat.COMBAT_BANKS,GUIDED_BANKS:combat.GUIDED_BANKS,COMBAT_VARIANTS:combat.COMBAT_VARIANTS};
vm.createContext(box);vm.runInContext(code.slice(code.indexOf('const variants='),code.indexOf('const phaseBanks='))+';globalThis.result=banks',box);
const hbFiles=[...new Set(Object.values(box.result).flat())].map(x=>path.posix.normalize('audio/kenney/'+x));
const unFiles=(await fs.readdir(un+'/public/audio/physical-v4')).filter(x=>x.endsWith('.ogg')).map(x=>'audio/physical-v4/'+x);
for(const [game,port,source,files]of [['hardburn',5181,hb,hbFiles],['unlit',5336,un,unFiles],['saltblade',5203,'C:/Users/Aidan Anderson/saltblade',[]]]){
 const base='http://100.69.252.53:'+port,html=await(await fetch(base+'/',{signal:AbortSignal.timeout(15000)})).text(),entries=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/g)].map(x=>x[1]),entry=entries.find(x=>!x.includes('/@vite/')),sourceBytes=Buffer.from(await(await fetch(base+entry,{signal:AbortSignal.timeout(15000)})).arrayBuffer()),js=sourceBytes.toString('utf8'),checks=[];
 for(let i=0;i<files.length;i+=8)checks.push(...await Promise.all(files.slice(i,i+8).map(async name=>{const expected=await fs.readFile(source+'/public/'+name),r=await fetch(base+'/'+name,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(game+'/'+name+' HTTP '+r.status);const actual=Buffer.from(await r.arrayBuffer());if(!actual.equals(expected))throw Error(game+'/'+name+' differs');return{name,bytes:actual.length,sha256:hash(actual)}})));
 let desktop;
 if(game==='hardburn'){const d='G:/HardBurnDesktop/release/win-unpacked/resources/app/game';const missing=[],different=[];for(const file of files){try{if(!(await fs.readFile(d+'/'+file)).equals(await fs.readFile(source+'/public/'+file)))different.push(file);}catch(e){if(e.code==='ENOENT')missing.push(file);else throw e;}}const dh=await fs.readFile(d+'/index.html','utf8'),de=dh.match(/<script[^>]*src=["']([^"']+)["']/)?.[1],db=await fs.readFile(d+'/'+de.replace(/^\//,''));desktop={entry:de,sha256:hash(db),missing:missing.length,different:different.length,audioPass7:/audioPass\s*:\s*7/.test(db.toString()),release:JSON.parse(await fs.readFile('G:/HardBurnDesktop/release/RELEASE.json','utf8'))};}
 let planetary,saltAudio;
 if(game==='unlit'){
  const chunk=js.match(/(?:\.\/|\/assets\/)?(planetScene-[A-Za-z0-9_-]+\.js)/)?.[1];if(!chunk)throw Error('Current Unlit entry has no planet chunk');
  const response=await fetch(base+'/assets/'+chunk,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Current planet chunk HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer()),text=bytes.toString(),hook=text.match(/\.setEngine\([^;]{0,180}\)/)?.[0];
  if(!hook||!hook.includes('parked')||!hook.includes('?[]')||!hook.includes('&&'))throw Error('Actual atmospheric throttle/boost hook missing: '+hook);
 planetary={planetChunk:'assets/'+chunk,planetChunkSha256:hash(bytes),actualThrottleBoostHook:true,engineHook:hook};
 }
 if(game==='saltblade'){
  const location=entries.some(x=>x==='/@vite/client')?'/src/platform/audio.ts':entry;
  const response=await fetch(base+location,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Salt audio HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());if(!bytes.toString().includes('saltblade:audio:v1'))throw Error('Salt persistent audio factory missing');
  saltAudio={audioFactoryLocation:location,audioFactorySha256:hash(bytes),persistentSoundControlPresent:true};
 }
 result.games[game]={base,entry,entrySha256:hash(sourceBytes),compiled:!entries.some(x=>x==='/@vite/client'),count:checks.length,bytes:checks.reduce((s,x)=>s+x.bytes,0),audioPass:game==='hardburn'?/audioPass\s*:\s*7/.test(js):game==='unlit'?/audioPass\s*:\s*5/.test(js):!!saltAudio,newVentPolicy:game==='hardburn'?/venting:[^;]{0,400}\.pressure>\.025/.test(js):null,desktop,...planetary,...saltAudio,checks};
 console.log(JSON.stringify({...result.games[game],checks:undefined}));
}
await fs.writeFile('G:/sfx/deadline-assets.json',JSON.stringify(result,null,2));
