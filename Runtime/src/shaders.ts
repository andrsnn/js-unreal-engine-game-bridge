import * as THREE from 'three-real';
import createCrossShader from '../vendor/cross-shader/CrossShader.cjs';
import {host} from './host';
import {channelFor, isExtraAttribute} from './attributes';

/** Custom ShaderMaterials become generated Unreal materials. Both GLSL stages are rewritten as
 *  GLSL 4.50, compiled to HLSL with glslang and SPIRV-Cross (cross-shader, WebAssembly), and
 *  wrapped into one Unreal Custom-node body. The vertex stage runs per pixel on interpolated
 *  attributes, so its varyings reach the fragment stage unchanged for the usual transforms;
 *  uniforms arrive as material parameters of the same name. */

export type ShaderInput = {name: string; source: 'localPosition' | 'localAxis' | 'localOrigin' | 'localNormal' | 'uv' | 'vertexColor' | 'primitiveData' | 'collection' | 'scalar' | 'vector' | 'texture' | 'cube' | 'volume' | 'worldPosition';
  param?: string; index?: number};
export type TranslatedShader = {key: string; hlsl: string; inputs: ShaderInput[]; vertexHlsl: string; vertexInputs: ShaderInput[]};

type Decl = {qualifier: string; type: string; name: string; array: string};
const BUILTIN_UNIFORMS: Record<string, string> = {modelMatrix: 'mat4', viewMatrix: 'mat4', projectionMatrix: 'mat4', cameraPosition: 'vec3', isOrthographic: 'bool'};
const DERIVED = ['modelViewMatrix', 'normalMatrix'];
const SAMPLER = /^(sampler2D|samplerCube|sampler3D|sampler2DArray|sampler2DShadow|isampler2D|usampler2D)$/;

let compiler: {compile(src: string, i: object, o: object): string; ShaderFormat: Record<string, number>; ShaderStage: Record<string, number>} | null | undefined;
let loading = false;
function crossShader() {
  if (compiler !== undefined || loading) return compiler;
  loading = true;
  const wasm = host.readFile('/jsgb/CrossShader.wasm');
  if (!wasm) { compiler = null; host.log('warn', 'custom shaders: /jsgb/CrossShader.wasm is missing from the build; shader materials use the generic material'); return null; }
  try {
    const m = (createCrossShader as unknown as (o: object) => Record<string, any>)({wasmBinary: wasm, print: () => {}, printErr: (t: string) => host.log('warn', 'cross-shader: ' + t),
      locateFile: (p: string) => p});
    m.onRuntimeInitialized = () => { compiler = {compile: m.compile, ShaderFormat: m.ShaderFormat, ShaderStage: m.ShaderStage}; loading = false; };
  } catch (error) { compiler = null; host.log('warn', 'custom shaders unavailable: ' + error); }
  return compiler;
}

function expandIncludes(src: string, depth = 0): string {
  return depth > 8 ? src : src.replace(/^[ \t]*#include +<([\w.]+)>/gm, (_m, n: string) => expandIncludes((THREE.ShaderChunk as Record<string, string>)[n] ?? '', depth + 1));
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Removes top-level declarations of one storage kind and returns them. */
function takeDeclarations(src: string, qualifiers: string[]): {src: string; decls: Decl[]} {
  const decls: Decl[] = [];
  // Only declarations at statement starts: after ; { } or a line break. Function parameters
  // (`in vec3 x)`) never end in ';' without a parenthesis in between, so they do not match.
  const rx = new RegExp(`(?<=^|[;{}\\n])[ \\t]*(?:layout\\s*\\([^)]*\\)\\s*)?(${qualifiers.join('|')})\\s+((?:(?:lowp|mediump|highp|flat|smooth|centroid|invariant)\\s+)*)(\\w+)\\s+([^;(){}]+);`, 'gm');
  const out = src.replace(rx, (_m, qualifier: string, _p: string, type: string, names: string) => {
    for (const part of names.split(',')) {
      const m = /^\s*(\w+)\s*(\[[^\]]*\])?\s*$/.exec(part);
      if (m) decls.push({qualifier, type, name: m[1], array: m[2] ?? ''});
    }
    return '';
  });
  return {src: out, decls};
}

const sourceKey = (m: THREE.ShaderMaterial) => {
  const s = m.vertexShader + '\u0000' + m.fragmentShader + '\u0000' + JSON.stringify(m.defines ?? {}) + (m.isRawShaderMaterial ? 'raw' : '');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'glsl_' + (h >>> 0).toString(16) + '_' + s.length.toString(36);
};

/** GLSL 4.50 for glslang, plus what the HLSL glue needs to know. */
function prepare(material: THREE.ShaderMaterial, stage: 'vertex' | 'fragment') {
  const raw = !!material.isRawShaderMaterial;
  let src = stripComments(expandIncludes(stage === 'vertex' ? material.vertexShader : material.fragmentShader));
  src = src.replace(/^[ \t]*#version[^\n]*$/gm, '').replace(/^[ \t]*#extension[^\n]*$/gm, '').replace(/^[ \t]*precision\s+\w+\s+\w+\s*;/gm, '');
  const glsl3 = material.glslVersion === THREE.GLSL3;
  const u = takeDeclarations(src, ['uniform']); src = u.src;
  const a = stage === 'vertex' ? takeDeclarations(src, ['attribute', 'in']) : {src, decls: [] as Decl[]}; src = a.src;
  const v = takeDeclarations(src, stage === 'vertex' ? ['varying', 'out'] : ['varying', 'in']); src = v.src;
  const outs = stage === 'fragment' ? takeDeclarations(src, ['out']) : {src, decls: [] as Decl[]}; src = outs.src;
  src = src.replace(/\bvoid\s+main\s*\(\s*(void)?\s*\)/, 'void jsgb_main()');
  const defines = Object.entries(material.defines ?? {}).map(([k, val]) => `#define ${k} ${val === true ? '' : val}`);
  const uniforms = u.decls.filter(d => !(d.name in BUILTIN_UNIFORMS) && !DERIVED.includes(d.name));
  const samplers = uniforms.filter(d => SAMPLER.test(d.type));
  const values = uniforms.filter(d => !SAMPLER.test(d.type));
  const lines = ['#version 450', ...defines, `#define ${stage === 'vertex' ? 'JSGB_VERTEX' : 'JSGB_FRAGMENT'} 1`,
    '#define texture2D texture', '#define texture2DProj textureProj', '#define texture2DLodEXT textureLod', '#define texture2DGradEXT textureGrad',
    '#define textureCube texture', '#define textureCubeLodEXT textureLod', '#define lowp', '#define mediump', '#define highp',
    'layout(std140, binding = 0) uniform JsgbU {', ...Object.entries(BUILTIN_UNIFORMS).map(([n, t]) => `  ${t} ${n};`), ...values.map(d => `  ${d.type} ${d.name}${d.array};`), '};',
    ...samplers.map((d, i) => `layout(binding = ${i + 1}) uniform ${d.type} ${d.name}${d.array};`),
    'mat4 modelViewMatrix; mat3 normalMatrix;'];
  let loc = 0;
  if (stage === 'vertex') {
    const attrs: Decl[] = raw ? [] : [{qualifier: 'in', type: 'vec3', name: 'position', array: ''}, {qualifier: 'in', type: 'vec3', name: 'normal', array: ''}, {qualifier: 'in', type: 'vec2', name: 'uv', array: ''}];
    if (!raw && /\bUSE_COLOR\b|\bvertexColors\b/.test(JSON.stringify(material.defines ?? {})) || material.vertexColors) attrs.push({qualifier: 'in', type: material.defines?.USE_COLOR_ALPHA ? 'vec4' : 'vec3', name: 'color', array: ''});
    for (const d of a.decls) if (!attrs.some(x => x.name === d.name)) attrs.push(d);
    for (const d of attrs) lines.push(`layout(location = ${loc++}) in ${d.type} ${d.name}${d.array};`);
    loc = 0;
    for (const d of v.decls) lines.push(`layout(location = ${loc++}) out ${d.type} ${d.name}${d.array};`);
    // Point size has no HLSL equivalent; the billboard material sizes points itself.
    lines.push('float jsgb_PointSize;', '#define gl_PointSize jsgb_PointSize');
    // Instancing attributes the per-instance mirror does not feed: identity transform, white colour.
    if (/\binstanceMatrix\b/.test(src) && !attrs.some(x => x.name === 'instanceMatrix')) lines.push('mat4 instanceMatrix = mat4(1.0);');
    if (/\binstanceColor\b/.test(src) && !attrs.some(x => x.name === 'instanceColor')) lines.push('vec3 instanceColor = vec3(1.0);');
    lines.push(src, 'void main() { modelViewMatrix = viewMatrix * modelMatrix; normalMatrix = transpose(inverse(mat3(modelViewMatrix))); jsgb_main(); }');
    return {glsl: lines.join('\n'), uniforms, attributes: attrs, varyings: v.decls};
  }
  for (const d of v.decls) lines.push(`layout(location = ${loc++}) in ${d.type} ${d.name}${d.array};`);
  lines.push('layout(location = 0) out vec4 jsgb_FragColor;');
  // Points draw as quads whose UVs are the corner, which is what gl_PointCoord means.
  lines.push('vec2 jsgb_PointCoord;', '#define gl_PointCoord jsgb_PointCoord');
  if (outs.decls[0]) lines.push(`#define ${outs.decls[0].name} jsgb_FragColor`); else lines.push('#define gl_FragColor jsgb_FragColor');
  if (glsl3) lines.push('#define varying in');
  lines.push(src, 'void main() { modelViewMatrix = viewMatrix * modelMatrix; normalMatrix = transpose(inverse(mat3(modelViewMatrix))); jsgb_main(); }');
  return {glsl: lines.join('\n'), uniforms, attributes: [] as Decl[], varyings: v.decls};
}

/** Finds the matching ')' for the '(' at `open`; returns the index after it and the split arguments. */
function callArgs(s: string, open: number): {end: number; args: string[]} {
  let depth = 0, start = open + 1; const args: string[] = [];
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (depth === 0) { args.push(s.slice(start, i).trim()); return {end: i + 1, args}; } }
    else if (c === ',' && depth === 1) { args.push(s.slice(start, i).trim()); start = i + 1; }
  }
  return {end: s.length, args};
}
/** SPIRV-Cross writes Shader Model 3 sampling (tex2D). Unreal's Custom node needs Texture2D objects. */
function modernSampling(s: string): string {
  const map: Record<string, (a: string[]) => string> = {
    tex2D: a => `${a[0]}.Sample(${a[0]}Sampler, ${a[1]})`,
    tex2Dlod: a => `${a[0]}.SampleLevel(${a[0]}Sampler, (${a[1]}).xy, (${a[1]}).w)`,
    tex2Dbias: a => `${a[0]}.SampleBias(${a[0]}Sampler, (${a[1]}).xy, (${a[1]}).w)`,
    tex2Dgrad: a => `${a[0]}.SampleGrad(${a[0]}Sampler, ${a[1]}, ${a[2]}, ${a[3]})`,
    tex2Dproj: a => `${a[0]}.Sample(${a[0]}Sampler, (${a[1]}).xy / (${a[1]}).w)`,
    texCUBE: a => `${a[0]}.Sample(${a[0]}Sampler, ${a[1]})`,
    texCUBElod: a => `${a[0]}.SampleLevel(${a[0]}Sampler, (${a[1]}).xyz, (${a[1]}).w)`,
    texCUBEbias: a => `${a[0]}.SampleBias(${a[0]}Sampler, (${a[1]}).xyz, (${a[1]}).w)`,
    tex3D: a => `${a[0]}.Sample(${a[0]}Sampler, ${a[1]})`,
    tex3Dlod: a => `${a[0]}.SampleLevel(${a[0]}Sampler, (${a[1]}).xyz, (${a[1]}).w)`,
    tex3Dbias: a => `${a[0]}.SampleBias(${a[0]}Sampler, (${a[1]}).xyz, (${a[1]}).w)`,
    tex3Dgrad: a => `${a[0]}.SampleGrad(${a[0]}Sampler, ${a[1]}, ${a[2]}, ${a[3]})`,
  };
  const rx = /\b(tex2Dlod|tex2Dbias|tex2Dgrad|tex2Dproj|tex2D|texCUBElod|texCUBEbias|texCUBE|tex3Dlod|tex3Dgrad|tex3Dbias|tex3D)\s*\(/g;
  let out = '', last = 0, m: RegExpExecArray | null;
  while ((m = rx.exec(s))) {
    const {end, args} = callArgs(s, m.index + m[0].length - 1);
    out += s.slice(last, m.index) + map[m[1]](args.map(modernSampling));
    last = end; rx.lastIndex = end;
  }
  return out + s.slice(last);
}

type Member = {type: string; name: string; array: string; resource?: 'tex' | 'cube' | 'volume'};
/** SPIRV-Cross HLSL as a struct: globals become members, functions become methods. */
function toStruct(hlsl: string, name: string): {struct: string; members: Member[]; types: string; entry: string} {
  let src = hlsl.replace(/\r/g, '');
  const members: Member[] = [];
  // Uniform block: members lose the block's _N_ prefix.
  const cb = /cbuffer\s+\w+\s*:\s*register\(\w+\)\s*\{([\s\S]*?)\};/.exec(src);
  if (cb) {
    src = src.replace(cb[0], '');
    for (const line of cb[1].split('\n')) {
      const m = /^\s*(?:row_major\s+|column_major\s+)?([\w]+)\s+(_\d+_)?(\w+)(\[[^\]]*\])?\s*(?::\s*packoffset\([^)]*\))?\s*;/.exec(line);
      if (m) { members.push({type: m[1], name: m[3], array: m[4] ?? ''}); if (m[2]) src = src.replace(new RegExp(`\\b${m[2]}${m[3]}\\b`, 'g'), m[3]); }
    }
  }
  src = src.replace(/^\s*uniform\s+(sampler2D|samplerCUBE)\s+(\w+)\s*;\s*$/gm, (_m, t: string, n: string) => { members.push({type: t === 'samplerCUBE' ? 'TextureCube' : 'Texture2D', name: n, array: '', resource: t === 'samplerCUBE' ? 'cube' : 'tex'}); return ''; });
  src = src.replace(/^\s*uniform\s+sampler3D\s+(\w+)\s*;\s*$/gm, (_m, n: string) => { members.push({type: 'Texture3D', name: n, array: '', resource: 'volume'}); return ''; });
  // Other plain uniforms SPIRV-Cross declares outside the block (gl_HalfPixel) become members.
  src = src.replace(/^\s*uniform\s+(\w+)\s+(\w+)(\[[^\]]*\])?\s*;\s*$/gm, (_m, t: string, n: string, arr: string) => { members.push({type: t, name: n, array: arr ?? ''}); return ''; });
  src = src.replace(/^static\s+(?!const)([\w]+)\s+(\w+)(\[[^\]]*\])?\s*;\s*$/gm, (_m, t: string, n: string, arr: string) => { members.push({type: t, name: n, array: arr ?? ''}); return ''; });
  // Drop the stage entry point and its IO structs; the glue calls the *_main method itself.
  src = src.replace(/struct\s+SPIRV_Cross_(Input|Output)\s*\{[\s\S]*?\};/g, '');
  const mainAt = src.search(/\n\s*(SPIRV_Cross_Output|void)\s+main\s*\(/);
  if (mainAt >= 0) src = src.slice(0, mainAt);
  // Top-level user struct types and static consts stay outside the stage struct.
  let types = '';
  src = src.replace(/^struct\s+\w+\s*\{[\s\S]*?^\};\s*$/gm, m => { types += m + '\n'; return ''; });
  src = src.replace(/^static\s+const[^;]*;\s*$/gm, m => { types += m + '\n'; return ''; });
  const entry = /\bvoid\s+(vert_main|frag_main)\s*\(\s*\)/.exec(src)?.[1] ?? 'main';
  const body = modernSampling(src).trim();
  const decl = members.map(m => m.resource ? `  ${m.type} ${m.name}; SamplerState ${m.name}Sampler;` : `  ${m.type} ${m.name}${m.array};`).join('\n');
  return {struct: `struct ${name} {\n${decl}\n${body.replace(/^/gm, '  ')}\n};\n`, members, types, entry};
}

function zero(target: string, m: Member): string {
  if (m.resource) return '';
  if (m.array) return `for (int i = 0; i < ${m.array.slice(1, -1)}; i++) ${target}.${m.name}[i] = (${m.type})0;`;
  if (/^float(\d)x\1$/.test(m.type)) return `${target}.${m.name} = (${m.type})0;`;
  return /^(float|int|uint|bool|half|min16float|double)\d?$/.test(m.type) ? `${target}.${m.name} = (${m.type})0;` : `${target}.${m.name} = (${m.type})0;`;
}

const cache = new Map<string, TranslatedShader | null>();
function textHash(s: string) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16) + s.length.toString(16);
}
/** The generated-material description for a ShaderMaterial; undefined while the compiler loads, null when it cannot be translated. */
export function translateShaderMaterial(material: THREE.ShaderMaterial): TranslatedShader | null | undefined {
  const key = sourceKey(material);
  if (cache.has(key)) return cache.get(key);
  let vs: ReturnType<typeof prepare>, fs: ReturnType<typeof prepare>;
  try { vs = prepare(material, 'vertex'); fs = prepare(material, 'fragment'); } catch (error) {
    host.log('warn', `custom shader ${material.name || key} stays generic: ${error instanceof Error ? error.message : error}`);
    cache.set(key, null);
    return null;
  }
  // Compiled stages persist in the host store, so a reload or relaunch skips the compiler.
  const stageKey = (glsl: string, label: string) => 'jsgb-shader-v1:' + label + ':' + textHash(glsl);
  const compiled = (out: string) => /\bvoid\s+(vert|frag)_main\b/.test(out);
  const stored = (glsl: string, label: string) => { const out = host.storage?.load(stageKey(glsl, label)) ?? ''; return compiled(out) ? out : ''; };
  let vh = stored(vs.glsl, 'vertex'), fh = stored(fs.glsl, 'fragment');
  const c = vh && fh ? null : crossShader();
  if (!c && !(vh && fh)) return c === null ? null : undefined;
  let result: TranslatedShader | null = null;
  try {
    const run = (glsl: string, label: 'vertex' | 'fragment') => {
      const stage = label === 'vertex' ? c!.ShaderStage.Vertex : c!.ShaderStage.Fragment;
      const opts = [{format: c!.ShaderFormat.GLSL, stage, es: false, glslVersion: 450}, {format: c!.ShaderFormat.HLSL, es: false, glslVersion: 450}];
      let out = '';
      try { out = c!.compile(glsl, ...opts as [object, object]); } catch (e) { out = 'exception ' + e; }
      if (!compiled(out)) {
        (globalThis as Record<string, any>).__jsgbShaderFailures?.push({key, label, glsl, out});
        throw Error(`${label} stage (${typeof out}, ${out.length}): ${out.slice(-300) || "no output"}`);
      }
      host.storage?.save(stageKey(glsl, label), out);
      return out;
    };
    vh ||= run(vs.glsl, 'vertex');
    fh ||= run(fs.glsl, 'fragment');
    const V = toStruct(vh, 'JsgbVS'), F = toStruct(fh, 'JsgbFS');
    const inputs: ShaderInput[] = [{name: 'JsgbP', source: 'localPosition'}, {name: 'JsgbN', source: 'localNormal'}, {name: 'JsgbUV', source: 'uv'}, {name: 'JsgbC', source: 'vertexColor'}];
    // Three.js modelMatrix from Unreal's own local-to-world (per instance for instanced meshes):
    // Three x/y/z axes are Unreal local X/Z/Y; the origin is in centimetres.
    inputs.push({name: 'JsgbMX', source: 'localAxis', index: 0}, {name: 'JsgbMY', source: 'localAxis', index: 2}, {name: 'JsgbMZ', source: 'localAxis', index: 1}, {name: 'JsgbMO', source: 'localOrigin'});
    for (let i = 0; i < 4; i++) inputs.push({name: `JsgbV${i}`, source: 'collection', param: `ViewCol${i}`});
    for (let i = 0; i < 4; i++) inputs.push({name: `JsgbPr${i}`, source: 'collection', param: `ProjCol${i}`});
    inputs.push({name: 'JsgbCam', source: 'collection', param: 'CameraPos'});
    let glue: string[] = [];
    const seen = new Set<string>();
    const bind = (target: string, S: typeof V) => {
      for (const m of S.members) glue.push(zero(target, m));
      glue.push(`${target}.modelMatrix = float4x4(float4(JsgbMX.xzy, 0), float4(JsgbMY.xzy, 0), float4(JsgbMZ.xzy, 0), float4(JsgbMO.xzy * 0.01, 1));`, `${target}.viewMatrix = float4x4(JsgbV0, JsgbV1, JsgbV2, JsgbV3);`,
        `${target}.projectionMatrix = float4x4(JsgbPr0, JsgbPr1, JsgbPr2, JsgbPr3);`, `${target}.cameraPosition = JsgbCam.xyz;`, `${target}.isOrthographic = JsgbPr3.w > 0.5;`);
      for (const m of S.members) {
        if (m.name in BUILTIN_UNIFORMS || DERIVED.includes(m.name) || m.array) continue;
        const decl = [...vsDecls, ...fsDecls].find(d => d.name === m.name);
        if (!decl) continue;
        if (m.resource) {
          if (!seen.has(m.name)) { seen.add(m.name); inputs.push({name: 'T_' + m.name, source: m.resource === 'cube' ? 'cube' : m.resource === 'volume' ? 'volume' : 'texture', param: m.name}); }
          glue.push(`${target}.${m.name} = T_${m.name}; ${target}.${m.name}Sampler = T_${m.name}Sampler;`);
          continue;
        }
        const n = /^(?:float|int|uint|bool)(\d)$/.exec(m.type)?.[1];
        const scalar = /^(float|int|uint|bool|half)$/.test(m.type);
        if (!scalar && !n) continue; // matrices and structs keep their zero value
        if (!seen.has(m.name)) { seen.add(m.name); inputs.push({name: 'U_' + m.name, source: scalar ? 'scalar' : 'vector', param: m.name}); }
        glue.push(scalar ? `${target}.${m.name} = (${m.type})U_${m.name};` : `${target}.${m.name} = (${m.type})U_${m.name}.${'xyzw'.slice(0, +n!)};`);
      }
    };
    const vsDecls = vs.uniforms, fsDecls = fs.uniforms;
    glue.push('JsgbVS vs;'); bind('vs', V);
    const has = (S: typeof V, n: string) => S.members.some(m => m.name === n);
    // Unreal local space is Three.js local space with Y and Z swapped, in centimetres.
    if (has(V, 'position')) glue.push('vs.position = float3(JsgbP.x, JsgbP.z, JsgbP.y) * 0.01;');
    if (has(V, 'normal')) glue.push('vs.normal = normalize(float3(JsgbN.x, JsgbN.z, JsgbN.y) + 1e-6);');
    if (has(V, 'uv')) glue.push('vs.uv = JsgbUV;');
    if (has(V, 'color')) glue.push(`vs.color = JsgbC${V.members.find(m => m.name === 'color')?.type === 'float4' ? '' : '.xyz'};`);
    // The shader's own attributes come from the UV channels the geometry export put them in.
    for (const d of vs.attributes) {
      if (!isExtraAttribute(d.name) || !has(V, d.name)) continue;
      const size = d.type === 'float' ? 1 : +(/\d$/.exec(d.type)?.[0] ?? 0);
      const slot = size ? channelFor(d.name, size) : null;
      if (!slot) continue;
      for (const c of [slot.channel, slot.channel + 1].slice(0, size > 2 ? 2 : 1)) if (!inputs.some(i => i.name === `JsgbT${c}`)) inputs.push({name: `JsgbT${c}`, source: 'uv', index: c});
      const t = `JsgbT${slot.channel}`, t2 = `JsgbT${slot.channel + 1}`;
      glue.push(`vs.${d.name} = ${size === 1 ? `${t}.x` : size === 2 ? `${t}.xy` : size === 3 ? `float3(${t}.xy, ${t2}.x)` : `float4(${t}.xy, ${t2}.xy)`};`);
    }
    glue.push(`vs.${V.entry}();`);
    const vsGlue = glue, vsInputs = [...inputs];
    glue = [];
    glue.push('JsgbFS fs;'); bind('fs', F);
    for (const m of F.members) if (has(V, m.name) && !(m.name in BUILTIN_UNIFORMS) && !m.resource && !DERIVED.includes(m.name) && fs.varyings.some(d => d.name === m.name)) glue.push(`fs.${m.name} = vs.${m.name};`);
    if (has(F, 'gl_FragCoord')) glue.push('fs.gl_FragCoord = Parameters.SvPosition;');
    if (has(F, 'jsgb_PointCoord')) glue.push('fs.jsgb_PointCoord = JsgbUV;');
    if (has(F, 'gl_FrontFacing')) glue.push('fs.gl_FrontFacing = Parameters.TwoSidedSign > 0;');
    glue.push(`fs.${F.entry}();`, 'return fs.jsgb_FragColor;');
    const hlsl = [V.types + F.types, V.struct, F.struct, ...vsGlue, ...glue].filter(Boolean).join('\n');
    // Vertex stage: the shader's own gl_Position, taken back to a world position through the
    // inverse camera, becomes Unreal's world position offset (billboards, view-space quads).
    const vertexInputs: ShaderInput[] = [...vsInputs.filter(i => !i.name.startsWith('T_')),
      ...[0, 1, 2, 3].map(i => ({name: `JsgbW${i}`, source: 'collection' as const, param: `CamCol${i}`})),
      ...[0, 1, 2, 3].map(i => ({name: `JsgbPI${i}`, source: 'collection' as const, param: `ProjInvCol${i}`})), {name: 'JsgbWorld', source: 'worldPosition'}];
    const vertexHlsl = vsInputs.some(i => i.name.startsWith('T_')) ? '' : [V.types, V.struct, ...vsGlue,
      'float4 jsgbW = mul(vs.gl_Position, mul(float4x4(JsgbPI0, JsgbPI1, JsgbPI2, JsgbPI3), float4x4(JsgbW0, JsgbW1, JsgbW2, JsgbW3)));',
      'float3 jsgbT = jsgbW.xyz / (abs(jsgbW.w) > 1e-8 ? jsgbW.w : 1e-8);',
      'float3 jsgbOffset = float3(jsgbT.x, jsgbT.z, jsgbT.y) * 100.0 - JsgbWorld;',
      'return any(isnan(jsgbOffset)) || dot(jsgbOffset, jsgbOffset) < 1e-4 ? float3(0, 0, 0) : jsgbOffset;'].filter(Boolean).join('\n');
    result = {key, hlsl, inputs, vertexHlsl, vertexInputs};
  } catch (error) {
    host.log('warn', `custom shader ${material.name || key} stays generic: ${error instanceof Error ? error.message : error}`);
  }
  cache.set(key, result);
  return result;
}
