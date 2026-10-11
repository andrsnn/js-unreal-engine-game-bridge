import {build} from '/mnt/c/Users/Aidan Anderson/saltblade/node_modules/vite/dist/node/index.js';
import fs from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';
const root='/mnt/c/Users/Aidan Anderson/saltblade',out='/mnt/g/sfx/salt-deadline-snapshot';
async function fingerprint(directory){const result={};async function walk(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=dir+'/'+entry.name;if(entry.isDirectory())await walk(p);else result[p.slice(directory.length)]=createHash('sha256').update(await fs.readFile(p)).digest('hex');}}await walk(directory);return result;}
const before=await fingerprint(root+'/src');const started=Date.now();
await build({root,configFile:root+'/vite.config.ts',build:{outDir:out,emptyOutDir:true,copyPublicDir:false},logLevel:'warn'});
const after=await fingerprint(root+'/src');if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Source changed during snapshot build');
const proof={source:root,commit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',timeout:15000}).trim(),compiledSnapshot:true,sourceStableDuringBuild:true,sourceHashes:after,publicFallback:root+'/public',copiedPublic:false,builtAt:new Date().toISOString(),milliseconds:Date.now()-started};
await fs.writeFile(out+'/audio-build-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,sourceHashes:undefined}));
