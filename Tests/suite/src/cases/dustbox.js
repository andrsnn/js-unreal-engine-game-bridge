// A ray-marched dust volume in a back-faced box (Hard Burn's planetaryLightVolume, dust mode), additive, with a
// density texture: the box's own local space carries the march, and the camera's position in it is a uniform.
export default function dustbox({THREE, scene, camera}) {
  const size = 256, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = 0.5 + 0.25 * Math.sin(x * 0.11) * Math.cos(y * 0.07) + 0.25 * Math.sin((x + y) * 0.031), i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(255 * Math.max(0, Math.min(1, v))); data[i + 3] = 255;
  }
  const nebulaDensity = new THREE.DataTexture(data, size, size); nebulaDensity.wrapS = nebulaDensity.wrapT = THREE.RepeatWrapping; nebulaDensity.needsUpdate = true;
  camera.position.set(0, 3, 30); camera.lookAt(0, 0, 0);
  const planetaryLightVolume = function(radius,color,stellar=false) {
    const material=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.BackSide,
      blending:THREE.AdditiveBlending,toneMapped:false,fog:false,
      uniforms:{densityMap:{value:nebulaDensity},dustOnly:{value:0},eye:{value:new THREE.Vector3()},tint:{value:new THREE.Color(color).multiplyScalar(3.4)},stellar:{value:stellar?1:0},coronal:{value:0},flowTime:{value:0}},
      vertexShader:`varying vec3 surface;void main(){surface=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader:`varying vec3 surface;uniform sampler2D densityMap;uniform vec3 eye;uniform vec3 tint;uniform float stellar,coronal,flowTime,dustOnly;
        float solarHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
        float solarNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
          return mix(mix(mix(solarHash(i),solarHash(i+vec3(1,0,0)),f.x),mix(solarHash(i+vec3(0,1,0)),solarHash(i+vec3(1,1,0)),f.x),f.y),
            mix(mix(solarHash(i+vec3(0,0,1)),solarHash(i+vec3(1,0,1)),f.x),mix(solarHash(i+vec3(0,1,1)),solarHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
        void main(){vec3 ray=normalize(surface-eye);
          if(stellar>.5){
            float start,end;
            if(dustOnly>.5){
              vec3 lo=(-vec3(1.)-eye)/ray,hi=(vec3(1.)-eye)/ray;
              vec3 entry=min(lo,hi),exit=max(lo,hi);
              start=max(0.,max(entry.x,max(entry.y,entry.z)));end=min(exit.x,min(exit.y,exit.z));
              if(end<=start)discard;
            }else{
              float b=dot(eye,ray),d=b*b-dot(eye,eye)+1.;if(d<=0.)discard;
              float root=sqrt(d);start=max(0.,-b-root);end=-b+root;
            }
            float stepSize=(end-start)/24.;
            vec3 light=vec3(0.);float alpha=0.;
            for(int i=0;i<24;i++){
              vec3 p=eye+ray*(start+(float(i)+.5)*stepSize);float r=length(p);
              vec3 drift=vec3(flowTime*.025,-flowTime*.018,flowTime*.012);
              float dust=solarNoise(p*5.+drift)*.7+solarNoise(p*11.-drift)*.3;
              float envelope=pow(max(0.,1.-r),1.5)*smoothstep(.10,.18,r);
              float billow=solarNoise(p*7.+drift+vec3(dust*.6));
              float density=envelope*(.25+billow*.85)*(.55+dust);
              if(coronal>.5){
                vec3 angular=normalize(p)*7.+drift*.3;
                float stream=pow(smoothstep(.32,.62,solarNoise(angular)),2.);
                float turbulent=solarNoise(p*19.+drift)*.4+.6;
                density=exp(-r*2.8)*smoothstep(.05,.10,r)*(1.-smoothstep(.6,1.,r))*stream*turbulent*1.2;
              }
              if(dustOnly>.5){
                vec3 warp=vec3(solarNoise(p*3.+7.2),solarNoise(p*3.-4.1),solarNoise(p*3.+11.4))*.10;
                vec3 q=p*.55+warp+vec3(.5);
                float grain=texture2D(densityMap,q.xy).r*.55+texture2D(densityMap,q.zy+.13).r*.30+texture2D(densityMap,q.xz-.19).r*.15;
                float clump=solarNoise(p*3.+warp*2.);
                vec3 edge=vec3(1.)-smoothstep(vec3(.65),vec3(1.),abs(p));
                density=edge.x*edge.y*edge.z*smoothstep(.06,.50,grain)*(.25+clump*.75)*1.8;
              }
              float absorb=1.-exp(-density*stepSize*1.5);
              vec3 scatter=tint*(.75+dust*.25);
              light+=(1.-alpha)*absorb*scatter;alpha+=(1.-alpha)*absorb;
            }
            gl_FragColor=vec4(light/max(alpha,.001),alpha*.65);return;
          }
          float t=max(0.,-dot(eye,ray));
          vec3 nearest=eye+ray*t;float chord=max(0.,1.-dot(nearest,nearest));
          float grain=solarNoise(nearest*9.+vec3(flowTime*.012,0.,0.));
          float density=pow(chord,3.)*mix(.45,1.35,grain);
          float peripheral=pow(chord,1.6)*.022;
          gl_FragColor=vec4(tint,density*.14+peripheral);}`});
    const volume=new THREE.Mesh(new THREE.SphereGeometry(1,32,24),material);
    volume.scale.setScalar(radius*(stellar?2.3:3.2));
    volume.userData.tick=(dt,time,cam)=>{material.uniforms.eye.value.copy(volume.worldToLocal(cam.position.clone()));material.uniforms.flowTime.value=time;};
    return volume;
  };
  const box = planetaryLightVolume(1, 0x9fb2b9, true);
  box.geometry.dispose(); box.geometry = new THREE.BoxGeometry(2, 2, 2);
  box.position.set(0, 0, -10); box.scale.set(26, 10, 10);
  box.material.uniforms.tint.value.multiplyScalar(.3); box.material.uniforms.dustOnly.value = 1;
  scene.add(box);
  return (dt, time) => { box.userData.tick(dt, time, camera); };
}
