import {createThreeUnrealRenderer} from './ThreeUnrealRenderer.mjs';
// Project services provide DOM/UI, assets, audio, input and storage. This layer
// only connects the shared Three backend and presentation controls to the host.
export function createUnrealPlatform(THREE, host, services, options={}) {
 for(const name of ['audio','input','ui','saves','assets'])if(!services?.[name])throw Error('Missing Unreal platform service: '+name);
 const rendererService={
  createRenderer(){return createThreeUnrealRenderer(THREE,host,{canvas:services.ui.document?.getElementById('gl'),...options});},
  createComposer(renderer,scene,camera,{strength=.62,radius=.4,threshold=.85}={}){
   const bloom={uniforms:{strength:{value:strength},radius:{value:radius},threshold:{value:threshold},flash:{value:0},ordnanceGlow:{value:0},heat:{value:new THREE.Vector4()}}};
   for(const key of ['strength','radius','threshold'])Object.defineProperty(bloom,key,{get:()=>bloom.uniforms[key].value,set:value=>bloom.uniforms[key].value=value});
   const focusPass={enabled:false,uniforms:{nearClip:{value:camera.near},farClip:{value:camera.far},focus:{value:200},blurPixels:{value:0}}};
   const composer={renderTarget1:new THREE.WebGLRenderTarget(1,1),renderTarget2:new THREE.WebGLRenderTarget(1,1),_pixelRatio:1,passes:[],worldScale:1,enhancement:'off',
    setSize(width,height){this.renderTarget1.setSize(width,height);this.renderTarget2.setSize(width,height);},
    setPixelRatio(ratio){this._pixelRatio=ratio;},getPixelRatio(){return this._pixelRatio;},
    setEnhancement(mode){this.enhancement=mode;this.worldScale=1;host.SetPresentation?.(JSON.stringify({enhancement:mode}));return this.worldScale;},
    render(){host.SetPresentation?.(JSON.stringify({bloom:{strength:bloom.strength,radius:bloom.radius,threshold:bloom.threshold,flash:bloom.uniforms.flash.value,ordnanceGlow:bloom.uniforms.ordnanceGlow.value,heat:bloom.uniforms.heat.value.toArray()},focus:{enabled:focusPass.enabled,distance:focusPass.uniforms.focus.value,blurPixels:focusPass.uniforms.blurPixels.value}}));renderer.render(scene,camera);},
    dispose(){this.renderTarget1.dispose();this.renderTarget2.dispose();}
   };return {composer,bloom,focusPass};
  }
 };
 return {target:'unreal',...services,renderer:rendererService};
}
