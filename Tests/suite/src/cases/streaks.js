// Instanced ribbons drawn by a ShaderMaterial that reads instanceMatrix, instanceColor and a per-instance attribute
// itself, as weapon tracers and drive plumes often are: the ribbon's width comes from the instance's scale, with a
// floor in pixels, and its brightness from the per-instance 'fade'.
export default function streaks({THREE, scene, camera}) {
  camera.position.set(0, 6, 40); camera.lookAt(0, 0, 0);
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // Bright at the head (the last rows), so a texture drawn upside down shows.
    const a = Math.max(0, 1 - Math.abs(x / (size - 1) * 2 - 1)) ** 1.5 * (y / (size - 1)) ** 2, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(255 * a); data[i + 3] = Math.round(255 * a);
  }
  const map = new THREE.DataTexture(data, size, size); map.flipY = true; map.needsUpdate = true;
  const material = new THREE.ShaderMaterial({
    uniforms: {map: {value: map}, viewportHeight: {value: innerHeight}, minWidth: {value: 1.5}, minLength: {value: 12}},
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `uniform float viewportHeight, minWidth, minLength; attribute float fade; varying vec2 q; varying vec3 tint; varying float glow;
      void main() { q = uv; tint = instanceColor; glow = fade; vec4 centre = modelViewMatrix * instanceMatrix * vec4(0., 0., 0., 1.);
        vec3 velocity = (modelViewMatrix * vec4(instanceMatrix[2].xyz, 0.)).xyz; float span = length(velocity.xy);
        vec2 along = span > .00001 ? velocity.xy / span : vec2(0., 1.); float units = 2. * abs(centre.z) / (viewportHeight * projectionMatrix[1][1]);
        float width = max(length(instanceMatrix[0].xyz) * 3., units * minWidth); centre.xyz += velocity * position.y;
        centre.xy += along * position.y * max(0., units * minLength - span); centre.xy += vec2(along.y, -along.x) * position.x * width;
        gl_Position = projectionMatrix * centre; }`,
    fragmentShader: `uniform sampler2D map; varying vec2 q; varying vec3 tint; varying float glow;
      void main() { vec4 t = texture2D(map, q); if (t.r < .004) discard; gl_FragColor = vec4(t.rgb * tint * 2. * glow, t.a); }`});
  const n = 24, geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute('fade', new THREE.InstancedBufferAttribute(new Float32Array(n).map((_, i) => [0.15, 0.5, 1][i % 3]), 1));
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  mesh.frustumCulled = false;
  scene.add(mesh);
  return (dt, time) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + time * 0.3;
      p.set(Math.cos(a) * 12, (i % 5 - 2) * 2, Math.sin(a) * 6);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-Math.sin(a), 0.2, Math.cos(a)).normalize());
      s.set(0.15 + (i % 3) * 0.1, 0.1, 3 + i % 4);
      m.compose(p, q, s); mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHSL(i / n, 0.8, 0.6));
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  };
}
