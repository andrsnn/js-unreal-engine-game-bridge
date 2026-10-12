// Presentation adapter for the shared v1 effect event. No gameplay or damage rules.
export function createHardBurnVfxEvents(THREE,renderer,profiles){
 if(typeof renderer?.emit!=='function')throw new TypeError('Shared renderer.emit is required');
 const up=new THREE.Vector3(0,1,0);
 const vector=(value,fallback=[0,0,0])=>new THREE.Vector3().fromArray(Array.isArray(value)?value:value?.toArray?.()??fallback);
 const scalar=(value,fallback)=>Number.isFinite(value)?Math.max(0,value):fallback;
 return {emit(key,{position,direction,rearAxis,nozzle,velocity,size=1,width=0,length=0,unitsPerPixel=.01}={}){
  const p=profiles[key];if(!p)throw new Error('Unknown Hard Burn effect key: '+key);
  let axis;
  if(p.category==='plume'){
   if(nozzle){nozzle.updateWorldMatrix?.(true,false);if(!nozzle.matrixWorld)throw new Error('Plume nozzle needs a world transform');position=new THREE.Vector3().setFromMatrixPosition(nozzle.matrixWorld);axis=new THREE.Vector3().setFromMatrixColumn(nozzle.matrixWorld,2).negate();}
   else axis=vector(rearAxis??direction);
   if(axis.lengthSq()<1e-12)throw new Error('Plume requires the nozzle rear axis: '+key);
   // Niagara's +Z/Three +Y points toward the nozzle; its flame extends back.
   axis.normalize().negate();
  }else{axis=vector(direction,[0,1,0]);if(axis.lengthSq()<1e-12)axis.copy(up);else axis.normalize();}
  const rotation=new THREE.Quaternion().setFromUnitVectors(up,axis),pose=new THREE.Matrix4();
  const cm=100,units=scalar(unitsPerPixel,.01),physical=scalar(size,1);
  const burst=['impact','explosion','nuclear'].includes(p.category);
  const base=burst?(p.heavy?200:70):p.category==='venting'?30:1;
  const scale=burst?Math.max(physical*4*cm,units*p.widthPx*cm)/base:p.category==='venting'?Math.max(physical*cm,units*p.widthPx*cm)/base:1;
  const localVelocity=vector(velocity).applyQuaternion(rotation.clone().invert()).multiplyScalar(cm/Math.max(.00001,scale));
  const parameters={'User.VelocityLocalCm':localVelocity.toArray()};
  if(p.category==='weapon'||p.category==='plume'){
   parameters['User.WidthCm']=Math.max(scalar(width,0)*cm,units*p.widthPx*cm);
   parameters['User.LengthCm']=Math.max(scalar(length,0)*cm,units*p.lengthPx*cm);
  }
  // P*M*P^-1 maps web local Y to UE local Z. The shared bridge converts both
  // pose and spatial vector axes; vectors already carry explicit centimetres.
  pose.compose(vector(position),rotation,new THREE.Vector3(scale,scale,scale));
  renderer.emit('effect',key,parameters,pose);return {key,parameters,pose};
 }};
}
