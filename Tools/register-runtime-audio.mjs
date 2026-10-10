import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUnrealAudioCatalog} from '../JavaScript/UnrealAudioCatalog.mjs';
const root='G:/JsGameBridge',hash=data=>createHash('sha256').update(data).digest('hex'),results=[];
const requested=process.argv.slice(2);if(requested.some(game=>!['hardburn','karvos','unlit'].includes(game)))throw Error('Unknown audio game');
for(const game of requested.length?requested:['hardburn','karvos','unlit']){
 const registry=JSON.parse(await fs.readFile(`${root}/Registry/${game}-sounds.json`,'utf8'));
 const target=`${root}/JavaScript/${game}-assets.json`;
 let original=null,base={version:1,assets:{}};
 try{original=await fs.readFile(target);base=JSON.parse(original);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(game==='karvos'&&!original){const source=JSON.parse(await fs.readFile('C:/Users/Aidan Anderson/karvos/src/platform/asset-keys.json','utf8'));for(const [key,value]of Object.entries(source.assets))if(value.unreal)base.assets[key]={...value.unreal};}
 const merged={...base,assets:createUnrealAudioCatalog(registry).mergeAssets(base.assets)};
 for(const [key,value]of Object.entries(base.assets??{}))for(const [field,existing]of Object.entries(value))if(field!=='sound'&&JSON.stringify(merged.assets[key][field])!==JSON.stringify(existing))throw Error('Foreign registry field changed: '+key+'.'+field);
 if(original&&Object.entries(registry.assets).every(([key,value])=>base.assets?.[key]?.sound===value.sound)){results.push({game,target,keys:Object.keys(registry.assets).length,baseKeys:Object.keys(base.assets??{}).length,sha256:hash(original),unchanged:true});continue;}
 if(original){const current=await fs.readFile(target);if(!current.equals(original))throw Error('Concurrent registry modification; retry required');await fs.mkdir(`${root}/Tools/AudioImporter/reports/runtime-registry-backups`,{recursive:true});await fs.writeFile(`${root}/Tools/AudioImporter/reports/runtime-registry-backups/${game}-${hash(original).slice(0,12)}.json`,original);}
 const data=Buffer.from(JSON.stringify(merged,null,2)+'\n');await fs.writeFile(target+'.audio.tmp',data);await fs.rename(target+'.audio.tmp',target);
 results.push({game,target,keys:Object.keys(registry.assets).length,baseKeys:Object.keys(base.assets??{}).length,sha256:hash(data)});
}
await fs.writeFile(`${root}/Tools/AudioImporter/reports/runtime-registries.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
