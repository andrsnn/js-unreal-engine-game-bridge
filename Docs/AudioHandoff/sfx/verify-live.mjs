import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const jobs=[
 {game:'hardburn',url:'http://100.69.252.53:5181/',audio:'audio/naval-v3/score-machinery.ogg'},
 {game:'karvos',url:'http://127.0.0.1:5179/',audio:'audio/v3-scoreStrings-01.ogg'},
 {game:'unlit',url:'http://127.0.0.1:5336/',audio:'audio/introduction-v2/intro-0.ogg'}
];
const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(url+' HTTP'+r.status);return r;};
const results=await Promise.all(jobs.map(async job=>{
 const flag=job.game==='hardburn'?'hb':job.game;
 const expectedPass=Number(process.argv.find(a=>a.startsWith('--'+flag+'-pass='))?.split('=')[1]||3);
 const html=await (await get(job.url)).text();
 const source=html.match(/<script[^>]*src=["']([^"']+)["']/)?.[1];if(!source)throw Error(job.game+' compiled entry absent');
 const moduleURL=new URL(source,job.url).href,code=await (await get(moduleURL)).text();
 if(!new RegExp('audioPass\\s*:\\s*'+expectedPass).test(code))throw Error(job.game+' live entry lacks audioPass'+expectedPass);
 if(job.game==='unlit'){const revision=Number(process.argv.find(a=>a.startsWith('--unlit-revision='))?.split('=')[1]||12);if(!new RegExp('revision\\s*:\\s*'+revision).test(code))throw Error('Unlit live revision'+revision+' absent');}
 if(job.game==='hardburn'&&expectedPass>=4)job.audio='audio/naval-v4/rail-0.ogg';
 if(job.game==='hardburn'&&expectedPass>=6)job.audio='audio/naval-v6/rail-0.ogg';
 if(job.game==='karvos'&&expectedPass>=4)job.audio='audio/v4-rifle-01.ogg';
 if(job.game==='unlit'&&expectedPass>=4)job.audio='audio/physical-v4/drive-core.ogg';
 const buffer=Buffer.from(await (await get(new URL(job.audio,job.url))).arrayBuffer());
 if(buffer.subarray(0,4).toString()!=='OggS')throw Error(job.game+' audio asset not OGG');
 return {...job,http:200,moduleURL,moduleSHA256:crypto.createHash('sha256').update(code).digest('hex'),audioBytes:buffer.length,audioPass:expectedPass,checked:new Date().toISOString()};
}));
await fs.writeFile('G:/sfx/live-final-audit.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
