// Preparation only. Root must release the one-browser lane before running.
// All gameplay actions are trusted keyboard events; __world is read-only.
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

if (!process.argv.includes('--browser-released')) {
  throw Error('Root must release the browser lane, then pass --browser-released.');
}
const require = createRequire('C:/Users/Aidan Anderson/falling-frontier-clone/package.json');
const {chromium} = require('playwright');
const out = 'G:/sfx/evidence/saltblade/shield-delve-audio6-' + Date.now();
const delveId = process.env.SFX_DELVE === 'platform-2' ? 'platform-2' : 'smugglers-cut';
const report = {
  out, url: process.env.SFX_URL || 'http://100.69.252.53:5203/?test=1',
  audioPass: 6, originalInputOnly: true, freshStorage: true,
  gameplayStateInjection: false, playbackSpeed: 1,
  provenance: 'Fresh context; native WASD/J/U/L/K/E/H only. Read-only __world snapshots. Actual postmaster MediaRecorder and CDP epoch frames.',
  route: {shield: 'nearest living pb0/patrolB', delveId},
  errors: [], missing: [], phases: [], inputs: [], segments: [], observed: {},
};
await fs.mkdir(out, {recursive: true});
let browser, page, cdp, active, held = new Set(), start = Date.now();
const limit = start + 240000;
const deadline = () => {if (Date.now() >= limit) throw Error('240-second native-route bound exceeded');};
const watchdog = setTimeout(() => {void browser?.close().catch(() => {});process.exitCode = 1;}, 240000);
const eventKeys = ['shield-deflect','shield-pierce','shield-overload','shield-ready','shield-reaction',
  'slow-blade','bash','parry','hit','heavy-hit','kill','descend','delve-read','delve-loot','trap-plate','trap-laser','delve-lever','delve-power'];
const deltas = (before, after) => Object.fromEntries(eventKeys.map(k => [k, (after[k] || 0) - (before[k] || 0)]));
const dirs = [['d','s'],['s'],['a','s'],['a'],['a','w'],['w'],['d','w'],['d']];
// app.input: world x=(sx+sy)*.7071, y=(sy-sx)*.7071.
const steer = (dx,dy) => dirs[((Math.round(Math.atan2(dy,dx)/(Math.PI/4)) % 8) + 8) % 8];

try {
  browser = await chromium.launch({headless: true, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-background-timer-throttling']});
  const ctx = await browser.newContext({viewport: {width:1280,height:720}, reducedMotion:'reduce'});
  // This local game has no gameplay network; prevent a lead's later HMR reload
  // from replacing the already loaded source during the genuine campaign.
  await ctx.routeWebSocket('**',socket=>socket.close());report.hmrSocketClosed=true;
  page = await ctx.newPage();page.setDefaultTimeout(12000);
  await page.addInitScript(() => {Element.prototype.requestPointerLock = () => Promise.resolve();});
  page.on('pageerror', e => report.errors.push(e.stack));
  page.on('response', r => {if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.missing.push({url:r.url(),status:r.status()});});
  const read = () => page.evaluate(() => {
    const w=window.__world,s=w.sim.s,d=s.dungeon;
    return {t:s.t,mode:s.mode,dead:s.dead,player:{...s.player},craft:{...s.craft},
      fighter:{act:s.fighter.act?{...s.fighter.act}:null,breath:s.fighter.breath,kills:s.fighter.kills,
        shield:s.fighter.sh,shieldDown:s.fighter.shDown,guard:s.fighter.guard,riposte:s.fighter.riposte},
      weapon:s.weapon,inventory:{...s.inventory},reading:s.reading?{...s.reading}:null,
      found:[...s.found],banner:s.banner?{...s.banner}:null,audio:w.sfx.status(),
      foes:s.foes.filter(f=>f.hp>0&&f.kind!=='hare').map(f=>({id:f.id,kind:f.kind,group:f.group,x:f.x,y:f.y,
        hp:f.hp,state:f.state,timer:f.timer,arc:f.arc,heavy:f.heavy,aggro:f.aggro,
        shield:f.sh,shieldOn:f.shOn,shieldDown:f.shDown,shieldDirection:f.shDir})),
      discoveries:s.discoveries.filter(x=>x.kind==='delve').map(x=>({id:x.id,x:x.x,y:x.y,found:x.found})),
      dungeon:d?{id:d.id,delveId:d.delve?.id,depth:d.depth,cleared:d.cleared,done:d.done,used:[...d.used],
        doors:d.doors.map(x=>({...x})),room:d.room?{w:d.room.w,h:d.room.h,
          traps:d.room.traps?.map(x=>({...x})),lore:d.room.lore?.map(x=>({...x})),
          chest:d.room.chest?{...d.room.chest}:null,pillars:d.room.pillars.map(x=>[...x])}:null}:null};
  });
  const checked = async () => {
    deadline();const s=await read();
    if(s.audio.audioPass!==6)throw Error('Expected merged audioPass6; got '+s.audio.audioPass);
    if(s.audio.maxLoops!==7||s.audio.maxVoice!==24||s.audio.loops.length>7||s.audio.voices>24)
      throw Error('Actual audio graph exceeded or changed the 7-loop/24-voice contract');
    if(s.dead>0||s.player.hp<=0)throw Error('Actual player defeated; no respawn or reset footage accepted');
    return s;
  };
  const snap = async label => {const s=await read();report.phases.push({label,wallEpoch:Date.now()/1000,...s});return s;};
  const keys = async arr => {
    const next=new Set(arr);
    for(const k of held)if(!next.has(k)){report.inputs.push({wallEpoch:Date.now()/1000,up:k});await page.keyboard.up(k);}
    for(const k of next)if(!held.has(k)){report.inputs.push({wallEpoch:Date.now()/1000,down:k});await page.keyboard.down(k);}
    held=next;
  };
  const press = async key => {deadline();report.inputs.push({wallEpoch:Date.now()/1000,press:key});await page.keyboard.press(key);};
  const nearest = s => s.foes.filter(f=>Math.hypot(f.x-s.player.x,f.y-s.player.y)<12)
    .sort((a,b)=>Math.hypot(a.x-s.player.x,a.y-s.player.y)-Math.hypot(b.x-s.player.x,b.y-s.player.y))[0];
  // Short native sidesteps recover from actual props/pillars. No collision or position writes.
  let stuckAt=0,lastWalk=null,detourUntil=0,detourSign=1;
  const walkTo = async (s,x,y,radius=1.2) => {
    const dx=x-s.player.x,dy=y-s.player.y,d=Math.hypot(dx,dy);
    if(d<=radius){await keys([]);lastWalk=null;return true;}
    const now=Date.now();
    if(!lastWalk||Math.hypot(lastWalk.x-s.player.x,lastWalk.y-s.player.y)>.25){lastWalk={...s.player};stuckAt=now;}
    else if(now-stuckAt>1100){detourUntil=now+750;detourSign*=-1;stuckAt=now;}
    const a=Math.atan2(dy,dx)+(now<detourUntil?detourSign*Math.PI/2:0);
    await keys(steer(Math.cos(a),Math.sin(a)));return false;
  };
  cdp=await ctx.newCDPSession(page);
  cdp.on('Page.screencastFrame',e=>{
    const seg=active;
    if(seg){const timestamp=e.metadata.timestamp;
      if(!Number.isFinite(timestamp)||timestamp<1e9)report.errors.push('Invalid CDP epoch');
      else{const file='frames/'+String(seg.frames.length).padStart(6,'0')+'.jpg';
        seg.frames.push({file,timestamp});seg.writes.push(fs.writeFile(seg.path+'/'+file,Buffer.from(e.data,'base64')));}}
    void cdp.send('Page.screencastFrameAck',{sessionId:e.sessionId}).catch(()=>{});
  });
  const begin = async label => {
    if(active)throw Error('Capture segment overlap');
    const seg={label,path:out+'/'+label,frames:[],writes:[],before:(await read()).audio.played};
    await fs.mkdir(seg.path+'/frames',{recursive:true});active=seg;report.segments.push(seg);
    await cdp.send('Page.startScreencast',{format:'jpeg',quality:86,maxWidth:1280,maxHeight:720,everyNthFrame:1});
    // CDP startup can cost >350ms. Establish an actual image epoch before
    // beginning sound, rather than silently stretching a late first image.
    const firstFrameDeadline=Date.now()+5000;
    while(!seg.frames.length){if(Date.now()>firstFrameDeadline)throw Error('CDP first frame timeout');await page.waitForTimeout(25);}
    seg.audioStart=await page.evaluate(()=>{
      const stream=__world.sfx.recordingStream();if(!stream)throw Error('Actual postmaster stream absent');
      window.__shieldFilmChunks=[];
      window.__shieldFilmRecorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus',audioBitsPerSecond:192000});
      __shieldFilmRecorder.ondataavailable=e=>{if(e.data.size)__shieldFilmChunks.push(e.data);};
      const epoch=Date.now()/1000;__shieldFilmRecorder.start(100);return epoch;
    });
    await snap('Record '+label);
  };
  const finish = async () => {
    const seg=active;if(!seg)return;
    seg.audioEnd=await page.evaluate(()=>Date.now()/1000);
    const encoded=await page.evaluate(async()=>{
      const b=await new Promise(resolve=>{__shieldFilmRecorder.onstop=()=>resolve(new Blob(__shieldFilmChunks,{type:__shieldFilmRecorder.mimeType}));__shieldFilmRecorder.stop();});
      const a=new Uint8Array(await b.arrayBuffer());let text='';
      for(let i=0;i<a.length;i+=32768)text+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(text);
    });
    await cdp.send('Page.stopScreencast');active=null;await Promise.all(seg.writes);
    await fs.writeFile(seg.path+'/audio.webm',Buffer.from(encoded,'base64'));
    const frames=seg.frames.filter(f=>f.timestamp<=seg.audioEnd);
    if(frames.length<10)throw Error('Insufficient actual epoch frames in '+seg.label);
    let i=frames.findLastIndex(f=>f.timestamp<=seg.audioStart);if(i<0)i=0;
    seg.firstFrameAfterAudioSeconds=Math.max(0,frames[i].timestamp-seg.audioStart);
    if(seg.firstFrameAfterAudioSeconds>.35)throw Error('Unbounded A/V epoch gap in '+seg.label);
    let concat='ffconcat version 1.0\n';
    for(;i<frames.length;i++){
      // First available image covers any initial sub-frame audio gap. Keep wall time.
      const begin=i===0||frames[i-1]?.timestamp<seg.audioStart?seg.audioStart:frames[i].timestamp;
      const end=Math.min(seg.audioEnd,frames[i+1]?.timestamp??seg.audioEnd);
      if(end>begin)concat+="file '"+frames[i].file+"'\nduration "+(end-begin).toFixed(6)+'\n';
    }
    concat+="file '"+frames.at(-1).file+"'\n";
    await fs.writeFile(seg.path+'/frames.ffconcat',concat);
    seg.elapsed=seg.audioEnd-seg.audioStart;seg.after=(await read()).audio.played;
    seg.played=deltas(seg.before,seg.after);delete seg.writes;
    await page.screenshot({path:seg.path+'/last.png'});
  };
  for(const name of ['audio','app','combat','delves']){
    const response=await fetch(new URL('/src/world/'+name+'.ts',report.url),{signal:AbortSignal.timeout(5000)}).catch(()=>null);
    if(response?.ok){const body=Buffer.from(await response.arrayBuffer());
      if(!body.subarray(0,80).toString().includes('<!doctype'))report[name+'LiveSHA']=createHash('sha256').update(body).digest('hex');}
  }
  report.sourceSHAReadEpoch=Date.now()/1000;
  await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:35000});
  await page.waitForFunction(()=>window.__world?.sfx?.status,null,{timeout:45000});
  // H is an ordinary fresh-campaign key: no food exists, and it unlocks sound without an accidental cut.
  await press('h');await page.waitForTimeout(700);
  report.actualRenderer=await page.evaluate(()=>{
    const canvas=document.querySelector('canvas'),gl=canvas?.getContext('webgl2')||canvas?.getContext('webgl');
    if(!gl)return 'No WebGL';const ext=gl.getExtension('WEBGL_debug_renderer_info');
    return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  });
  if(!/swiftshader/i.test(report.actualRenderer))throw Error('Software-only lane renderer mismatch: '+report.actualRenderer);
  let s=await snap('Actual fresh native camp');
  if(s.mode!=='foot'||Math.hypot(s.player.x-178.2,s.player.y-236.8)>4||s.t>12)
    throw Error('Expected untouched fresh open-world camp; existing campaign not accepted');
  await checked();report.baseline={...s.audio.played};
  const travelStart=Date.now();
  while(Date.now()-travelStart<55000){
    s=await checked();const target=s.foes.find(f=>f.id==='pb0')||s.foes.find(f=>f.group==='patrolB'&&f.shield>0);
    if(!target)throw Error('Fresh shield patrol missing; no substitute fixture used');
    if(Math.hypot(target.x-s.player.x,target.y-s.player.y)<6.8)break;
    await walkTo(s,target.x,target.y,6.5);await page.waitForTimeout(140);
  }
  s=await checked();const pb=s.foes.find(f=>f.id==='pb0');
  if(!pb||Math.hypot(pb.x-s.player.x,pb.y-s.player.y)>7)throw Error('Bounded native patrol approach failed');
  await keys([]);await begin('01-shield-patrol');
  const duelStart=Date.now();let lastAttack=0,lastDodge=0,lastGuard=0;
  const fight = async (state,wantShieldDemo) => {
    const foe=wantShieldDemo?(state.foes.find(e=>e.id==='pb0')||nearest(state)):nearest(state);if(!foe){await keys([]);return false;}
    const dx=foe.x-state.player.x,dy=foe.y-state.player.y,d=Math.hypot(dx,dy),f=state.fighter,now=Date.now();
    const threatening=state.foes.filter(e=>Math.hypot(e.x-state.player.x,e.y-state.player.y)<2);
    const deflected=(state.audio.played['shield-deflect']||0)>(report.baseline['shield-deflect']||0);
    if(!wantShieldDemo&&threatening.some(e=>e.heavy&&e.state==='windup'&&e.timer<.24)&&now-lastDodge>650){
      await keys(steer(-dx,-dy));await press('k');lastDodge=now;return true;
    }
    if(!wantShieldDemo&&threatening.some(e=>!e.heavy&&e.state==='strike'&&e.arc>=0&&e.arc<.13)&&now-lastGuard>400){
      await keys([]);await press('l');lastGuard=now;return true;
    }
    const normalIncoming=threatening.find(e=>e.id===foe.id&&(e.state==='windup'||e.state==='strike'));
    const pierced=(state.audio.played['shield-pierce']||0)>(report.baseline['shield-pierce']||0);
    if(wantShieldDemo&&!pierced&&f.riposte<=0&&normalIncoming&&
      (held.has('l')||(normalIncoming.state==='windup'&&normalIncoming.timer>.1&&normalIncoming.timer<.42))){
      // Guard early during the real wind-up; keep L down through contact.
      // An early ordinary direction tap turns the player if needed. Never
      // press a fresh L during strike to manufacture a perfect-parry riposte.
      if(!held.has('l')&&!f.act&&Math.cos(Math.atan2(dy,dx)-state.player.face*Math.PI/4)<=.35){
        await keys(steer(dx,dy));await page.waitForTimeout(45);
      }
      await keys(['l']);return true;
    }
    if(f.act){await keys(held.has('l')&&f.act.kind==='parry'?['l']:[]);return true;}
    if(d>1.65){await walkTo(state,foe.x,foe.y,1.55);return true;}
    await keys([]);
    // Get one genuine fast deflection before preferring slow contact. Do not summon transitions.
    if(wantShieldDemo&&deflected&&!pierced&&foe.shield>0&&f.riposte<=0){
      // Sabre contact .66s: start in late recovery so the real shield raises again
      // before contact. Holding/teleporting an enemy state is never permitted.
      if(f.breath>=2&&foe.state==='recover'&&foe.timer>.4&&foe.timer<.57&&now-lastAttack>220){
        await press('u');lastAttack=now;
      }else if(threatening.some(e=>e.state==='windup'&&e.timer<.18)&&now-lastDodge>650){
        await keys(steer(-dx,-dy));await press('k');lastDodge=now;
      }
      return true;
    }
    const slow=f.breath>=2&&(!wantShieldDemo||deflected||Date.now()-duelStart>6000);
    if(f.breath>=1&&now-lastAttack>220){await press(slow?'u':'j');lastAttack=now;}
    return true;
  };
  while(Date.now()-duelStart<18000){
    s=await checked();
    const fought=await fight(s,true);
    if(!fought){const entry=s.discoveries.find(x=>x.id===delveId);if(!entry)throw Error('Authored delve entry missing');await walkTo(s,entry.x,entry.y,2.5);}
    await page.waitForTimeout(90);
  }
  await keys([]);await snap('Actual shield duel ended');await finish();
  const entryStart=Date.now();
  while(Date.now()-entryStart<65000){
    s=await checked();if(s.mode==='dungeon')break;
    const entry=s.discoveries.find(x=>x.id===delveId);if(!entry)throw Error('Authored delve not present');
    if(s.fighter.act){await keys([]);await page.waitForTimeout(100);continue;}
    if(Math.hypot(entry.x-s.player.x,entry.y-s.player.y)<2.7&&entry.found){await keys([]);break;}
    const foe=nearest(s);
    if(foe?.aggro&&Math.hypot(foe.x-s.player.x,foe.y-s.player.y)<2.2)await fight(s,false);
    else await walkTo(s,entry.x,entry.y,2.5);
    await page.waitForTimeout(130);
  }
  s=await checked();const entry=s.discoveries.find(x=>x.id===delveId);
  if(s.mode!=='foot'||!entry?.found||Math.hypot(entry.x-s.player.x,entry.y-s.player.y)>=3)
    throw Error('Native authored-delve approach failed; no descent call or teleport used');
  await keys([]);await begin('02-authored-delve');await press('e');await page.waitForTimeout(450);
  s=await snap('Native E authored delve descent');
  if(s.mode!=='dungeon'||s.dungeon?.delveId!==delveId||s.audio.acoustics!=='dungeon')throw Error('Actual authored room/desert-to-room transition failed');
  const roomStart=Date.now();let visitedPlate=false,readLore=false,openedChest=false,plateEscape=null;
  while(Date.now()-roomStart<28000){
    s=await checked();if(s.mode!=='dungeon')throw Error('Unexpected native delve exit during capture');
    if(s.player.hp<5&&(s.inventory.meat||s.inventory.ration))await press('h');
    const foe=nearest(s),room=s.dungeon.room;
    if(foe){await fight(s,false);}
    else if(s.reading){await keys([]);await press('e');}
    else if(plateEscape){if(await walkTo(s,plateEscape.x,plateEscape.y,.45))plateEscape=null;}
    else if(room&&s.dungeon.cleared){
      const chest=room.chest;
      if(chest&&!openedChest){
        if(await walkTo(s,2000+chest.x+.5,2000+chest.y+.5,1.2)){await press('e');openedChest=true;await snap('Native authored chest interaction');}
      }else if(room.lore?.length&&!readLore){
        const lore=room.lore[0];if(await walkTo(s,2000+lore.x+.5,2000+lore.y+.5,1.2)){await press('e');readLore=true;await snap('Native authored lore interaction');}
      }else if(room.traps?.some(t=>t.kind==='plate')&&!visitedPlate&&s.player.hp>2){
        const t=room.traps.find(t=>t.kind==='plate');
        if(await walkTo(s,2000+t.x+.5,2000+t.y+.5,.35)){
          visitedPlate=true;plateEscape={x:s.player.x+1.8,y:s.player.y};
          await page.waitForTimeout(160);await snap('Native pressure-plate crossing');
        }
      }else await keys([]);
    }else await keys([]);
    await page.waitForTimeout(100);
  }
  await keys([]);await snap('Actual authored delve capture ended');await finish();
  s=await snap('Native acceptance before mute');
  report.observed=deltas(report.baseline,s.audio.played);
  report.shieldObserved=eventKeys.filter(k=>k.startsWith('shield-')&&report.observed[k]>0);
  report.shieldNotObserved=eventKeys.filter(k=>k.startsWith('shield-')&&!report.observed[k]);
  report.claim='Only positive played deltas are demonstrated. Reaction/overload/ready are not guaranteed in a fresh sabre campaign.';
  report.actualKills=s.fighter.kills;report.elapsed=report.segments.reduce((n,x)=>n+x.elapsed,0);
  // Native HUD mute must affect the actual postmaster; restore must be audible.
  await page.locator('[data-world-audio]').click();await page.waitForTimeout(650);
  report.muted=await snap('Native HUD master mute');
  await page.locator('[data-world-audio]').click();await page.waitForTimeout(650);
  report.restored=await snap('Native HUD master restore');
  report.acceptance={audioPass:s.audio.audioPass,maxLoops:s.audio.maxLoops,maxVoice:s.audio.maxVoice,
    buffers:s.audio.buffers,context:s.audio.context,mutePeak:report.muted.audio.peak,restorePeak:report.restored.audio.peak,
    observedDeflect:report.observed['shield-deflect']>0,observedPierce:report.observed['shield-pierce']>0,
    authoredDescent:report.observed.descend>0,actualContact:report.observed.hit+report.observed['heavy-hit']>0,
    gameplayElapsed:s.t,actualKills:s.fighter.kills};
  if(!report.muted.audio.muted||report.muted.audio.peak>.00003||report.restored.audio.muted||report.restored.audio.peak<=.00003)
    throw Error('Actual HUD mute/restore failed');
  if(s.audio.context!=='running'||!s.audio.buffers)throw Error('Native audio unlock/decode failed');
  if(!report.acceptance.observedDeflect||!report.acceptance.observedPierce||!report.acceptance.authoredDescent||!report.acceptance.actualContact)
    throw Error('Native route did not demonstrate minimum actual deflect, slow piercing, authored descent and weapon contact; partial footage retained honestly');
  if(report.elapsed<30||report.elapsed>60)throw Error('Combined actual segments outside 30–60 seconds');
  if(report.errors.length||report.missing.length)throw Error('Actual runtime/HTTP errors');
  report.timestampClock='CDP frame epochs and page Date.now epochs; each segment at actual wall speed. Encode separately then join with concat demuxer.';
  report.encodingInputs=report.segments.map(x=>({label:x.label,frames:x.path+'/frames.ffconcat',audio:x.path+'/audio.webm',seconds:x.elapsed}));
  report.ok=true;
} catch(e) {
  report.ok=false;report.errors.push(e.stack);
  await page?.screenshot({path:out+'/failed.png',timeout:5000}).catch(()=>{});
} finally {
  if(page)for(const key of held)await page.keyboard.up(key).catch(()=>{});
  // Preserve a failed partial segment without presenting it as accepted footage.
  if(active){
    active.incomplete=true;await cdp?.send('Page.stopScreencast').catch(()=>{});
    await Promise.allSettled(active.writes||[]);delete active.writes;
    const encoded=await page?.evaluate(async()=>{
      if(!window.__shieldFilmRecorder||__shieldFilmRecorder.state!=='recording')return null;
      const b=await new Promise(resolve=>{__shieldFilmRecorder.onstop=()=>resolve(new Blob(__shieldFilmChunks,{type:__shieldFilmRecorder.mimeType}));__shieldFilmRecorder.stop();});
      const bytes=new Uint8Array(await b.arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);
    }).catch(()=>null);
    if(encoded)await fs.writeFile(active.path+'/partial-audio.webm',Buffer.from(encoded,'base64'));
  }
  await browser?.close().catch(()=>{});clearTimeout(watchdog);
  report.wallSeconds=(Date.now()-start)/1000;
  await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));
  await fs.writeFile('G:/sfx/saltblade-shield-delve-film.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({out,ok:report.ok,elapsed:report.elapsed,observed:report.observed,
    shieldNotObserved:report.shieldNotObserved,acceptance:report.acceptance,errors:report.errors},null,2));
  process.exitCode=report.ok?0:1;
}
