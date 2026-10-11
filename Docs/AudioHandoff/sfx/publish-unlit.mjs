import fs from 'node:fs/promises';import crypto from 'node:crypto';
const version=process.argv[2]||'1';
const source=process.argv[3]||'G:/sfx/builds/unlit-audio-v1',dest='C:/Users/Aidan Anderson/space-game-asset-sources/owner-fixes',backup=`G:/sfx/integration/unlit-publish-v${version}`;
const index=await fs.readFile(source+'/index.html');if(!(await fs.stat(dest+'/index.html')).isFile())throw Error('Existing owner release absent');await fs.mkdir(backup,{recursive:true});await fs.copyFile(dest+'/index.html',backup+'/previous-index.html');
for(const entry of await fs.readdir(source,{withFileTypes:true}))if(entry.name!=='index.html')await fs.cp(source+'/'+entry.name,dest+'/'+entry.name,{recursive:true});
await fs.cp('G:/sfx/unlit/public/audio/physical-v4',dest+'/audio/physical-v4',{recursive:true});
await fs.copyFile('G:/sfx/unlit/public/audio/CREDITS.md',dest+'/audio/CREDITS.md');await fs.writeFile(dest+'/index.audio-v1.tmp',index);await fs.rename(dest+'/index.audio-v1.tmp',dest+'/index.html');
const response=await fetch('http://127.0.0.1:5336/');const live=await response.text();if(!response.ok||live!==index.toString())throw Error('Live owner server has a different index');
await fs.writeFile(backup+'/receipt.json',JSON.stringify({source,dest,time:new Date().toISOString(),indexSHA256:crypto.createHash('sha256').update(index).digest('hex'),http:response.status},null,2));console.log(`Published audio v${version} to existing owner release on5336; prior index and old assets retained.`);
