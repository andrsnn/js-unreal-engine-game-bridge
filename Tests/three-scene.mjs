import assert from 'node:assert/strict';
import * as THREE from '/mnt/c/Users/Aidan Anderson/falling-frontier-clone/node_modules/three/build/three.module.js';
import {createThreeUnrealRenderer} from '../JavaScript/ThreeUnrealRenderer.mjs';
let packets=[];const host={ApplyScene(json){packets.push(JSON.parse(json));},ResetScene(){}};
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(50,16/9,.1,2000);
const group=new THREE.Group();group.layers.set(2);scene.add(group);
const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());group.add(mesh);
const renderer=createThreeUnrealRenderer(THREE,host,{assetRegistry:{rock:{mesh:'/Game/Rock.Rock'}}});
let frame=renderer.render(scene,camera);assert.equal(frame.chunks.length,1);assert(frame.entities.some(e=>e.id===mesh.uuid));
frame=renderer.render(scene,camera);assert.equal(frame.chunks.length,0);
mesh.geometry.setAttribute('position',mesh.geometry.getAttribute('position').clone());
frame=renderer.render(scene,camera);assert.equal(frame.chunks.length,1);
mesh.geometry.setDrawRange(0,6);frame=renderer.render(scene,camera);assert.equal(frame.chunks[0].indices.length,6);
const instances=new THREE.InstancedMesh(new THREE.BoxGeometry(),mesh.material,2);instances.userData.assetKey='rock';instances.position.x=10;instances.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,3,4));scene.add(instances);
frame=renderer.render(scene,camera);assert.equal(frame.instances[0].transforms.length,2);assert.equal(frame.instances[0].transforms[1].matrix[12],12);
renderer.emit('sound','shot');frame=renderer.render(scene,camera);assert.equal(frame.events.length,1);frame=renderer.render(scene,camera);assert.equal(frame.events.length,0);
group.remove(mesh);frame=renderer.render(scene,camera);assert(frame.releaseChunks.includes(mesh.geometry.uuid));
assert.equal(packets.length,8);console.log('PASS: shared Three backend layers, dirty/replaced geometry, draw range, imported instances, event lifetime and geometry release');

const imported=new THREE.Group();imported.userData.assetKey='rock';const lod=new THREE.LOD(),body=new THREE.Mesh(new THREE.BoxGeometry(),mesh.material),attachment=new THREE.Mesh(new THREE.SphereGeometry(1),mesh.material);body.userData.assetContent='rock';lod.addLevel(body,0);imported.add(lod,attachment);scene.add(imported);
frame=renderer.render(scene,camera);assert(frame.entities.some(e=>e.id===imported.uuid&&e.asset==='rock'));assert(frame.entities.some(e=>e.id===attachment.uuid));assert(!frame.entities.some(e=>e.id===body.uuid));assert(!frame.chunks.some(e=>e.id===body.geometry.uuid));
const nested=new THREE.Mesh(new THREE.BoxGeometry(),mesh.material);body.add(nested);frame=renderer.render(scene,camera);assert(frame.entities.some(e=>e.id===nested.uuid));
console.log('PASS imported asset overrides retain runtime attachments through LOD/content containers without duplicating source geometry');

body.layers.set(1);frame=renderer.render(scene,camera);assert(!frame.entities.some(e=>e.id===imported.uuid));assert(frame.entities.some(e=>e.id===attachment.uuid));
console.log('PASS imported root respects source geometry layers when the game draws its hull through independent instance batches');

attachment.geometry.setAttribute('color',new THREE.Float32BufferAttribute(Array.from({length:attachment.geometry.attributes.position.count*3},(_,i)=>i%3===0?.25:i%3===1?.5:.75),3));frame=renderer.render(scene,camera);const colorChunk=frame.chunks.find(c=>c.id===attachment.geometry.uuid);assert.deepEqual(colorChunk.colors.slice(0,4),[.25,.5,.75,1]);
console.log('PASS vertex colours retain RGB order and alpha in dirty geometry uploads');
