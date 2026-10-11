import fs from 'node:fs';
const root='G:/sfx/karvos/';
const paths=new Set();
for(const file of fs.readdirSync(root+'src').filter(x=>/\.(js|json)$/.test(x))){const s=fs.readFileSync(root+'src/'+file,'utf8');for(const m of s.matchAll(/["'](\/assets\/[^"'\n]+\.(?:glb|gltf|json|bin))["']/g))paths.add(m[1]);}
let index=0,bad=0;const list=[...paths];
await Promise.all(Array.from({length:6},async()=>{while(index<list.length){const url=list[index++];try{const r=await fetch('http://127.0.0.1:5191'+url);const data=new Uint8Array(await r.arrayBuffer());if(r.headers.get('content-type')?.includes('text/html')){bad++;console.log('HTML',url,r.status);}else if(url.endsWith('.glb')&&new TextDecoder().decode(data.slice(0,4))!=='glTF'){bad++;console.log('BADGLB',url);} }catch(e){bad++;console.log('ERROR',url,e.message);}}}));console.log('AUDIT',list.length,'bad',bad);
