import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {registerAudio, registryForGame} from '../JsGameBridge/Tools/register-audio.mjs';
import {createUnrealAudioCatalog} from '../JsGameBridge/JavaScript/UnrealAudioCatalog.mjs';

const root='/mnt/g/JsGameBridge',hash=data=>createHash('sha256').update(data).digest('hex');
const priorPath=root+'/Registry/audio-cues-v11.json',runtimePath=root+'/JavaScript/hardburn-assets.json';
const priorBytes=await fs.readFile(priorPath),runtimeBytes=await fs.readFile(runtimePath);
const prior=JSON.parse(priorBytes),base=JSON.parse(runtimeBytes);
const handoff=JSON.parse(await fs.readFile('/mnt/g/sfx/hardburn-unreal-audio-v12.json','utf8'));
assert(/^[0-9a-f]{40}$/.test(handoff.eventControls?.boardingAccents?.authoritativeEventBridgeCommit??''),
 'Audio12 registration requires the reviewed, committed authoritative boarding event bridge; preparation alone must not replace live metadata.');
const generated=await registerAudio([handoff],{readFile:filename=>fs.readFile(filename.replace(/^G:[\\/]/,'/mnt/g/'))});
const full={...prior,games:{...prior.games,hardburn:generated.games.hardburn}};
for(const game of ['karvos','unlit'])assert.deepEqual(full.games[game],prior.games[game]);
assert.deepEqual(Object.keys(full.games.hardburn.cues),Object.keys(prior.games.hardburn.cues));
assert.deepEqual(full.games.hardburn.aliases,prior.games.hardburn.aliases);
const cueChanges=[];
for(const [key,cue] of Object.entries(full.games.hardburn.cues))assert.deepEqual(cue,prior.games.hardburn.cues[key],'Pass12 changes event controls only; cue/sample packages must stay byte-equivalent');
const registry=registryForGame(full,'hardburn');
const runtime={...base,audioPass:registry.audioPass,sourceCommit:registry.sourceCommit,eventControls:registry.eventControls,mix:registry.mix,assets:createUnrealAudioCatalog(registry).mergeAssets(base.assets)};
const audioFields=new Set(['sound','loop','spatial','bus','minDistance','maxDistance']);
for(const [key,value] of Object.entries(base.assets))for(const [field,existing] of Object.entries(value))if(!audioFields.has(field)||!registry.assets[key])assert.deepEqual(runtime.assets[key][field],existing,'Foreign asset field '+key+'.'+field);
const audioTop=new Set(['assets','audioPass','sourceCommit','eventControls','mix']);
for(const [key,value] of Object.entries(base))if(!audioTop.has(key))assert.deepEqual(runtime[key],value,'Foreign top-level field '+key);
assert.deepEqual(Object.keys(runtime.assets),Object.keys(base.assets));
const unchanged=async(file,bytes)=>assert((await fs.readFile(file)).equals(bytes),'Concurrent edit '+file);
await unchanged(priorPath,priorBytes);await unchanged(runtimePath,runtimeBytes);
const outputs={};
async function write(file,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');await fs.writeFile(file+'.audio-v12.tmp',bytes);await fs.rename(file+'.audio-v12.tmp',file);outputs[file]={sha256:hash(bytes),bytes:bytes.length};}
await write(root+'/Registry/audio-cues-v12.json',full);
await write(root+'/Registry/hardburn-sounds.json',registry);
await unchanged(runtimePath,runtimeBytes);
await write(runtimePath,runtime);
const proof={version:1,sourceCommit:handoff.sourceCommit,audioPass:12,cueChanges,canonicalCueCount:Object.keys(registry.assets).length-Object.keys(full.games.hardburn.aliases).length,aliasCount:Object.keys(full.games.hardburn.aliases).length,otherGamesPreserved:true,waveHashesPreserved:true,foreignRuntimeFieldsPreserved:true,runtimeKeys:Object.keys(runtime.assets).length,outputs};
await write('/mnt/g/sfx/hardburn-native-v12-registration.json',proof);
console.log(JSON.stringify(proof,null,2));
