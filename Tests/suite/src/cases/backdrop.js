// A huge back-faced sky sphere that ray-marches a 3D noise volume from the camera (Hard Burn's nebula backdrop,
// volume mode), seen from far off its centre, as in the game's fleet view.
export default function backdrop({THREE, scene, camera}) {
  let cached = null, nebulaDensity;
  function volumeNoiseTexture() {
    if (cached) return cached;
    const size=128,data=new Uint8Array(size**3);
    for(let z=0,index=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++,index++){
      const value=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;
      data[index]=Math.round((value-Math.floor(value))*255);
    }
    cached=new THREE.Data3DTexture(data,size,size,size);
    cached.format=THREE.RedFormat;
    cached.type=THREE.UnsignedByteType;
    cached.minFilter=cached.magFilter=THREE.LinearFilter;
    cached.wrapS=cached.wrapT=cached.wrapR=THREE.RepeatWrapping;
    cached.unpackAlignment=1;
    cached.needsUpdate=true;
    return cached;
  }
  const hazeNoiseTexture = () => null;
  function spaceBackdrop(mode = 'teal') {
    const brown = mode === 'brown';
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, toneMapped: false,
      uniforms: {
        densityStrength: {value: mode === 'combat' ? .55 : .48},
        strataWidth:{value:1000},
        noiseVolume:{value:volumeNoiseTexture()},
        volumeMode:{value:0},detailDensity:{value:nebulaDensity??hazeNoiseTexture()},hasDetail:{value:nebulaDensity?1:0},cameraWorld:{value:new THREE.Vector3()},
        low: { value: new THREE.Color(brown ? 0x28271f : mode === 'combat' ? 0x0e1d2b : 0x071923) },
        high: { value: new THREE.Color(brown ? 0x98836a : mode === 'combat' ? 0x284153 : 0x2c5261) },
      },
      vertexShader: `varying vec3 direction,volumeSurface; void main() {
        volumeSurface=(modelMatrix*vec4(position,1.)).xyz;direction = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
      fragmentShader: `uniform sampler2D detailDensity; uniform float hasDetail; uniform float densityStrength,strataWidth; uniform vec3 low; uniform vec3 high; uniform vec3 cameraWorld; uniform float volumeMode;varying vec3 direction,volumeSurface;
        uniform highp sampler3D noiseVolume;
        float n(vec3 p) { vec3 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
          return texture(noiseVolume,(i+f+.5)/128.).r; }
        float fbm(vec3 p) { float a=.5,s=0.; for(int i=0;i<4;i++){s+=a*n(p);p=p*2.03+vec3(7.1,3.4,11.7);a*=.5;} return s; }
        void main() {
          if(volumeMode>.5){
            vec3 ray=normalize(volumeSurface-cameraWorld),color=vec3(0.);float transmittance=1.;
            for(int i=0;i<8;i++){
              float depth=240.+float(i)*480.+float(i*i)*40.;vec3 point=cameraWorld+ray*depth;
              vec3 warp=vec3(n(point*.0021+3.7),n(point*.0021+11.2),n(point*.0021-7.4));
              float broad=fbm(point*.0015+warp*1.3+vec3(8.1,2.3,4.4));
              vec3 fold=point*vec3(.0018,.008,.003)+warp*2.;
              float folded=fbm(fold+vec3(broad*1.8,0.,broad*1.4));
              float ridge=smoothstep(.34,.70,n(fold*vec3(.35,3.,.7)+warp*.7));
              float lace=n(fold*5.1+warp*2.);
              float fine=texture2D(detailDensity,(point.xz+point.y*.18)*.00018+warp.xz*.055+vec2(.31,.17)*float(i)).r;
              float strata=exp(-pow((point.y+160.)/strataWidth,2.));
              float density=pow(fine,2.3)*(.30+folded*.85)*strata;
              density*=.55+ridge*.55+pow(lace,3.)*.65;float absorb=1.-exp(-density*densityStrength*1.4);
              float lightDepth=dot(point,vec3(-.51,.73,.44));
              float illumination=.25+.75*smoothstep(-1300.,900.,lightDepth);
              float ribbon=n(point*vec3(.0035,.009,.003)+vec3(3.7,9.1,5.2));
              vec3 scatter=mix(low,high,clamp(.10+illumination*.26+folded*.35+ribbon*.20,0.,1.));
              scatter*=.18+1.6*smoothstep(.34,.70,broad)*illumination;scatter*=.20+ridge*1.35+pow(lace,3.)*.55;
              scatter*=.08+fine*1.8+pow(lace,4.)*1.3;color+=transmittance*absorb*scatter;transmittance*=1.-absorb;
            }
            gl_FragColor=vec4(color+low*transmittance,1.);return;
          }
          vec3 p=normalize(direction)*4.6;
          vec3 warp=vec3(fbm(p),fbm(p+19.2),fbm(p-8.6));
          float dust=fbm(p+warp*3.2); float lanes=fbm(p*vec3(.8,2.8,.9)+warp);
          float density=smoothstep(.35,.67,dust+lanes*.12);
          float filaments=fbm(p*3.4+warp*2.);
          density*=.25+.75*pow(filaments,2.);
          if(hasDetail>.5){
            vec3 q=normalize(direction)*.55+warp*.09;
            float grain=texture2D(detailDensity,q.xy+.5).r*.65+texture2D(detailDensity,q.zy+.37).r*.35;
            density=smoothstep(.08,.68,grain);
          }
          gl_FragColor=vec4(mix(low,high,pow(density,1.4)*densityStrength),1.0); }`,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(3500, 48, 32), material);
    sphere.name = 'nebula-backdrop';
    sphere.renderOrder = -100; sphere.frustumCulled = false;
    sphere.userData.tick=(dt,time,cam)=>{if(cam)material.uniforms.cameraWorld.value.copy(cam.position);};
    return sphere;
  }
  camera.far = 70000; camera.near = 0.08; camera.fov = 50; camera.updateProjectionMatrix();
  camera.position.set(2543, 9623, 8948); camera.lookAt(1700, 0, 550);
  const sky = spaceBackdrop('combat');
  sky.material.uniforms.low.value.set(0x04080d); sky.material.uniforms.volumeMode.value = 1; sky.material.uniforms.high.value.set(0x365870);
  sky.material.uniforms.strataWidth.value = 4500; sky.material.uniforms.densityStrength.value = .65; sky.scale.setScalar(10);
  scene.add(sky);
  scene.background = new THREE.Color(0x020508);
  return (dt, time) => { sky.userData.tick(dt, time, camera); };
}
