import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const root='G:/sfx/karvos',git='C:/Program Files/Git/cmd/git.exe';
const run=(args)=>{const r=spawnSync(git,['-C',root,...args],{encoding:'utf8',timeout:45000,windowsHide:true});if(r.status||r.error)throw Error(JSON.stringify({args,stdout:r.stdout,stderr:r.stderr,error:r.error}));return r.stdout.trim();};
const files=['src/audio-mixer.js','src/audio-reverb.js','src/audio-scene.js','src/audio-voices.js','src/enemy-audio.js','src/field-audio.js','src/session-menu.js','public/audio/bank.json'];const hashes=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(root+'/'+f)).digest('hex')]));
const before=run(['rev-parse','HEAD']),old=hashes(),primary=run(['rev-parse','main']);console.log(run(['merge','main','--no-edit']));const tip=run(['rev-parse','HEAD']),current=hashes();for(const f of files)if(old[f]!==current[f])throw Error('Audio hash changed during main sync '+f);
const changed=run(['diff','--name-only',before,tip]).split(/\r?\n/).filter(f=>f.endsWith('.js')||f.endsWith('.mjs'));
for(const f of changed){const r=spawnSync(process.execPath,['--check',root+'/'+f],{encoding:'utf8',timeout:10000,windowsHide:true});if(r.status||r.error)throw Error('Syntax failed '+f+' '+r.stderr);}
const receipt={before,primary,tip,audioHashesUnchanged:true,checkedJS:changed,time:new Date().toISOString()};fs.writeFileSync('G:/sfx/karvos-final-sync-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
