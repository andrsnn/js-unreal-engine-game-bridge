import {buildSync} from 'esbuild';
import ts from 'typescript';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='godot/assets';mkdirSync(`${root}/audio`,{recursive:true});mkdirSync(`${root}/fonts`,{recursive:true});
const source=readFileSync('src/core/soundBank.ts','utf8');
const ast=ts.createSourceFile('soundBank.ts',source,ts.ScriptTarget.Latest,true);
const definition=ast.statements.find(n=>ts.isTypeAliasDeclaration(n)&&n.name.text==='VoiceKind');
if(!definition||!ts.isUnionTypeNode(definition.type))throw Error('VoiceKind declaration changed');
const voices=definition.type.types.map(n=>{if(!ts.isLiteralTypeNode(n)||!ts.isStringLiteral(n.literal))throw Error('Unsupported voice type');return n.literal.text;});
const code=buildSync({stdin:{contents:"export {synthVoice,weaponVoice} from './src/core/soundBank';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false}).outputFiles[0].text;
const {synthVoice}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const manifest={sampleRate:48000,format:'PCM16 WAV',sourceHash:createHash('sha256').update(source).digest('hex'),recordings:{},synthesized:{}};
for(const file of readdirSync('public/audio')){copyFileSync(`public/audio/${file}`,`${root}/audio/${file}`);manifest.recordings[file]=createHash('sha256').update(readFileSync(`public/audio/${file}`)).digest('hex');}
for(const file of readdirSync('public/fonts'))copyFileSync(`public/fonts/${file}`,`${root}/fonts/${file}`);
for(const voice of voices){
 manifest.synthesized[voice]=[];
 for(let variant=0;variant<6;variant++){
  const samples=synthVoice(voice,variant,manifest.sampleRate),data=Buffer.alloc(44+samples.length*2);
  data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(manifest.sampleRate,24);data.writeUInt32LE(manifest.sampleRate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples.length*2,40);
  for(let i=0;i<samples.length;i++){if(!Number.isFinite(samples[i]))throw Error('Non-finite audio sample');data.writeInt16LE(Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),44+i*2);}
  const file=`synth-${voice}-${variant}.wav`;writeFileSync(`${root}/audio/${file}`,data);manifest.synthesized[voice].push(file);
 }
}
writeFileSync('godot/data/audio.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({voices:voices.length,samples:voices.length*6,recordings:Object.keys(manifest.recordings).length}));
