import './browser-safety.cjs';
import {chromium} from 'playwright';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const dir='shots/westbound-soundings';mkdirSync(dir,{recursive:true});const input=JSON.parse(readFileSync('shots/westbound-earned/failure-save.json','utf8'));
const b=await chromium.launch({args:['--use-gl=angle','--enable-webgl','--ignore-gpu-blocklist']}),p=await b.newPage({viewport:{width:1600,height:1000}}),checks=[],errors=[],trace=[];p.on('pageerror',e=>errors.push(String(e)));
await p.addInitScript(s=>{if(!localStorage.getItem('starweave_save_v1'))localStorage.setItem('starweave_save_v1',JSON.stringify(s));let api;Object.defineProperty(window,'__game',{configurable:true,get:()=>api,set:v=>{api=v;v.pause(true)}})},input);
const step=n=>p.evaluate(n=>__game.step(1/60,n),n),state=()=>p.evaluate(()=>__game.state),snap=()=>p.evaluate(()=>__game.snapshot()),cmd=(n,...a)=>p.evaluate(([n,a])=>__game.cmd(n,...a),[n,a]);
const ready=async()=>{await p.waitForFunction(()=>window.__game?.ready,null,{timeout:60000});await p.mouse.move(800,500);await step(2)},hold=async(k,n)=>{await p.keyboard.down(k);await step(n);await p.keyboard.up(k)},tap=k=>hold(k,1),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const check=(name,pass,detail)=>{checks.push({name,pass,detail});console.log(pass?'PASS':'FAIL',name,detail??'');if(!pass)throw Error(name)};
const save=async name=>{await p.evaluate(()=>__game.save());writeFileSync(`${dir}/${name}-save.json`,JSON.stringify(await state()));writeFileSync(`${dir}/${name}.json`,JSON.stringify({state:await state(),snapshot:await snap()},null,2));await p.screenshot({path:`${dir}/${name}.png`});};
async function dock(){if(!(await snap()).docked){await tap('x');await cmd('goto','station',35);await tap('e');await step(130);}}
async function fuel(){await tap('m');for(let i=0;i<50&&await p.locator('[data-fuel-buy]').isEnabled();i++)await p.locator('[data-fuel-buy]').click();await p.locator('[data-map-close]').click();}
async function jump(to){
 if((await snap()).docked){await fuel();await p.locator('[data-undock]').click();await step(180);}let cleared=false;
 for(let i=0;i<6;i++){
  if((await snap()).player.drift)await tap('Space');while((await snap()).power.mode!=='engines')await tap('v');await hold('w',660);await p.keyboard.down('w');await p.keyboard.down('ShiftLeft');await step(660);await tap('Space');await p.keyboard.up('w');await p.keyboard.up('ShiftLeft');await step(660);await hold('x',120);
  await tap('m');await p.locator(`[data-system="${to}"]`).click();
  const ss=await snap();trace.push({event:'departure',to,i,hull:ss.player.hull,position:ss.player.pos,reason:await p.locator('[data-jump-reason]').innerText()});console.log('DEPART',to,i,trace.at(-1));
  if(await p.locator('[data-jump]').isEnabled()){cleared=true;break;}await p.locator('[data-map-close]').click();if(ss.dead)break;
 }
 check('Normal boost/braking clears the departure '+to,cleared);
 const before=(await state()).travel.fuel;await p.locator('[data-jump]').click();await step(250);await ready();check('Paid lane '+to,(await state()).travel.system===to&&(await state()).travel.fuel<before);await dock();
}

async function orient(yaw,pitch=.35){const cp=await cmd('camProbe');await p.mouse.move(800,500);await step(1);await p.mouse.down({button:'middle'});await p.mouse.move(800-wrap(yaw-cp.camYaw)/.005,500+(pitch-cp.camPitch)/.004);await step(1);await p.mouse.up({button:'middle'});await p.mouse.move(800,500);await step(1);}
async function walk(x,z,stop=3){for(let i=0;i<100;i++){const ss=await snap(),dx=x-ss.hero.pos[0],dz=z-ss.hero.pos[2];if(Math.hypot(dx,dz)<stop)return;await orient(Math.atan2(dx,dz)-Math.PI);await hold('w',10);}throw Error('Bounded ground walk did not arrive');}
async function component(slot,id){await p.locator(`[data-workshop-select-socket="${slot}"]`).first().click();await p.locator(`[data-workshop-part="${id}"]`).click();await p.locator('[data-workshop-install]').click();}
async function terrainWalk(tx,tz,stop=2.5){
 const path=await p.evaluate(({tx,tz,stop})=>{
  const [sx,,sz]=__game.snapshot().hero.pos,spacing=1.5,key=(x,z)=>x+','+z,heights=new Map();
  const H=(x,z)=>{const k=key(x,z);if(!heights.has(k))heights.set(k,__game.cmd('terrainProbe',x,z).height);return heights.get(k)};
  const start={x:0,z:0,g:0,parent:null},open=[start],seen=new Set(),xpos=x=>sx+x*spacing,zpos=z=>sz+z*spacing;
  for(let n=0;n<30000&&open.length;n++){
   open.sort((a,b)=>(a.g+Math.hypot(xpos(a.x)-tx,zpos(a.z)-tz))-(b.g+Math.hypot(xpos(b.x)-tx,zpos(b.z)-tz)));const cur=open.shift(),k=key(cur.x,cur.z);if(seen.has(k))continue;seen.add(k);
   if(Math.hypot(xpos(cur.x)-tx,zpos(cur.z)-tz)<stop&&Math.abs(H(xpos(cur.x),zpos(cur.z))-H(tx,tz))<3){const out=[];for(let v=cur;v;v=v.parent)out.push([xpos(v.x),zpos(v.z)]);return out.reverse();}
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
    const x=cur.x+dx,z=cur.z+dz,dist=Math.hypot(dx,dz)*spacing;if(seen.has(key(x,z))||Math.hypot(x*spacing,z*spacing)>160)continue;
    let previous=H(xpos(cur.x),zpos(cur.z)),valid=true;
    for(let i=1;i<=4;i++){const h=H(xpos(cur.x+dx*i/4),zpos(cur.z+dz*i/4));if(Math.abs(h-previous)>dist/4*.8){valid=false;break}previous=h;}
    if(valid)open.push({x,z,g:cur.g+dist,parent:cur});
   }
  }return null;
 },{tx,tz,stop});check('A reversible terrain route connects the actual surface endpoints',!!path,{target:[tx,tz],steps:path?.length});writeFileSync(`${dir}/walk-route-${tx}-${tz}.json`,JSON.stringify(path));
 for(let i=1;i<path.length;i++)await walk(...path[i],.9);
}
const keys=new Set();async function setKeys(wanted){for(const k of [...keys])if(!wanted.includes(k)){await p.keyboard.up(k);keys.delete(k)}for(const k of wanted)if(!keys.has(k)){await p.keyboard.down(k);keys.add(k)}}
async function navigate(target,stop){
 await tap('j');await p.locator(`[data-flight-route="${target}"]`).click();
 for(let i=0;i<1200;i++){
  const text=await p.locator('[data-flight-guidance]').innerText(),d=Number(text.match(/· (\d+) m/)?.[1]);
  if(d<stop){await setKeys([]);await tap('x');await step(70);return}
  const yaw=text.includes('LEFT')?'a':text.includes('RIGHT')?'d':null,pitch=text.includes('↑')?'ArrowUp':text.includes('↓')?'ArrowDown':null;
  await setKeys([...(yaw?[yaw]:[]),...(pitch?[pitch]:[]),...(!yaw&&!pitch?['w']:[])]);if(yaw||pitch)await tap('x');await step(yaw||pitch?3:12);
 }throw Error('Bounded ordinary guidance route did not converge: '+target)
}
try{
 await p.goto('http://localhost:5198/?scene=space&seed=42');await ready();await dock();await p.locator('[data-tab="missions"]').click();check('Actual rescue testimony remains paid below navigator level',(await state()).level===13&&(await state()).credits===4494&&(await state()).flags.westbound_engineer);check('Casebook names useful recovered ocean evidence',await p.locator('[data-campaign-preparation="q_aster_soundings"]').count()===1);await save('01-guidance');await p.locator('[data-campaign-support="q_aster_soundings"]').click();check('Review action focuses the real local commission',await p.locator('[data-accept="q_aster_soundings"]').evaluate(e=>document.activeElement===e));await p.locator('[data-accept="q_aster_soundings"]').click();check('Previously earned visit and drowned record advance immediately',(await state()).quests.find(q=>q.id==='q_aster_soundings').step===2);await p.locator('[data-tab="market"]').click();const cash=(await state()).credits;for(let i=0;i<3;i++)await p.locator('[data-buy="ore_crystal"]').click();check('Actual survey resonators cost192credits',(await state()).credits===cash-192);await p.locator('[data-tab="missions"]').click();await p.locator('[data-deliver-step="q_aster_soundings"]').click();check('Physical survey delivery consumes all three crystals',!((await state()).cargo.ore_crystal));await p.locator('[data-turnin="q_aster_soundings"]').click();check('Earned commission supplies level14 and1000credits',(await state()).level===14&&(await state()).credits===cash-192+1000);check('Preparation detour retires and navigator opens',await p.locator('[data-campaign-preparation]').count()===0&&await p.locator('[data-accept="q_navigator_truth"]').isEnabled());await p.locator('[data-accept="q_navigator_truth"]').click();await save('02-level14');
 await tap('u');await p.locator('[data-workshop-domain="space"]').click();await p.locator('[data-workshop-select-socket="core"]').first().click();await p.locator('[data-workshop-part="pearl_core"]').click();await p.locator('[data-workshop-install]').click();check('Actual rescue fitting enters the owned beam and returns old core',(await state()).ship.weaponRolls[0].tuning.components.core==='pearl_core'&&(await state()).weaponComponents.overdrive_core===2);await save('03-fitted');await p.locator('[data-workshop-close]').click();await p.reload();await ready();check('Delivered crew, earned level, commission and fitting persist',(await state()).level===14&&(await state()).flags.rescue_delivered_westbound&&(await state()).ship.weaponRolls[0].tuning.components.core==='pearl_core');await save('04-final');check('No browser errors',errors.length===0,errors);
}catch(e){errors.push(String(e));console.error(e);await save('failure').catch(()=>{});process.exitCode=1}
finally{writeFileSync('reports/westbound-soundings-runtime.json',JSON.stringify({checks,errors,scope:'Actual failed-level-gate rescue checkpoint. Existing earned submerged record and prior planet visit recognized; real local guidance,192cr purchase, exactdelivery,1000payment and294XP reach level14. Earned LanternCapacitor fitted through UI; old core returned. No stat, cargo, XP, reward or equipment grants.'},null,2));await b.close()}
