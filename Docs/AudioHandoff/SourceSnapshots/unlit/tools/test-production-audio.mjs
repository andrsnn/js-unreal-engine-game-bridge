import {buildSync} from 'esbuild';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const bundle=buildSync({entryPoints:['src/core/audioAssets.ts'],bundle:true,write:false,platform:'node',format:'esm'}).outputFiles[0].text;
const {GENERATED_VOICE_COUNTS,PRODUCTION_AUDIO}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const sfx=JSON.parse(readFileSync('reports/context-audio/production-sfx.json','utf8'));
const music=JSON.parse(readFileSync('reports/context-audio/production-music.json','utf8'));
for(const name of PRODUCTION_AUDIO)assert.ok(sfx.some(a=>a.id===name),`Missing routed sound ${name}`);
for(const [kind,count]of Object.entries(GENERATED_VOICE_COUNTS))assert.equal(sfx.filter(a=>a.id.startsWith(kind+'-')&&/^\d+$/.test(a.id.slice(kind.length+1))).length,count,kind);
for(const row of [...sfx,...music]){
 const path='public/'+row.asset;assert.ok(existsSync(path),path);
 assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),row.sha256,path);
 assert.ok(row.peak<.99&&row.duration>0,path);
}
assert.equal(new Set([...sfx,...music].map(a=>a.sha256)).size,sfx.length+music.length,'Distinct assets, no repeated placeholders');
for(const id of ['enter-vault','enter-space','enter-planet','enter-haven','enter-dark'])assert.ok(sfx.some(a=>a.id===id));
console.log(`PASS ${music.length} scores, ${sfx.length} effects, complete routing, distinct bytes and export integrity`);
