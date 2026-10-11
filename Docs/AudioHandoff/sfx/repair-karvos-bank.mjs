import fs from 'node:fs/promises';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const root='C:/Users/Aidan Anderson/karvos',git='C:/Program Files/Git/cmd/git.exe';
const run=args=>{const r=spawnSync(git,['-C',root,...args],{timeout:30000,windowsHide:true});if(r.status)throw Error(r.stderr.toString());return r.stdout;};
const data=await fs.readFile(root+'/public/audio/bank.json'),head=run(['show','HEAD:public/audio/bank.json']),index=run(['show',':public/audio/bank.json']);
if(!data.equals(head)||!data.equals(index))throw Error('Bank has new changes; refusing restore');
await fs.writeFile('G:/sfx/karvos-primary-bank-preserved.json',data);
run(['restore','--worktree','--','public/audio/bank.json']);
console.log('Restored Git checkout representation after exact HEAD/index comparison',createHash('sha256').update(data).digest('hex'));
