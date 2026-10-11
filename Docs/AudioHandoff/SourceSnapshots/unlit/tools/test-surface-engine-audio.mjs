import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync('src/scenes/planetScene.ts','utf8'),ast=ts.createSourceFile('planetScene.ts',source,ts.ScriptTarget.Latest,true);
let flight;
const visit=n=>{if(ts.isFunctionDeclaration(n)&&n.name?.text==='updateShipFlight')flight=n.getText(ast);ts.forEachChild(n,visit);};visit(ast);assert.ok(flight);
// Run the actual native flight update with rendering/terrain stubs, not a copied audio formula.
const code=ts.transpileModule(flight,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const frame=new Function('env','dt','t',`with(env){${code};return updateShipFlight(dt,t);}`);
const vector=()=>({copy(){return this;}});
const fixture=()=>{
 const keys=new Set(),pressed=new Set(),audio=[],plumes=[];
 const env={eng:{input:{down:k=>keys.has(k),justPressed:k=>pressed.has(k),steerX:0,steerY:0}},autoAscend:false,shipMode:'flight',shipThrottle:.5,shipSpeed:20,shipHeading:0,shipPitch:0,shipBank:0,shipPos:{x:0,y:100,z:0},liftT:0,settleT:0,settleTarget:null,
  cameraControlsBlocked:false,flightSurvey:false,flightDestination:0,flightDestinations:[{}],THREE:{MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},moveChartOnSphere(){},shipMinAlt:()=>3,EXIT_ALT:230,hazeK:0,H:()=>0,WATER_LEVEL:0,flightHint:null,
  flatGround:()=>true,siteClearOfObstacles:()=>true,findSettleSite:()=>null,beginSettle(){},shipSeatH:()=>0,SHIP_ALT:3,landingDustClock:0,melee:{dust(){}},W3:()=>({}),shipE:{},shipU:{},shipN:{},frameAt(){},chartToWorld(){},shipWorld:{},quatAt(){},
  shipRig:{group:{position:vector(),quaternion:{},rotateX(){},rotateZ(){}},plumes:[{update:(_dt,_t,burn,boost)=>plumes.push({burn,boost})}]},heroPos:{x:0,y:0,z:0,set(x,y,z){Object.assign(this,{x,y,z});}},sceneFog:{near:0,far:128},state:{ship:{engines:['eng_rebuilt']}},gameAudio:{setEngine:(ids,throttle,boost)=>audio.push({ids,throttle,boost})},doExitToSpace(){throw Error('Unexpected scene transition');}};
 env.finishSettle=()=>{env.shipMode='parked';};return {env,keys,pressed,audio,plumes};
};
const f=fixture(),check=()=>{assert.equal(f.audio.at(-1).throttle,f.plumes.at(-1).burn);assert.equal(f.audio.at(-1).boost,f.plumes.at(-1).boost);};
frame(f.env,.1,1);check();assert.equal(f.audio.at(-1).throttle,.5);
f.keys.add('KeyW');frame(f.env,.5,2);check();assert.ok(f.audio.at(-1).throttle>.8,'W changes actual engine audio');
f.keys.add('ShiftLeft');frame(f.env,.1,3);check();assert.equal(f.audio.at(-1).boost,true,'Shift opens the native boost layer');
f.keys.clear();f.pressed.add('KeyX');frame(f.env,.1,4);check();assert.equal(f.audio.at(-1).throttle,.25,'brake leaves native hover burn');assert.equal(f.audio.at(-1).boost,false);
f.pressed.clear();f.env.shipMode='settle';frame(f.env,.1,5);check();assert.equal(f.audio.at(-1).throttle,.35,'settling follows actual plume burn');
f.env.settleT=2;f.env.shipPos.y=3;frame(f.env,.1,6);assert.equal(f.env.shipMode,'parked');assert.deepEqual(f.audio.at(-1),{ids:[],throttle:0,boost:false},'touchdown clears the engine owner');
const lift=fixture();lift.env.shipMode='liftoff';frame(lift.env,.1,1);assert.equal(lift.audio.at(-1).throttle,lift.plumes.at(-1).burn);
console.log('PASS actual native atmospheric flight W/Shift/X, lift/descent plume parity and parked owner cleanup');
