/** Original deterministic procedural voices, including offline ballistic fallback.
 * GameAudio overlays recorded firearm/Foley assets credited in public/audio/CREDITS.md. */
export type VoiceKind='humanHurt'|'humanDeath'|'rifle'|'smg'|'lmg'|'shotgun'|'sniper'|'bow'|'suppressed'|'pulse'|'arc'|'plasma'|'rail'|'rotary'|'missile'|'defense'|'explosion'|'shield'|'armor'|'body'|'stone'|'eject'|'insert'|'bolt'|'cell'|'nock'|'pickup'|'level'|'refit'|'charge'|'dive'|'worm'|'kick'|'pistol'|'swing'|'step'|'spit'|'dialogue'|'chest'|'read'|'enemyHurt'|'enemyDeath'|'bossDeath'|'creatureIdle'|'creatureAlert'|'creatureCombat'|'creatureAttack'|'sentinelCall'|'arrival'|'stepSand'|'stepStone'|'stepSnow'|'swim'
 // ---- sound pass: the beats that had no voice ----
 |'warnNest'|'warnFoundry'|'warnSettlement'|'contactHorn'
 |'launchThump'|'missileCrump'|'whoosh'|'missileAlert'
 |'clothWhip'|'landThud'|'dodgeChime'
 |'objectiveDone'|'provokeAlarm'
 |'bossRoar'|'captainShout'|'chargeRumble'|'deathCrash'
 |'weldCrackle'|'radioBlip'|'stepDeck'
 |'uiTick'|'uiConfirm'|'uiPurchase'|'uiReveal'|'uiCapture'
 |'lampClick'|'shellRack'|'spinUp'
 |'gunCrack'|'gunTail'|'gunMechanism'|'fleshImpact'|'fleshDeath'|'metalImpact'|'metalDeath';
export interface AudioWeapon {id?:string;basePartId?:string;archetype?:string;fireRate?:number;damage?:number;manufacturer?:string;weaponFamily?:string;tuning?:{components?:{barrel?:string;core?:string;feed?:string}}}
export function weaponVoice(item:AudioWeapon,space:boolean):VoiceKind|'beam'{
 const key=(item.basePartId??item.archetype??item.id??'rifle').toLowerCase();
 if(item.tuning?.components?.barrel==='suppressor')return 'suppressed';
 if(/bow/.test(key))return 'bow';
 if(/beam/.test(key))return 'beam';
 if(/lance|raildriver|\brail\b/.test(key))return 'rail';
 if(/plasma/.test(key))return 'plasma';
 if(/arc/.test(key))return 'arc';
 if(/scatter|shotgun/.test(key))return 'shotgun';
 if(/rotary/.test(key))return 'rotary';
 if(/lmg|beltfed|squad auto/.test(key))return 'lmg';
 if(/smg|pdw/.test(key))return 'smg';
 if(/hand cannon|pepperbox|pistol|sidearm|revolver/.test(key))return 'pistol';
 if(/marksman|sniper|longshot|anti-materiel/.test(key))return 'sniper';
 if(/pulse/.test(key)||space)return 'pulse';
 return 'rifle';
}
const lengths:Record<VoiceKind,number>={humanHurt:.28,humanDeath:.65,rifle:.34,smg:.22,lmg:.35,shotgun:.62,sniper:.8,bow:.42,suppressed:.2,pulse:.3,arc:.42,plasma:.78,rail:.85,rotary:.3,missile:.65,defense:.2,explosion:1.65,shield:.4,armor:.31,body:.17,stone:.26,eject:.2,insert:.2,bolt:.2,cell:.3,nock:.19,pickup:.48,level:1.6,refit:.25,charge:.32,dive:.8,worm:1.5,kick:.25,pistol:.3,swing:.3,step:.19,spit:.4,dialogue:.045,chest:.65,read:.24,enemyHurt:.32,enemyDeath:.75,bossDeath:2.4,creatureIdle:1.1,creatureAlert:.9,creatureCombat:1.2,creatureAttack:.6,sentinelCall:.85,arrival:2.1,stepSand:.3,stepStone:.27,stepSnow:.35,swim:.6,
 warnNest:2.6,warnFoundry:2.6,warnSettlement:2.6,contactHorn:1.9,
 launchThump:.34,missileCrump:1.5,whoosh:.55,missileAlert:.8,
 clothWhip:.34,landThud:.42,dodgeChime:.5,
 objectiveDone:1.5,provokeAlarm:1.7,
 bossRoar:2.2,captainShout:.9,chargeRumble:1.4,deathCrash:2.6,
 weldCrackle:.95,radioBlip:.46,stepDeck:.26,
 uiTick:.07,uiConfirm:.3,uiPurchase:.85,uiReveal:.95,uiCapture:.13,
 lampClick:.13,shellRack:.34,spinUp:.5,
 gunCrack:.12,gunTail:.62,gunMechanism:.18,fleshImpact:.24,fleshDeath:.92,metalImpact:.32,metalDeath:1.15};
export function synthVoice(kind:VoiceKind,variant:number,rate:number):Float32Array {
 const out=new Float32Array(Math.ceil(lengths[kind]*rate));let seed=(0x7d431+variant*7193+Object.keys(lengths).indexOf(kind)*13487)>>>0;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1};
 // A damped resonator supplies weight; short filtered noise supplies a crack and
 // room/metal tail. Frequency variation is small enough to preserve identity.
 const detune=1+rand()*.035;
 const noise=(at:number,life:number,gain:number,cutoff:number,decay:number,high=false,attack=.0008)=>{
  let low=0;const alpha=1-Math.exp(-2*Math.PI*cutoff/rate),start=Math.round(at*rate);
  for(let i=0;i<life*rate&&start+i<out.length;i++){const t=i/rate,n=rand();low+=alpha*(n-low);const v=high?n-low:low;out[start+i]+=v*gain*Math.min(1,t/attack)*Math.exp(-t/decay)*Math.min(1,(life-t)/.012);}
 };
 const body=(at:number,life:number,gain:number,hz:number,end:number,decay:number,metal=0)=>{
  const start=Math.round(at*rate);let phase=0;
  for(let i=0;i<life*rate&&start+i<out.length;i++){const t=i/rate;phase+=2*Math.PI*(end+(hz-end)*Math.exp(-t/.028))*detune/rate;out[start+i]+=(Math.sin(phase)+metal*Math.sin(phase*2.73))*gain*Math.min(1,t/.0015)*Math.exp(-t/decay)*Math.min(1,(life-t)/.012);}
 };
 const click=(at:number,gain:number,hz=3100)=>{noise(at,.055,gain,hz,.011);body(at,.045,gain*.25,520,290,.012,.3)};
 const ballistic=(weight:number,crack:number,tail:number)=>{noise(0,.08,crack,6100,.014);noise(.008,tail,.32,1600,tail*.28);body(0,.24,weight,150,52,.065,.12);click(.066,.17);};
 switch(kind){
  case 'creatureIdle':noise(0,1.05,.26,650,.48,false,.18);body(.08,.8,.16,93,68,.32,.28);break;
  case 'creatureAlert':body(0,.65,.35,160,105,.27,.55);noise(.035,.7,.4,1300,.28,false,.09);body(.36,.4,.19,190,145,.16,.3);break;
  case 'creatureCombat':noise(0,1.1,.48,980,.35,false,.06);body(0,.9,.4,135,64,.34,.5);noise(.28,.5,.26,2200,.16);break;
  case 'creatureAttack':noise(0,.5,.5,1500,.13,false,.025);body(0,.45,.3,150,83,.16,.45);break;
  case 'sentinelCall':for(let j=0;j<3;j++){noise(j*.18,.23,.22,1800,.07);body(j*.18,.2,.15,220+j*75,180+j*55,.08,.22);}break;
  case 'arrival':noise(0,2,.55,450,.75,false,.25);body(.15,1.6,.4,72,38,.6,.2);for(let j=0;j<5;j++)click(.4+j*.25,.2,1000);break;
  case 'chest':click(0,.55,1600);noise(.055,.35,.3,700,.19,false,.02);click(.23,.38,1000);body(.27,.35,.15,440,440,.12);break;
  case 'read':click(0,.16,1900);body(.025,.19,.12,520,520,.055);body(.07,.15,.08,780,780,.045);break;
  case 'humanHurt':noise(0,.25,.36,1600,.085,false,.015);break;
  case 'humanDeath':noise(0,.58,.38,1200,.22,false,.018);click(.25,.14,900);break;
  case 'enemyHurt':noise(0,.29,.55,950,.095,false,.012);body(0,.26,.22,105,92,.075,.35);noise(.035,.12,.23,2500,.03);break;
  case 'enemyDeath':noise(0,.7,.6,750,.22,false,.018);body(0,.6,.3,110,55,.2,.45);noise(.13,.45,.2,1600,.15);break;
  case 'bossDeath':noise(0,.24,.7,2200,.06);body(0,1.4,.8,86,32,.4,.2);noise(.1,2.2,.7,450,.7,false,.09);for(let j=0;j<6;j++)click(.3+j*.2,.25/(1+j*.2),1300);break;
  case 'dialogue':body(0,.045,.2,640,490,.012,.08);break;
  case 'rifle':ballistic(.66,.95,.3);break;
  case 'pistol':ballistic(.72,.85,.22);body(.01,.15,.2,240,85,.035);break;
  case 'swing':noise(0,.29,.7,2300,.13,false,.065);noise(.08,.12,.18,5200,.045);break;
  case 'stepSand':case 'stepStone':case 'stepSnow':case 'swim':case 'step':body(0,.12,.25,95,55,.024);noise(0,.18,.28,1200,.042);break;
  case 'spit':noise(0,.14,.5,850,.038);body(0,.3,.33,260,74,.06,.6);noise(.05,.3,.2,2900,.08);break;
  case 'smg':ballistic(.35,.78,.18);body(.024,.1,.15,210,170,.035);break;
  case 'lmg':ballistic(.75,.9,.29);click(.083,.26,2200);break;
  case 'rotary':ballistic(.68,.8,.23);body(0,.13,.28,210,75,.04,.35);break;
  case 'shotgun':ballistic(.95,1.1,.55);noise(.03,.25,.45,3100,.07);noise(.14,.35,.16,1600,.14);break;
  case 'sniper':ballistic(.92,1.25,.7);noise(.02,.55,.32,2300,.17);body(.024,.4,.3,82,42,.11);break;
  case 'suppressed':noise(0,.065,.26,1550,.018);body(0,.13,.62,170,86,.032);click(.055,.2);break;
  case 'bow':body(0,.24,.28,205,170,.063,.38);noise(.008,.17,.18,3400,.055);click(.018,.17,1600);noise(.07,.27,.095,5000,.085);break;
  case 'pulse':body(0,.21,.6,420,170,.044,.28);noise(0,.065,.6,4800,.014);body(.012,.27,.34,98,72,.075);noise(.035,.22,.15,1700,.08);break;
  case 'arc':noise(0,.095,.58,4300,.024);body(0,.25,.43,215,135,.075,.5);for(let j=0;j<5;j++)noise(.035+j*.033,.026,.18-j*.022,3500,.01,true);noise(.055,.32,.2,800,.12);break;
  case 'plasma':body(0,.55,.75,125,42,.16,.14);noise(.015,.55,.55,650,.16);noise(.015,.13,.35,2700,.035);body(.04,.4,.17,270,95,.085,.3);break;
  case 'rail':noise(0,.11,1.2,6200,.018);body(0,.45,.95,180,43,.105,.2);body(.005,.18,.24,1580,880,.029,.3);noise(.035,.7,.4,1350,.19);click(.08,.2);break;
  case 'defense':noise(0,.055,.7,4800,.01);body(0,.13,.5,350,160,.029,.2);noise(.025,.16,.13,2200,.045);break;
  case 'missile':click(0,.6,1300);body(0,.25,.55,105,48,.075);noise(.035,.6,.75,1800,.24,false,.028);break;
  case 'explosion':noise(0,.24,.85,2100,.065);body(0,.7,.9,85,29,.24);noise(.04,1.5,.85,320,.47,false,.014);noise(.17,1.1,.25,1700,.32);for(let j=0;j<4;j++)click(.12+j*.08,.13/(j+1),1400);break;
  case 'shield':noise(0,.12,.32,3200,.032);body(0,.3,.36,310,155,.07,.36);body(.015,.32,.17,750,560,.07);break;
  case 'armor':noise(0,.075,.72,4200,.015);body(0,.12,.17,230,230,.018,.15);noise(.018,.16,.25,1700,.04);break;
  case 'stone':noise(0,.07,.7,3000,.014);noise(.012,.15,.32,950,.035);break;
  case 'body':noise(0,.075,.55,900,.019);body(0,.09,.25,82,82,.014);break;
  // These layers sit around the licensed/recorded voices. They stay short and
  // spectrally separate so a firearm gains scale without becoming two shots.
  case 'gunCrack':noise(0,.055,.9,7600,.009,true);noise(.006,.08,.28,3400,.022);break;
  case 'gunTail':noise(0,.6,.34,1250,.19,false,.008);body(.015,.42,.16,92,48,.14,.08);break;
  case 'gunMechanism':click(0,.48,2900);body(.018,.12,.2,330,190,.035,.5);click(.075,.24,1800);break;
  case 'fleshImpact':noise(0,.12,.48,720,.032);body(0,.16,.34,74,48,.042,.08);noise(.035,.18,.16,1450,.07);break;
  case 'fleshDeath':noise(0,.78,.46,620,.25,false,.018);body(.015,.7,.42,91,39,.22,.12);noise(.22,.62,.2,1100,.2);break;
  case 'metalImpact':noise(0,.075,.65,5200,.012,true);body(0,.24,.38,410,170,.055,.85);click(.055,.35,2400);break;
  case 'metalDeath':noise(0,.18,.68,4200,.042);body(0,.75,.62,115,42,.24,.65);for(let j=0;j<5;j++)click(.12+j*.13,.28/(1+j*.18),2300-j*220);noise(.24,.85,.2,980,.28);break;
  case 'eject':click(0,.3,2400);click(.046,.4,1700);noise(.015,.16,.1,1800,.075);break;
  case 'insert':noise(0,.1,.16,1800,.05);click(.048,.68,1400);body(.05,.1,.25,180,150,.024);break;
  case 'bolt':click(0,.4,3200);noise(.02,.06,.3,3100,.02);click(.083,.65,2200);break;
  case 'cell':click(0,.3,2500);body(.018,.22,.25,330,470,.08,.16);noise(.04,.24,.18,2300,.08);break;
  case 'nock':noise(0,.14,.2,2300,.045);click(.056,.25,1600);body(.04,.1,.1,280,260,.035);break;
  case 'level':
  case 'pickup':body(0,.35,.22,523,523,.12,.07);body(.08,.35,.17,784,784,.13,.07);break;
  case 'refit':click(0,.48,1900);body(.036,.18,.16,280,280,.04,.3);click(.09,.19);break;
  case 'charge':noise(0,.3,.26,1900,.2,false,.06);body(.02,.27,.14,240,360,.14,.1);break;
  case 'dive':noise(0,.8,.65,400,.27,false,.03);body(0,.3,.16,140,50,.08);break;
  case 'worm':noise(0,1.5,.8,240,.6,false,.07);body(.025,1.4,.65,55,26,.48,.22);break;
  case 'kick':body(0,.23,.65,115,40,.06);noise(0,.035,.12,1400,.009);break;
  // ---- arrival warnings: one family-readable swell, ~2.6s so a 3s lead lands before the wave ----
  case 'warnNest':{
   noise(0,2.55,.5,1100,2.2,false,1.5);body(.1,2.4,.3,52,128,2,.12);
   for(let j=0;j<30;j++){const k=j/30,at=k*k*2.4;
    noise(at,.05,.1+k*.55,2400+k*2600,.014,true);body(at,.045,.05+k*.3,340+k*680,300+k*560,.016,.55);}
   break;}
  case 'warnFoundry':{
   for(let j=0;j<3;j++){const at=j*.85,g=.3+j*.12;
    body(at,.5,g,392,392,.4,.3);body(at+.01,.5,g*.5,784,784,.36,.2);
    body(at+.42,.42,g*.85,311,311,.32,.3);body(at+.43,.42,g*.45,622,622,.3,.2);}
   for(let j=0;j<12;j++){const at=.35+j*.19,k=j/12;body(at,.12,.12+k*.3,72,46,.05);noise(at,.11,.1+k*.26,760,.032);}
   break;}
  case 'warnSettlement':{
   body(0,1.6,.45,110,110,1.2,.28);body(.01,1.6,.3,220,220,1.1,.2);body(.02,1.5,.16,55,55,1.1,.1);
   body(1,1.5,.4,146,146,1.1,.28);body(1.01,1.5,.26,292,292,1,.2);
   noise(.45,2.1,.3,380,1.6,false,.8);for(let j=0;j<16;j++)noise(.5+j*.13,.09,.09,240,.03);
   break;}
  case 'contactHorn':
   body(0,1,.5,98,98,.7,.35);body(.01,1,.3,196,196,.66,.22);
   body(.85,1,.5,131,131,.75,.35);body(.86,1,.3,262,262,.7,.22);
   noise(0,1.85,.12,700,1.2,false,.3);break;
  // ---- ordnance ----
  case 'launchThump':body(0,.3,.85,180,58,.05);noise(0,.06,.5,3200,.012);noise(.02,.3,.3,1200,.09);break;
  case 'missileCrump':
   noise(0,.2,.7,2600,.045);body(0,.9,1,72,26,.3);noise(.03,1.4,.8,260,.42,false,.012);
   noise(.2,1.2,.22,1200,.36);for(let j=0;j<5;j++)click(.15+j*.11,.12/(j+1),1200);break;
  case 'whoosh':noise(0,.5,.8,900,.16,false,.09);noise(.04,.42,.45,3400,.12,true,.07);body(.02,.34,.14,420,120,.11);break;
  case 'missileAlert':for(let j=0;j<2;j++){const at=j*.4;body(at,.3,.5,740,740,.14,.15);body(at+.14,.3,.5,988,988,.14,.15);}break;
  // ---- combat roll ----
  case 'clothWhip':noise(0,.3,.75,1400,.08,false,.035);noise(.03,.2,.5,4800,.05,true,.02);noise(.1,.2,.2,700,.06);break;
  case 'landThud':body(0,.3,.8,120,44,.06);noise(0,.14,.45,900,.03);noise(.02,.34,.24,1800,.09);break;
  case 'dodgeChime':body(0,.45,.4,1319,1319,.18,.03);body(.055,.42,.32,1760,1760,.16,.03);noise(0,.05,.12,6000,.012,true);break;
  // ---- held objectives ----
  case 'objectiveDone':{
   [523.25,659.25,783.99,1046.5].forEach((f,j)=>body(j*.11,1.4-j*.1,.4/(1+j*.25),f,f,.5,.06));
   noise(0,.08,.2,5200,.02,true);noise(.3,1.1,.1,2400,.4,false,.1);break;}
  case 'provokeAlarm':{
   for(let j=0;j<3;j++){const at=j*.55;body(at,.5,.5,660,330,.3,.3);body(at+.01,.5,.28,330,165,.3,.2);}
   noise(0,1.65,.16,600,1.1,false,.4);break;}
  // ---- guardian and captain ----
  case 'bossRoar':noise(0,2.1,.7,520,.85,false,.12);body(0,1.9,.75,62,96,.8,.4);body(.06,1.8,.35,124,186,.7,.5);noise(.5,1.5,.3,1700,.5);break;
  case 'captainShout':noise(0,.75,.6,1500,.22,false,.02);body(0,.6,.3,150,210,.16,.5);body(.16,.5,.2,190,140,.14,.4);break;
  case 'chargeRumble':
   noise(0,1.35,.5,240,.7,false,.28);body(0,1.3,.85,38,54,.75,.1);body(.05,1.2,.3,76,112,.6,.2);
   for(let j=0;j<8;j++)body(.1+j*.14,.1,.12,90,58,.04);break;
  case 'deathCrash':
   noise(0,.28,.8,2400,.07);body(0,1.6,.95,74,27,.42);noise(.05,2.3,.75,340,.75,false,.015);
   for(let j=0;j<9;j++)click(.25+j*.17,.24/(1+j*.35),1100+j*140);noise(.6,1.6,.2,1500,.5);break;
  // ---- base deck ----
  case 'weldCrackle':{
   noise(0,.9,.2,3000,.55,false,.06);
   for(let j=0;j<22;j++)noise((j*.0413)%.86,.02,.4,6500,.006,true);
   body(.05,.7,.08,120,120,.4,.6);break;}
  case 'radioBlip':noise(0,.42,.35,2600,.16,false,.008);body(.03,.12,.35,1200,1200,.05,.1);body(.17,.12,.3,900,900,.05,.1);noise(.3,.12,.2,4200,.05,true);break;
  case 'stepDeck':click(0,.55,2600);body(0,.24,.4,240,180,.05,.7);body(.004,.2,.18,620,560,.07,.5);noise(.01,.16,.18,1500,.04);break;
  // ---- interface ----
  case 'uiTick':click(0,.5,4200);break;
  case 'uiConfirm':body(0,.18,.45,587,587,.07,.05);body(.07,.22,.4,880,880,.09,.05);click(0,.15,3800);break;
  case 'uiPurchase':
   [523.25,783.99,1046.5].forEach((f,j)=>body(j*.075,.75-j*.06,.42/(1+j*.2),f,f,.28,.05));
   noise(0,.06,.14,5600,.015,true);noise(.2,.6,.08,3000,.22,false,.08);break;
  case 'uiReveal':{
   noise(0,.9,.3,2800,.45,false,.22);
   for(let j=0;j<6;j++){const f=659.25*2**(j*2/12);body(j*.1,.5,.22/(1+j*.18),f,f,.2,.04);}break;}
  case 'uiCapture':click(0,.6,5200);body(0,.09,.2,1500,1100,.03,.2);break;
  // ---- flashlight + weapon foley ----
  // A small two-stage tactile switch: a hard tick, a short damped body, a softer settle click.
  case 'lampClick':click(0,.55,3600);body(.018,.08,.2,780,620,.028,.25);click(.052,.32,2500);break;
  // Pump-action rack: a slide back, a shell seat, a slide forward that chambers with a clack.
  case 'shellRack':click(0,.5,2000);noise(.02,.1,.22,1400,.05);body(.05,.09,.3,150,120,.03);click(.16,.6,2600);body(.165,.08,.22,210,170,.028,.4);break;
  // Rotary spin-up: a rising whirr as the barrel cluster comes up to speed.
  case 'spinUp':{for(let j=0;j<7;j++){const k=j/7;body(k*.42,.12,.06+k*.12,120+k*360,110+k*300,.05);}noise(0,.5,.14,900,.32,false,.12);break;}
 }
 let peak=0,mean=0;for(const x of out){peak=Math.max(peak,Math.abs(x));mean+=x;}mean/=out.length;
 const scale=.88/Math.max(1,peak);for(let i=0;i<out.length;i++)out[i]=(out[i]-mean)*scale*Math.min(1,i/(rate*.0005),(out.length-1-i)/(rate*.009));
 return out;
}
