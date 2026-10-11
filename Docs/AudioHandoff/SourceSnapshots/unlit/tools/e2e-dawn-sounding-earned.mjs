import './browser-safety.cjs';
import {chromium} from 'playwright';import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const dir='shots/dawn-sounding-earned';mkdirSync(dir,{recursive:true});const input=JSON.parse(readFileSync('tools/fixtures/westbound-pilot.json','utf8'));
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
async function fitCore(id){await p.locator('[data-workshop-select-socket="core"]').first().click();await p.locator(`[data-workshop-part="${id}"]`).click();await p.locator('[data-workshop-install]').click();}
try{
 await p.goto('http://localhost:5198/?scene=space&seed=42');await ready();await dock();
 for(const to of ['helios','sirocco','pelagia'])await jump(to);
 await p.locator('[data-tab="expeditions"]').click();await p.locator('[data-expedition-start="dawn_preparation"]').click();check('Earned pilot starts the new connected preparation trip',(await state()).expeditionJournal.active?.route==='dawn_preparation');
 await p.locator('[data-tab="missions"]').click();await p.locator('[data-accept="q_dawn_sounding"]').click();await step(2);await save('01-accepted');
 await p.locator('[data-undock]').click();await step(180);await navigate('pale_sounding',35);await save('02-buoy');
 for(let i=0;i<40&&!(await state()).spaceOperations.pale_sounding.recovered;i++)await hold('e',60);
 check('Ordinary pulse-window interaction recovers the escaped record',(await state()).spaceOperations.pale_sounding.recovered);await save('03-record');
 await navigate('station',55);await tap('e');await step(220);check('Normal local flight returns to Breakwater',(await snap()).docked);
 await p.locator('[data-tab="missions"]').click();const cash=(await state()).credits;await p.locator('[data-turnin="q_dawn_sounding"]').click();check('Physical record pays900 and an owned collimator',(await state()).credits===cash+900&&(await state()).weaponComponents.relay_lens===1);await save('04-paid');
 await p.reload();await ready();check('Filed spectral evidence persists once',(await state()).quests.find(q=>q.id==='q_dawn_sounding').stage==='done'&&(await state()).weaponComponents.relay_lens===1);await save('05-final');check('No browser errors',errors.length===0,errors);
}catch(e){errors.push(String(e));console.error(e);await setKeys([]);await save('failure').catch(()=>{});process.exitCode=1}
finally{writeFileSync('reports/dawn-sounding-earned-runtime.json',JSON.stringify({checks,errors,trace,scope:'Actual saved westbound pilot, three paid native departures/jumps, real new quest acceptance, normal J-guided buoy/port flight, held pulse-window recovery and once-only reward/reload. Port approaches on initial paid jumps are fixtures. No resources, XP, equipment, health or victory grants.'},null,2));await b.close()}
