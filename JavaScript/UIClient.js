// Presentation-only DOM mirror. Rules and event handlers remain in Puerts.
(function(){
 const attr='data-js-bridge-id';let patching=false,layoutPending=false;
 const send=packet=>window.ue?.jsgame?.sendinput(JSON.stringify(packet));
 const id=node=>node?.nodeType===1?node.getAttribute(attr):null;
 const selector=node=>id(node)?'['+attr+'="'+id(node)+'"]':node===document?'document':undefined;
 function sync(current,next){
  if(current.nodeType!==next.nodeType||current.nodeName!==next.nodeName){current.replaceWith(next.cloneNode(true));return;}
  if(current.nodeType!==1){if(current.nodeValue!==next.nodeValue)current.nodeValue=next.nodeValue;return;}
  for(const a of [...current.attributes])if(!next.hasAttribute(a.name))current.removeAttribute(a.name);
  for(const a of next.attributes)if(current.getAttribute(a.name)!==a.value)current.setAttribute(a.name,a.value);
  if(current!==document.activeElement&&'value' in current&&current.value!==next.value)current.value=next.value;
  if('checked' in current)current.checked=next.checked;
  const old=[...current.childNodes],keyed=new Map(old.filter(n=>id(n)).map(n=>[id(n),n]));let position=0;
  for(const child of [...next.childNodes]){
   let found=id(child)?keyed.get(id(child)):old[position];
   if(found&&found.parentNode!==current)found=null;
   if(found&&id(found)!==id(child))found=null;
   if(!found){found=child.cloneNode(true);current.insertBefore(found,current.childNodes[position]??null);}
   else{if(current.childNodes[position]!==found)current.insertBefore(found,current.childNodes[position]??null);sync(found,child);}
   position++;
  }
  while(current.childNodes.length>position)current.lastChild.remove();
 }
 function layout(){
  layoutPending=false;const rects={};
  for(const node of document.querySelectorAll('['+attr+']')){
   const r=node.getBoundingClientRect(),c=getComputedStyle(node);
   rects[id(node)]={x:r.x,y:r.y,left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,display:c.display,visibility:c.visibility,opacity:c.opacity,pointerEvents:c.pointerEvents,fontSize:c.fontSize};
  }
  send({type:'host-layout',width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio,rects});
 }
 function scheduleLayout(){if(!layoutPending){layoutPending=true;requestAnimationFrame(layout);}}
 window.JsGameUI={apply(html){
  const parsed=new DOMParser().parseFromString('<!doctype html><html><head></head>'+html+'</html>','text/html');
  parsed.querySelectorAll('script').forEach(node=>node.remove());
  for(const node of parsed.querySelectorAll('*'))for(const a of [...node.attributes])if(/^on/i.test(a.name))node.removeAttribute(a.name);
  patching=true;sync(document.body,parsed.body);patching=false;scheduleLayout();
 },sync};
 for(const type of ['click','dblclick','pointerdown','pointerup','pointermove','pointercancel','pointerenter','pointerleave','wheel','contextmenu','input','change','toggle','focusin','focusout'])document.addEventListener(type,event=>{
  if(patching)return;const target=event.target;
  if(!selector(target))return;
  send({type,selector:selector(target),button:event.button,buttons:event.buttons,clientX:event.clientX,clientY:event.clientY,deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode,shiftKey:event.shiftKey,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,pointerId:event.pointerId,pointerType:event.pointerType,value:target.value,checked:target.checked,open:target.open});
  if(type==='contextmenu'||type==='wheel'&&target.closest('canvas'))event.preventDefault();
 },true);
 for(const type of ['keydown','keyup'])window.addEventListener(type,event=>{
  send({type,...(selector(event.target)?{selector:selector(event.target)}:{target:'window'}),key:event.key,code:event.code,repeat:event.repeat,shiftKey:event.shiftKey,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey});
  if(!event.target.matches('input,select,textarea'))event.preventDefault();
 },true);
 window.addEventListener('resize',scheduleLayout);window.addEventListener('blur',()=>send({type:'blur',target:'window'}));
})();
