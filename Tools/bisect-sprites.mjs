// Debug helper: finds which sprites turn a running host's frame white, by halving the visible set.
import {execFileSync} from 'node:child_process';
const base = 'http://127.0.0.1:5292/bridge';
const evalJs = async js => (await (await fetch(`${base}/eval`, {method: 'POST', body: js})).json()).result;
const wait = s => new Promise(r => setTimeout(r, s * 1000));
async function white(lo, hi) {
  await evalJs(`(()=>{let i=0;__jsgb.lastFrame.scene.traverse(o=>{if(o.isSprite){o.visible=i>=${lo}&&i<${hi};i++}});return i})()`);
  await wait(2.5);
  const file = `G:/JsGameBridgeBuilds/hardburn/probe/bisect-${lo}-${hi}.png`;
  await fetch(`${base}/capture`, {method: 'POST', body: file});
  await wait(1.5);
  const px = execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', 'crop=8:8:900:500,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  console.log(lo, hi, [...px]);
  return px[0] > 120;
}
let lo = 0, hi = +(process.argv[2] ?? 108);
while (hi - lo > 1) {
  const mid = (lo + hi) >> 1;
  if (await white(lo, mid)) hi = mid; else if (await white(mid, hi)) lo = mid; else { console.log('neither half alone'); break; }
}
console.log('culprit range', lo, hi, await evalJs(`(()=>{let i=0,out='';__jsgb.lastFrame.scene.traverse(o=>{if(o.isSprite){if(i===${lo}){const p=new o.position.constructor(),w=new o.position.constructor();o.getWorldPosition(p);o.getWorldScale(w);out=JSON.stringify({pos:p.toArray(),scale:w.toArray(),att:o.material.sizeAttenuation,blend:o.material.blending,op:o.material.opacity,col:o.material.color.getHexString(),map:o.material.map&&o.material.map.image&&o.material.map.image.width,parent:o.parent&&o.parent.name,center:o.center.toArray(),rot:o.material.rotation,dt:o.material.depthTest})}i++}});return out})()`));
