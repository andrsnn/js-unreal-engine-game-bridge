import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {buildSync} from 'esbuild';
const build=contents=>buildSync({stdin:{contents,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm'}).outputFiles[0].text;
const {PHYSICAL_VOICE_COUNTS,PHYSICAL_AUDIO,PHYSICAL_AUDIO_REVISION}=await import('data:text/javascript;base64,'+Buffer.from(build("export * from './src/core/audioAssets';")).toString('base64'));
const {weaponVoice}=await import('data:text/javascript;base64,'+Buffer.from(build("export {weaponVoice} from './src/core/soundBank';")).toString('base64'));
const ledger=JSON.parse(readFileSync('reports/physical-audio/assets.json','utf8'));
assert.equal(ledger.revision,PHYSICAL_AUDIO_REVISION);assert.equal(ledger.clips.length,PHYSICAL_AUDIO.size);
for(const [kind,count]of Object.entries(PHYSICAL_VOICE_COUNTS)){
 const takes=ledger.clips.filter(x=>x.name.startsWith(kind+'-'));assert.equal(takes.length,count);
 assert.equal(new Set(takes.map(x=>x.sha256)).size,count,kind+' repeated recording');
 for(const clip of takes){assert.ok(clip.peak<.98&&clip.rms>.003);assert.ok(clip.seconds<=2.1);assert.equal(createHash('sha256').update(readFileSync(clip.file)).digest('hex'),clip.sha256);}
}
assert.ok(ledger.totals.bytes<1024*1024,'compressed bank exceeds 1MB');assert.ok(ledger.totals.decodedBytes<12*1024*1024,'resident bank exceeds 12MB');
for(const [archetype,expected]of [['rifle','rifle'],['pistol','pistol'],['beltfed lmg','lmg'],['marksman','sniper'],['rotary','rotary'],['plasma','plasma'],['rail lance','rail']])assert.equal(weaponVoice({archetype},false),expected);
assert.equal(weaponVoice({archetype:'rifle',tuning:{components:{barrel:'suppressor'}}},false),'suppressed');
for(const [file,needle]of [['src/game/hostiles.ts','distance:p.distanceTo(w.heroPos),enemy:true'],['src/scenes/dungeonScene.ts','archetype:troop.weapon},false,{distance,enemy:true']])assert.ok(readFileSync(file,'utf8').includes(needle),'Infantry must use distant/enemy mix');
writeFileSync('reports/physical-audio/validation.json',JSON.stringify({passed:true,...ledger.totals,checks:['manifest coverage','codec headroom and signal','unique recorded variants','file integrity','bounded download/resident memory','equipment routing and suppressors','infantry enemy mix']},null,2));
console.log('PASS physical weapon assets, memory budgets, equipment selection and enemy routing',ledger.totals);
