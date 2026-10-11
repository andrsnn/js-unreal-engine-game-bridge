import {createRequire} from 'node:module';
import {foreignBrowserOwners as foreignBrowsers} from './deadline-slot.mjs';
const require=createRequire('C:/Users/Aidan Anderson/karvos/package.json'),{chromium}=require('playwright');
const initialOwners=foreignBrowsers();if(initialOwners.length)throw Error('Browser slot busy: '+JSON.stringify(initialOwners));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=d3d11','--ignore-gpu-blocklist','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
globalThis.__audioDeadlineBrowser=browser;
const deadline=setTimeout(async()=>{console.log('Bounded batch timeout');await browser.close().catch(()=>{});process.exit(1)},720000);
try{const owners=foreignBrowsers();if(owners.length)throw Error('Browser handoff raced; closing owned browser: '+JSON.stringify(owners));for(const game of ['unlit']){process.argv=[process.execPath,'G:/sfx/deadline-play.mjs',game,...(game==='saltblade'?['--url=http://127.0.0.1:5191/?test=1']:[])];await import('file:///G:/sfx/deadline-unlit-smoke.mjs');if(process.exitCode)break;}}
finally{const end=setTimeout(()=>process.exit(process.exitCode||0),15000);await browser.close();clearTimeout(end);clearTimeout(deadline);}
if(!process.exitCode)await import('file:///G:/sfx/deadline-desktop-audio-check.mjs');
