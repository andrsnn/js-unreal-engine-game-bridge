import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const directory='G:/sfx/hardburn/public/audio/naval-v6',files=(await fs.readdir(directory)).filter(name=>name.endsWith('.ogg')),results=[];
for(let start=0;start<files.length;start+=8){results.push(...await Promise.all(files.slice(start,start+8).map(async name=>{
 const source=await fs.readFile(directory+'/'+name),url='http://100.69.252.53:5181/audio/naval-v6/'+name,response=await fetch(url,{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(url+' HTTP '+response.status);const live=Buffer.from(await response.arrayBuffer());if(!live.equals(source)||live.subarray(0,4).toString()!=='OggS')throw Error('Live sample mismatch '+name);
 return {name,bytes:live.length,sha256:crypto.createHash('sha256').update(live).digest('hex')};
})));}
await fs.writeFile('G:/sfx/hardburn-v6-live-samples.json',JSON.stringify({checked:new Date().toISOString(),count:results.length,bytes:results.reduce((n,r)=>n+r.bytes,0),results},null,2));console.log(JSON.stringify({count:results.length,bytes:results.reduce((n,r)=>n+r.bytes,0)}));
