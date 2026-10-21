import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deliver,windowTarget} from '../../Runtime/src/input.ts';
test('keyboard target survives the DOM shim dispatch into window bubble listeners',()=>{
 const target={matches:s=>s==='button',dispatchEvent(e){Object.defineProperty(e,'target',{value:undefined,configurable:true});}};
 let capture,bubble;const c=e=>capture=e.target,b=e=>bubble=e.target;
 windowTarget.addEventListener('keydown',c,true);windowTarget.addEventListener('keydown',b);
 deliver(target,{type:'keydown',bubbles:true});assert.equal(capture,target);assert.equal(bubble,target);assert.equal(bubble.matches('button'),true);
 windowTarget.removeEventListener('keydown',c,true);windowTarget.removeEventListener('keydown',b);
});

test('wheel bubble listeners retain the canvas target needed by strategic zoom',()=>{
 const target={tagName:'CANVAS',dispatchEvent(e){Object.defineProperty(e,'target',{value:undefined,configurable:true});}};
 let switched=false;const listener=e=>{if(e.target?.tagName==='CANVAS')switched=true;};
 windowTarget.addEventListener('wheel',listener);deliver(target,{type:'wheel',deltaY:200,bubbles:true});
 assert.equal(switched,true);windowTarget.removeEventListener('wheel',listener);
});
