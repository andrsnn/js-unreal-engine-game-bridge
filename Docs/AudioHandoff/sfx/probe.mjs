import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json');
const {chromium}=require('playwright');
const game=process.argv[2],url=process.argv[3];
const out='G:/sfx/evidence/'+game;await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
let page;const errors=[];
try{const c=await b.newContext({viewport:{width:1280,height:720}});await c.addInitScript(()=>{Element.prototype.requestPointerLock=()=>Promise.resolve();Element.prototype.requestFullscreen=()=>Promise.resolve();document.exitPointerLock=()=>{};});page=await c.newPage();page.setDefaultTimeout(120000);page.on('pageerror',e=>{errors.push(e.stack);console.log('PAGEERROR',e.message);});await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});await page.waitForTimeout(15000);const state=await page.evaluate(()=>({buttons:[...document.querySelectorAll('button')].filter(b=>b.offsetWidth).map(b=>({text:b.textContent,id:b.id,attrs:[...b.attributes].filter(a=>a.name.startsWith('data-')).map(a=>[a.name,a.value])})),ff:window.__FF_READY,karvos:window.karvos?{ready:karvos.ready,mode:karvos.state.mode,started:karvos.state.started}:null,unlit:window.__game?{ready:__game.ready,scene:__game.sceneName}:null}));console.log(JSON.stringify(state));await fs.writeFile(out+'/probe.json',JSON.stringify({state,errors},null,2));await page.screenshot({path:out+'/probe.png'});
}finally{await b.close();}
