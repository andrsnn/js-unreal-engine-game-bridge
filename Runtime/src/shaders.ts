declare const __JSGB_SHADER_VERSION__: string;
import * as THREE from 'three-real';
import createCrossShader from '../vendor/cross-shader/CrossShader.cjs';
import {host, type BackgroundWorker} from './host';
import {channelFor, isExtraAttribute} from './attributes';

/** Custom ShaderMaterials become generated Unreal materials. Both GLSL stages are rewritten as
 *  GLSL 4.50, compiled to HLSL with glslang and SPIRV-Cross (cross-shader, WebAssembly), and
 *  wrapped into one Unreal Custom-node body. The vertex stage runs per pixel on interpolated
 *  attributes, so its varyings reach the fragment stage unchanged for the usual transforms;
 *  uniforms arrive as material parameters of the same name. */

export type ShaderInput = {name: string; source: 'localPosition' | 'instanceColor' | 'localAxis' | 'localOrigin' | 'localNormal' | 'uv' | 'vertexColor' | 'primitiveData' | 'instanceData' | 'collection' | 'scalar' | 'vector' | 'texture' | 'cube' | 'volume' | 'worldPosition';
  param?: string; index?: number};
export type TranslatedShader = {key: string; hlsl: string; inputs: ShaderInput[]; vertexHlsl: string; vertexInputs: ShaderInput[]; lit?: boolean; encoded?: boolean};

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
/** Resolves #if/#ifdef/#ifndef/#elif/#else/#endif with the given defines (and the #defines met on the way), so
 *  declarations inside inactive blocks are dropped before the uniforms and varyings are collected. three's
 *  built-in shader chunks declare most of their uniforms inside such blocks. */
export function preprocess(src: string, defines: Record<string, unknown>): string {
  const known = new Map<string, string>(Object.entries(defines).map(([k, v]) => [k, v === true ? '' : String(v)]));
  const test = (expr: string) => {
    let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)/g, (_m, n: string) => known.has(n) ? '1' : '0').replace(/defined\s+(\w+)/g, (_m, n: string) => known.has(n) ? '1' : '0');
    for (let i = 0; i < 4; i++) e = e.replace(/\b[A-Za-z_]\w*\b/g, n => { const v = known.get(n); return v === undefined || v === '' ? '0' : v; });
    try { return !!Function(`return (${e});`)(); } catch { return false; }
  };
  const out: string[] = [];
  // Each level: is this branch active, has any branch of the #if been taken, was the enclosing level active.
  const stack: {active: boolean; taken: boolean; outer: boolean}[] = [];
  const active = () => stack.length === 0 || stack[stack.length - 1].active;
  for (const line of src.split(/\r?\n/)) {
    const d = /^\s*#\s*(ifdef|ifndef|if|elif|else|endif|define|undef)\b\s*(.*)$/.exec(line);
    if (!d) { if (active()) out.push(line); continue; }
    const [, kind, rest] = d;
    if (kind === 'ifdef' || kind === 'ifndef' || kind === 'if') {
      const outer = active();
      const on = outer && (kind === 'ifdef' ? known.has(rest.trim().split(/\s+/)[0]) : kind === 'ifndef' ? !known.has(rest.trim().split(/\s+/)[0]) : test(rest));
      stack.push({active: on, taken: on, outer});
    } else if (kind === 'elif') {
      const top = stack[stack.length - 1]; if (!top) continue;
      top.active = top.outer && !top.taken && test(rest); top.taken ||= top.active;
    } else if (kind === 'else') {
      const top = stack[stack.length - 1]; if (!top) continue;
      top.active = top.outer && !top.taken; top.taken = true;
    } else if (kind === 'endif') stack.pop();
    else if (active()) {
      const m = /^(\w+)(?:\s+(.*))?$/.exec(rest.trim());
      if (m) { if (kind === 'define' && !/^\w+\(/.test(rest.trim())) known.set(m[1], (m[2] ?? '').trim()); else if (kind === 'undef') known.delete(m[1]); }
      out.push(line);
    }
  }
  return out.join(String.fromCharCode(10));
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

// Hashing the whole shader source is slow, and a material is described again whenever a uniform moves. The key
// is kept per material while its sources and defines stay the same.
// The key also names the cooked Unreal materials a package ships, so its form stays as it is. `full` is a longer hash
// of the same text, for the translations kept on disk.
const sourceKeys = new WeakMap<object, {vs: string; fs: string; defines: string; raw: boolean; key: string; full: string}>();
const sourceEntry = (m: THREE.ShaderMaterial) => {
  const defines = JSON.stringify(m.defines ?? {}), raw = !!m.isRawShaderMaterial;
  const last = sourceKeys.get(m);
  if (last && last.vs === m.vertexShader && last.fs === m.fragmentShader && last.defines === defines && last.raw === raw) return last;
  const s = m.vertexShader + '\u0000' + m.fragmentShader + '\u0000' + defines + (raw ? 'raw' : '');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const entry = {vs: m.vertexShader, fs: m.fragmentShader, defines, raw, key: 'glsl_' + (h >>> 0).toString(16) + '_' + s.length.toString(36), full: textHash(s)};
  sourceKeys.set(m, entry);
  return entry;
};

/** GLSL 4.50 for glslang, plus what the HLSL glue needs to know. */
/** True when the vertex shader places vertices with the plain model, view and projection matrices.
 *  The Unreal mesh is already drawn there, so such shaders need no world position offset. */
export function standardVertexTransform(source: string): boolean {
  const src = stripComments(expandIncludes(source)).replace(/\s+/g, '');
  if (/(^|[^.\w])position=/.test(src) || /transformed/.test(src)) return false;
  const assigns = [...src.matchAll(/gl_Position=([^;]+);/g)];
  if (assigns.length !== 1) return false;
  let expr = assigns[0][1];
  // Inline local vec4 values the expression uses (vec4 wp = modelMatrix * vec4(position, 1.0); ...).
  // A value that is changed after it is declared (mv.xy += ...) is not a plain transform.
  for (const m of src.matchAll(/vec4(\w+)=([^;]+);/g)) if (new RegExp(`[^\\w]${m[1]}(\\.\\w+)?[-+*/]?=`).test(src.replace(m[0], ''))) return false;
  for (let i = 0; i < 4; i++) {
    for (const m of src.matchAll(/vec4(\w+)=([^;]+);/g)) expr = expr.replace(new RegExp(`\\b${m[1]}\\b`, 'g'), `(${m[2]})`);
  }
  expr = expr.replace(/[()]/g, '').replace(/vec4position,1\.0?/g, 'P').replace(/vec4position\.xyz,1\.0?/g, 'P');
  return ['projectionMatrix*viewMatrix*modelMatrix*P', 'projectionMatrix*modelViewMatrix*P'].includes(expr);
}

function prepare(material: THREE.ShaderMaterial, stage: 'vertex' | 'fragment', instancing = {matrix: false, color: false}) {
  const raw = !!material.isRawShaderMaterial;
  const stageDefines = {...(material.defines ?? {}), [stage === 'vertex' ? 'JSGB_VERTEX' : 'JSGB_FRAGMENT']: 1};
  let src = preprocess(stripComments(expandIncludes(stage === 'vertex' ? material.vertexShader : material.fragmentShader)), stageDefines);
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
  const location = (d: Decl) => {
    const at = loc;
    const columns = /^mat(\d)/.exec(d.type)?.[1];
    loc += (columns ? +columns : 1) * (d.array ? +(d.array.slice(1, -1)) || 1 : 1);
    return at;
  };
  if (stage === 'vertex') {
    const attrs: Decl[] = raw ? [] : [{qualifier: 'in', type: 'vec3', name: 'position', array: ''}, {qualifier: 'in', type: 'vec3', name: 'normal', array: ''}, {qualifier: 'in', type: 'vec2', name: 'uv', array: ''}];
    if (!raw && /\bUSE_COLOR\b|\bvertexColors\b/.test(JSON.stringify(material.defines ?? {})) || material.vertexColors) attrs.push({qualifier: 'in', type: material.defines?.USE_COLOR_ALPHA ? 'vec4' : 'vec3', name: 'color', array: ''});
    for (const d of a.decls) if (!attrs.some(x => x.name === d.name)) attrs.push(d);
    // Per-instance colours come from Unreal's per-instance custom data when the mesh has them.
    if (/\binstanceColor\b/.test(src) && !attrs.some(x => x.name === 'instanceColor')) {
      // three.js defines USE_INSTANCING_COLOR itself for an InstancedMesh with instance colours.
      if (material.defines?.USE_INSTANCING_COLOR !== undefined || instancing.color) attrs.push({qualifier: 'in', type: 'vec3', name: 'instanceColor', array: ''}); else lines.push('vec3 instanceColor = vec3(1.0);');
    }
    for (const d of attrs) lines.push(`layout(location = ${location(d)}) in ${d.type} ${d.name}${d.array};`);
    loc = 0;
    for (const d of v.decls) lines.push(`layout(location = ${location(d)}) out ${d.type} ${d.name}${d.array};`);
    // Point size has no HLSL equivalent; the billboard material sizes points itself.
    lines.push('float jsgb_PointSize;', '#define gl_PointSize jsgb_PointSize');
    // On an InstancedMesh, Unreal's model matrix holds the instance's whole transform. A shader that reads
    // instanceMatrix itself (its scale, say, as a width) gets that transform there and an identity modelMatrix,
    // so modelMatrix * instanceMatrix is still the whole transform. Elsewhere instanceMatrix is the identity.
    let main = 'void main() { modelViewMatrix = viewMatrix * modelMatrix; normalMatrix = transpose(inverse(mat3(modelViewMatrix))); jsgb_main(); }';
    if (instancing.matrix && /\binstanceMatrix\b/.test(src) && !attrs.some(x => x.name === 'instanceMatrix')) {
      src = src.replace(/\binstanceMatrix\b/g, 'jsgb_InstanceMatrix').replace(/\bmodelMatrix\b/g, 'jsgb_ModelMatrix');
      lines.push('mat4 jsgb_InstanceMatrix; mat4 jsgb_ModelMatrix;');
      main = 'void main() { jsgb_InstanceMatrix = modelMatrix; jsgb_ModelMatrix = mat4(1.0); modelViewMatrix = viewMatrix; normalMatrix = transpose(inverse(mat3(modelViewMatrix))); jsgb_main(); }';
    } else if (/\binstanceMatrix\b/.test(src) && !attrs.some(x => x.name === 'instanceMatrix')) lines.push('mat4 instanceMatrix = mat4(1.0);');
    lines.push(src, main);
    return {glsl: lines.join('\n'), uniforms, attributes: attrs, varyings: v.decls};
  }
  for (const d of v.decls) lines.push(`layout(location = ${location(d)}) in ${d.type} ${d.name}${d.array};`);
  lines.push('layout(location = 0) out vec4 jsgb_FragColor;');
  // Points draw as quads whose UVs are the corner, which is what gl_PointCoord means.
  lines.push('vec2 jsgb_PointCoord;', '#define gl_PointCoord jsgb_PointCoord');
  if (outs.decls[0]) lines.push(`#define ${outs.decls[0].name} jsgb_FragColor`); else lines.push('#define gl_FragColor jsgb_FragColor');
  if (glsl3) lines.push('#define varying in');
  if (/\blinearToOutputTexel\s*\(/.test(src) && !/vec4\s+linearToOutputTexel\s*\(/.test(src)) {
    lines.push('vec4 linearToOutputTexel(vec4 v) { return vec4(mix(pow(max(v.rgb, vec3(0.0)), vec3(0.41666)) * 1.055 - vec3(0.055), v.rgb * 12.92, lessThanEqual(v.rgb, vec3(0.0031308))), v.a); }');
  }
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

/** Split old combined texture/sampler function arguments into the objects the host accepts. */
export function modernSamplerParameters(src: string): string {
  const functions = new Map<string, {index: number; type: string; name: string}[]>();
  const declarations = /\b\w+\s+(\w+)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = declarations.exec(src))) {
    const {args, end} = callArgs(src, match.index + match[0].length - 1);
    if (!/^\s*[{;]/.test(src.slice(end))) continue;
    const textures = args.flatMap((arg, index) => {
      const m = /\b(sampler2D|samplerCUBE|sampler3D)\s+(\w+)\s*$/.exec(arg);
      return m ? [{index, type: m[1], name: m[2]}] : [];
    });
    if (textures.length) functions.set(match[1], textures);
  }
  if (!functions.size) return src;
  const rewrite = (text: string): string => {
    const calls = new RegExp(`\\b(${[...functions.keys()].join('|')})\\s*\\(`, 'g');
    let out = '', last = 0, m: RegExpExecArray | null;
    while ((m = calls.exec(text))) {
      const {args, end} = callArgs(text, m.index + m[0].length - 1);
      const parameters = functions.get(m[1])!;
      const expanded = args.flatMap((arg, index) => {
        const p = parameters.find(p => p.index === index);
        if (!p) return [rewrite(arg)];
        const declaration = /\b(sampler2D|samplerCUBE|sampler3D)\s+\w+\s*$/.test(arg);
        if (declaration) return [(p.type === 'sampler2D' ? 'Texture2D' : p.type === 'samplerCUBE' ? 'TextureCube' : 'Texture3D') + ' ' + p.name,
          'SamplerState ' + p.name + 'Sampler', ...(p.type === 'sampler2D' ? ['float ' + p.name + '_jsgbFlipY'] : [])];
        const value = arg.trim();
        return [value, value.replace(/^(\w+)/, '$1Sampler'), ...(p.type === 'sampler2D' ? [value.replace(/^(\w+)/, '$1_jsgbFlipY')] : [])];
      });
      out += text.slice(last, m.index) + m[0] + expanded.join(', ') + ')';
      last = end; calls.lastIndex = end;
    }
    return out + text.slice(last);
  };
  return rewrite(src);
}

/** three.js uploads an image with flipY set upside down, so v = 0 is the image's last row; Unreal keeps the first
 *  row at v = 0. Each 2D texture's samples flip v when its <name>_jsgbFlipY member is 1 (the host sets it per texture). */
function flipSamples(body: string, members: Member[]): string {
  const globals = members.filter(m => m.resource === 'tex').map(m => m.name);
  const parameters = [...body.matchAll(/Texture2D\s+(\w+)\s*,\s*SamplerState\s+\w+Sampler\s*,\s*float\s+\w+_jsgbFlipY/g)].map(m => m[1]);
  const textures = [...new Set([...globals, ...parameters])];
  if (!textures.length) return body;
  for (const t of globals) members.push({type: 'float', name: t + '_jsgbFlipY', array: ''});
  const rx = new RegExp(`\\b(${textures.join('|')})\\.(Sample|SampleLevel|SampleBias|SampleGrad)\\s*\\(`, 'g');
  let out = '', last = 0, m: RegExpExecArray | null;
  while ((m = rx.exec(body))) {
    const {end, args} = callArgs(body, m.index + m[0].length - 1);
    if (args.length < 2) continue;
    args[1] = `jsgbFlipUV(${args[1]}, ${m[1]}_jsgbFlipY)`;
    out += body.slice(last, m.index) + `${m[1]}.${m[2]}(${args.join(', ')})`;
    last = end; rx.lastIndex = end;
  }
  if (!last) return body;
  return 'float2 jsgbFlipUV(float2 c, float f) { return float2(c.x, f > 0.5 ? 1.0 - c.y : c.y); }\n' + out + body.slice(last);
}
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
  let body = flipSamples(modernSampling(modernSamplerParameters(src)).trim(), members);
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
const VERSION = typeof __JSGB_SHADER_VERSION__ === 'string' ? __JSGB_SHADER_VERSION__ : 'dev';
// Packages carry complete translations. A live cache miss runs entirely on a background thread;
// the exporter keeps its generic material until the reply arrives, then sends the finished material.
let translationsThisFrame = 0;
export function newShaderFrame() { translationsThisFrame = 0; }
function textHash(s: string) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995) ^ (b >>> 13); }
  return (a >>> 0).toString(16) + (b >>> 0).toString(16) + s.length.toString(16);
}
/** The generated-material description for a ShaderMaterial; undefined while the compiler loads, null when it cannot be translated. */
const pendingTranslations = new Map<string, string>();
let shaderWorker: BackgroundWorker | null | undefined;
const shaderStats = {queued: 0, completed: 0, failed: 0, pending: 0, lastKey: '', lastCompileMs: 0, lastReplyMs: 0};
(globalThis as any).__jsgbShaderStats = shaderStats;
function backgroundTranslation(key: string, diskKey: string, material: THREE.ShaderMaterial, instanced: any) {
  if (pendingTranslations.has(key)) return undefined;
  if (shaderWorker === undefined) {
    try { shaderWorker = host.backgroundWorker?.('/jsgb/shader-worker.js', 'shader translator') ?? null; }
    catch (e) { shaderWorker = null; host.log('warn', `background shader compiler could not start: ${e}`); }
    if (shaderWorker) {
      shaderWorker.onmessage = ({data}) => {
        const disk = pendingTranslations.get(data.key);
        if (!disk) return;
        const started = Date.now();
        const result = data.result as TranslatedShader | null;
        if (result && (result.key !== data.key || typeof result.hlsl !== 'string')) return;
        cache.set(data.key, result);
        host.storage?.save(disk, JSON.stringify(result ?? {failed: true}));
        pendingTranslations.delete(data.key);
        shaderStats.pending = pendingTranslations.size;
        shaderStats.lastKey = data.key; shaderStats.lastCompileMs = data.ms;
        if (result) shaderStats.completed++; else shaderStats.failed++;
        shaderStats.lastReplyMs = Date.now() - started;
        host.log(result ? 'log' : 'warn', `shader ${data.key} ${result ? 'translated' : 'failed'} on background worker in ${data.ms} ms; reply ${shaderStats.lastReplyMs} ms`);
      };
      shaderWorker.onerror = error => {
        host.log('warn', `background shader compiler: ${error.message ?? error}`);
        for (const k of pendingTranslations.keys()) cache.set(k, null);
        shaderStats.failed += pendingTranslations.size;
        pendingTranslations.clear(); shaderStats.pending = 0;
        shaderWorker?.terminate(); shaderWorker = null;
      };
    } else host.log('warn', 'Background shader compiler is unavailable; missing shaders use the fallback material. Repackage with a current host.');
  }
  if (!shaderWorker) { cache.set(key, null); return null; }
  pendingTranslations.set(key, diskKey); shaderStats.queued++; shaderStats.pending = pendingTranslations.size;
  shaderWorker.postMessage({key, material: {
    name: material.name, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader,
    defines: material.defines, isRawShaderMaterial: material.isRawShaderMaterial,
    vertexColors: material.vertexColors, glslVersion: material.glslVersion,
  }, instanced: instanced ? {color: !!instanced.color, extras: (instanced.extras ?? []).map((e: any) => ({name: e.name, size: e.size, offset: e.offset}))} : undefined});
  return undefined;
}
const vertexUses = new Map<string, {matrix: boolean; color: boolean}>();
export function translateShaderMaterial(material: THREE.ShaderMaterial, instanced?: {color: boolean; extras?: {name: string; size: number; offset: number}[]}): TranslatedShader | null | undefined {
  // Drawn on an InstancedMesh, a vertex shader that reads instanceMatrix, instanceColor or per-instance attributes
  // translates differently (see prepare and the attribute glue below).
  const vertex = material.vertexShader ?? '';
  let uses = vertexUses.get(vertex);
  if (!uses) { if (vertexUses.size > 512) vertexUses.clear(); uses = {matrix: /\binstanceMatrix\b/.test(vertex), color: /\binstanceColor\b/.test(vertex)}; vertexUses.set(vertex, uses); }
  const instancing = {matrix: !!instanced && uses.matrix, color: !!instanced?.color && uses.color};
  const extras = (instanced?.extras ?? []).filter(e => new RegExp(`\\b${e.name}\\b`).test(vertex));
  const source = sourceEntry(material);
  const key = source.key + (instancing.matrix ? '_i' : '') + (instancing.color ? '_c' : '') + (extras.length ? '_x' + String(textHash(extras.map(e => `${e.name}${e.size}@${e.offset}`).join(','))).slice(0, 6) : '');
  if (cache.has(key)) return cache.get(key);
  const diskKey = 'jsgb-translated-' + VERSION + ':' + key + ':' + source.full;
  const saved = host.storage?.load(diskKey);
  if (saved) {
    try {
      const t = JSON.parse(saved) as TranslatedShader | {failed: true};
      if ('failed' in t) { cache.set(key, null); return null; }
      if (t.key === key && typeof t.hlsl === 'string') { cache.set(key, t); return t; }
    } catch { /* translated again below */ }
  }
  if (!host.shaderPreparation) return backgroundTranslation(key, diskKey, material, instanced);
  if (translationsThisFrame > 0) return undefined;
  translationsThisFrame++;
  let vs: ReturnType<typeof prepare>, fs: ReturnType<typeof prepare>;
  try { vs = prepare(material, 'vertex', instancing); fs = prepare(material, 'fragment'); } catch (error) {
    host.log('warn', `custom shader ${material.name || key} stays generic: ${error instanceof Error ? error.message : error}`);
    cache.set(key, null);
    host.storage?.save(diskKey, '{"failed":true}');
    return null;
  }
  // Compiled stages persist in the host store, so a reload or relaunch skips the compiler.
  // Translations are stored across launches; the key names the translator build (Tools/jsgb.mjs hashes this file and the
  // shader compiler), so a newer bridge never reuses an older bridge's HLSL.
  const stageKey = (glsl: string, label: string) => 'jsgb-shader-' + (typeof __JSGB_SHADER_VERSION__ === 'string' ? __JSGB_SHADER_VERSION__ : 'dev') + ':' + label + ':' + textHash(glsl);
  const compiled = (out: string) => /\bvoid\s+(vert|frag)_main\b/.test(out);
  const stored = (glsl: string, label: string) => { const out = host.storage?.load(stageKey(glsl, label)) ?? ''; return compiled(out) ? out : ''; };
  let vh = stored(vs.glsl, 'vertex'), fh = stored(fs.glsl, 'fragment');
  const c = vh && fh ? null : crossShader();
  if (!c && !(vh && fh)) { if (c === undefined) translationsThisFrame = 0; return c === null ? null : undefined; }
  const started = Date.now();
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
        if (m.name.endsWith('_jsgbFlipY')) {
          if (!seen.has(m.name)) { seen.add(m.name); inputs.push({name: 'U_' + m.name, source: 'scalar', param: m.name}); }
          glue.push(`${target}.${m.name} = U_${m.name};`);
          continue;
        }
        // SPIRV-Cross puts an underscore before a name HLSL reserves (noise, line, point, ...).
        const decl = [...vsDecls, ...fsDecls].find(d => d.name === m.name) ?? [...vsDecls, ...fsDecls].find(d => '_' + d.name === m.name);
        if (!decl) continue;
        if (m.resource) {
          if (!seen.has(m.name)) { seen.add(m.name); inputs.push({name: 'T_' + m.name, source: m.resource === 'cube' ? 'cube' : m.resource === 'volume' ? 'volume' : 'texture', param: decl.name}); }
          glue.push(`${target}.${m.name} = T_${m.name}; ${target}.${m.name}Sampler = T_${m.name}Sampler;`);
          continue;
        }
        const n = /^(?:float|int|uint|bool)(\d)$/.exec(m.type)?.[1];
        const scalar = /^(float|int|uint|bool|half)$/.test(m.type);
        if (!scalar && !n) continue; // matrices and structs keep their zero value
        if (!seen.has(m.name)) { seen.add(m.name); inputs.push({name: 'U_' + m.name, source: scalar ? 'scalar' : 'vector', param: decl.name}); }
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
    if (vs.attributes.some(d => d.name === 'instanceColor') && has(V, 'instanceColor')) { inputs.push({name: 'JsgbIC', source: 'instanceColor'}); glue.push('vs.instanceColor = JsgbIC.xyz;'); }
    // The shader's own attributes come from the UV channels the geometry export put them in.
    for (const d of vs.attributes) {
      if (!isExtraAttribute(d.name) || !has(V, d.name)) continue;
      // Per-instance attributes are per-instance custom data, after the instance colour's three floats.
      const extra = instanced?.extras?.find(e => e.name === d.name);
      if (extra) {
        const parts = Array.from({length: extra.size}, (_, k) => `JsgbI_${d.name}${k}`);
        parts.forEach((name, k) => inputs.push({name, source: 'instanceData', index: 3 + extra.offset + k}));
        glue.push(`vs.${d.name} = ${extra.size === 1 ? parts[0] : `float${extra.size}(${parts.join(', ')})`};`);
        continue;
      }
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
    for (const m of F.members) if (has(V, m.name) && !(m.name in BUILTIN_UNIFORMS) && !m.resource && !DERIVED.includes(m.name) && fs.varyings.some(d => d.name === m.name || '_' + d.name === m.name)) glue.push(`fs.${m.name} = vs.${m.name};`);
    if (has(F, 'gl_FragCoord')) glue.push('fs.gl_FragCoord = Parameters.SvPosition;');
    if (has(F, 'jsgb_PointCoord')) glue.push('fs.jsgb_PointCoord = JsgbUV;');
    if (has(F, 'gl_FrontFacing')) glue.push('fs.gl_FrontFacing = Parameters.TwoSidedSign > 0;');
    glue.push(`fs.${F.entry}();`, 'return fs.jsgb_FragColor;');
    const hlsl = [V.types + F.types, V.struct, F.struct, ...vsGlue, ...glue].filter(Boolean).join('\n');
    // Vertex stage: the shader's own gl_Position, taken back to a world position, becomes Unreal's
    // world position offset (billboards, view-space quads). The view-space point is solved from the
    // projection's columns (JsgbPr0-3): for a perspective camera clip.w is exactly -z. Multiplying by
    // the inverse projection instead loses most of the depth in floats (clip z is close to clip w far
    // away), which pushed surfaces tens of units back, so lines behind them showed through.
    const vertexInputs: ShaderInput[] = [...vsInputs.filter(i => !i.name.startsWith('T_')),
      ...[0, 1, 2, 3].map(i => ({name: `JsgbW${i}`, source: 'collection' as const, param: `CamCol${i}`})), {name: 'JsgbWorld', source: 'worldPosition'}];
    const vertexHlsl = vsInputs.some(i => i.name.startsWith('T_')) || standardVertexTransform(material.vertexShader) ? '' : [V.types, V.struct, ...vsGlue,
      'float4 jsgbC = vs.gl_Position; float3 jsgbV;',
      'if (abs(JsgbPr2.w) > 0.5) { jsgbV.z = jsgbC.w / JsgbPr2.w; jsgbV.x = (jsgbC.x - JsgbPr2.x * jsgbV.z) / JsgbPr0.x; jsgbV.y = (jsgbC.y - JsgbPr2.y * jsgbV.z) / JsgbPr1.y; }',
      'else { float jsgbInvW = 1.0 / (abs(jsgbC.w) > 1e-8 ? jsgbC.w : 1e-8); jsgbV.z = (jsgbC.z * jsgbInvW - JsgbPr3.z) / JsgbPr2.z; jsgbV.x = (jsgbC.x * jsgbInvW - JsgbPr3.x) / JsgbPr0.x; jsgbV.y = (jsgbC.y * jsgbInvW - JsgbPr3.y) / JsgbPr1.y; }',
      'float3 jsgbT = (jsgbV.x * JsgbW0 + jsgbV.y * JsgbW1 + jsgbV.z * JsgbW2 + JsgbW3).xyz;',
      'float3 jsgbOffset = float3(jsgbT.x, jsgbT.z, jsgbT.y) * 100.0 - JsgbWorld;',
      'return any(isnan(jsgbOffset)) || dot(jsgbOffset, jsgbOffset) < 1e-4 ? float3(0, 0, 0) : jsgbOffset;'].filter(Boolean).join('\n');
    result = {key, hlsl, inputs, vertexHlsl, vertexInputs};
    host.storage?.save(diskKey, JSON.stringify(result));
    host.log('log', `shader ${key} translated in ${Date.now() - started} ms; kept on disk for later launches`);
  } catch (error) {
    host.log('warn', `custom shader ${material.name || key} stays generic: ${error instanceof Error ? error.message : error}`);
    host.storage?.save(diskKey, '{"failed":true}');
  }
  cache.set(key, result);
  return result;
}

/** onBeforeCompile on a built-in material (MeshStandardMaterial and the rest): the game edits three's own
 *  shader source at compile time. The edited source is rebuilt here as three would build it, then cut where
 *  lighting starts, so the generated material computes the surface colour and alpha exactly as the game's
 *  shader does (colour, texture and alpha edits, discards, vertex displacement) and Unreal lights the result.
 *  Edits to the lighting itself are not carried over. */
export type HookedShader = {vertexShader: string; fragmentShader: string; uniforms: Record<string, {value: unknown}>; defines: Record<string, unknown>};
const UNLIT_HOOKED = new Set(['MeshBasicMaterial', 'MeshMatcapMaterial', 'MeshNormalMaterial']);
const HOOKABLE = new Set(['MeshBasicMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshToonMaterial', 'MeshMatcapMaterial', 'MeshNormalMaterial']);
const NO_LIGHTS = ['NUM_DIR_LIGHTS', 'NUM_SPOT_LIGHTS', 'NUM_RECT_AREA_LIGHTS', 'NUM_POINT_LIGHTS', 'NUM_HEMI_LIGHTS', 'NUM_DIR_LIGHT_SHADOWS', 'NUM_POINT_LIGHT_SHADOWS',
  'NUM_SPOT_LIGHT_SHADOWS', 'NUM_SPOT_LIGHT_MAPS', 'NUM_SPOT_LIGHT_COORDS', 'NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS', 'NUM_CLIPPING_PLANES', 'UNION_CLIPPING_PLANES', 'NUM_LIGHT_PROBES'];
// Where the surface is complete and lighting begins, in each built-in fragment shader.
const LIGHTING_STARTS = [/^[ \t]*#include <normal_fragment_begin>/m, /^[ \t]*#include <lights_/m, /^[ \t]*#include <aomap_fragment>/m, /^[ \t]*#ifdef USE_LIGHTMAP/m, /^[ \t]*#include <opaque_fragment>/m];
const MAPS: [string, string][] = [['map', 'MAP'], ['alphaMap', 'ALPHAMAP'], ['emissiveMap', 'EMISSIVEMAP'], ['roughnessMap', 'ROUGHNESSMAP'], ['metalnessMap', 'METALNESSMAP'], ['specularMap', 'SPECULARMAP'], ['aoMap', 'AOMAP']];
const hookedSource = new WeakMap<object, {key: string; material: THREE.ShaderMaterial}>();
// The rebuilt sources by key, shared by every material with the same hook and defines (each keeps its own uniforms).
const hookedText = new Map<string, {vertex: string; fragment: string} | null>();

/** Built-in uniform values from the material's own properties, as WebGLRenderer sets them each frame. */
const SCALARS = ['roughness', 'metalness', 'shininess', 'alphaTest', 'reflectivity', 'aoMapIntensity'];
export function fillBuiltinUniforms(material: THREE.Material, u: Record<string, {value: any}>) {
  const m = material as Record<string, any>;
  const set = (k: string, v: unknown) => { if (u[k] && v !== undefined) u[k].value = v; };
  if (m.color?.isColor) set('diffuse', m.color);
  set('opacity', m.opacity);
  if (m.emissive?.isColor && u.emissive) { const e = u.emissive.value?.isColor ? u.emissive.value : (u.emissive.value = m.emissive.clone()); e.copy(m.emissive).multiplyScalar(m.emissiveIntensity ?? 1); }
  if (m.specular?.isColor) set('specular', m.specular);
  for (const k of SCALARS) if (typeof m[k] === 'number') set(k, m[k]);
  for (const [k] of MAPS) set(k, m[k] ?? null);
  // Texture transforms travel as two rows (the material parameters carry vectors, not matrices), with
  // three's flipY applied: Unreal textures keep the image's first row at v = 0.
  for (const [k, k0, k1] of mapTransformKeys()) {
    const r0 = u[k0], r1 = u[k1];
    if (!r0 || !r1) continue;
    const t = m[k] as THREE.Texture | null;
    if (t?.matrixAutoUpdate) t.updateMatrix();
    const e = t ? t.matrix.elements : IDENTITY3;
    // Set in place: this runs for every patched material every frame.
    const v0 = r0.value?.isVector3 ? r0.value : (r0.value = new THREE.Vector3()), v1 = r1.value?.isVector3 ? r1.value : (r1.value = new THREE.Vector3());
    v0.set(e[0], e[3], e[6]);
    if (t?.flipY !== false) v1.set(-e[1], -e[4], 1 - e[7]); else v1.set(e[1], e[4], e[7]);
  }
}
const IDENTITY3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
let transformKeys: [string, string, string][] | null = null;
const mapTransformKeys = () => transformKeys ??= MAPS.map(([k]) => [k, `${k}Transform_r0`, `${k}Transform_r1`] as [string, string, string]);

/** The generated-material description for a built-in material patched in onBeforeCompile, or null/undefined as translateShaderMaterial. */
export function translateHookedMaterial(material: THREE.Material, hooked: HookedShader, hookKey: string, instancing?: {color: boolean}): TranslatedShader | null | undefined {
  if (!HOOKABLE.has(material.type)) return null;
  const m = material as Record<string, any>;
  const defines: Record<string, unknown> = {...hooked.defines, ...(m.defines ?? {})};
  for (const k of NO_LIGHTS) defines[k] = 0;
  for (const [k, d] of MAPS) if (m[k]) { defines[`USE_${d}`] = ''; defines[`${d}_UV`] = 'uv'; defines.USE_UV = ''; }
  if (m.vertexColors) defines.USE_COLOR = '';
  if (m.alphaTest > 0) defines.USE_ALPHATEST = '';
  if (m.flatShading) defines.FLAT_SHADED = '';
  if (m.side === THREE.DoubleSide) defines.DOUBLE_SIDED = '';
  // On an InstancedMesh: Unreal's model matrix already holds each instance's transform, so instanceMatrix is
  // the identity, and instance colours arrive per instance.
  if (instancing) { defines.USE_INSTANCING = ''; if (instancing.color) { defines.USE_INSTANCING_COLOR = ''; defines.USE_COLOR = ''; } }
  const key = `${hookKey}|${material.type}|${JSON.stringify(defines)}`;
  let cached = hookedSource.get(material);
  if (!cached || cached.key !== key) {
    let text = hookedText.get(key);
    if (text === undefined) {
      // Texture transforms: mat3 uniforms become two vec3 rows.
      const rows = (s: string) => s.replace(/uniform\s+mat3\s+(\w+Transform)\s*;/g, 'uniform vec3 $1_r0; uniform vec3 $1_r1;')
        .replace(/\(\s*(\w+Transform)\s*\*\s*vec3\(\s*(\w+)\s*,\s*1(?:\.0)?\s*\)\s*\)\s*\.xy/g, 'vec2( dot( $1_r0, vec3( $2, 1.0 ) ), dot( $1_r1, vec3( $2, 1.0 ) ) )');
      const vertex = rows(expandIncludes(hooked.vertexShader));
      let fragment = rows(expandIncludes(hooked.fragmentShader.replace(/^[ \t]*#include <(normal_fragment_begin|lights_\w+|aomap_fragment|opaque_fragment)>/gm, '__JSGB_CUT_$1__')));
      fragment = fragment.replace(/__JSGB_CUT_(\w+)__/g, '#include <$1>');
      const main = fragment.search(/\bvoid\s+main\s*\(/);
      const cuts = LIGHTING_STARTS.map(rx => { const at = fragment.slice(main).search(rx); return at < 0 ? Infinity : main + at; });
      const cut = Math.min(...cuts);
      text = null;
      if (main >= 0 && cut !== Infinity) {
        let kept = fragment.slice(0, cut);
        // Close any #if blocks the cut left open inside main.
        const body = kept.slice(main);
        const open = (body.match(/^[ \t]*#if/gm) ?? []).length - (body.match(/^[ \t]*#endif/gm) ?? []).length;
        for (let i = 0; i < open; i++) kept += '\n#endif';
        kept += '\n\tgl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );\n}\n';
        text = {vertex, fragment: kept};
      }
      if (hookedText.size > 256) hookedText.clear();
      hookedText.set(key, text);
    }
    if (!text) return null;
    const {vertex, fragment: kept} = text;
    const uniforms = hooked.uniforms;
    for (const [k] of MAPS) if (vertex.includes(` ${k}Transform_r0;`)) {
      uniforms[`${k}Transform_r0`] ??= {value: new THREE.Vector3(1, 0, 0)}; uniforms[`${k}Transform_r1`] ??= {value: new THREE.Vector3(0, 1, 0)};
    }
    const synthetic = {isShaderMaterial: true, name: material.name, vertexShader: vertex, fragmentShader: kept, defines, uniforms,
      vertexColors: !!m.vertexColors, glslVersion: null, isRawShaderMaterial: false} as unknown as THREE.ShaderMaterial;
    cached = {key, material: synthetic};
    hookedSource.set(material, cached);
  }
  fillBuiltinUniforms(material, hooked.uniforms as Record<string, {value: any}>);
  const t = translateShaderMaterial(cached.material);
  if (t) t.lit = !UNLIT_HOOKED.has(material.type);
  return t;
}

// Internal packaging hook: materials gathered during the scripted views also cover off-camera objects.
const preparedNative = new Set<string>();
(globalThis as any).__jsgbPrepareMaterials = () => {
  const pending: string[] = [], failed: string[] = [];
  for (const m of (globalThis as any).__jsgbPackagingMaterials ?? []) {
    newShaderFrame();
    const t = translateShaderMaterial(m);
    const name = m.name || sourceEntry(m).key;
    if (t === undefined) pending.push(name);
    else if (t === null) failed.push(name);
    else {
      const variant = `${t.key}:${m.blending}:${m.transparent}:${m.side}`;
      if (!preparedNative.has(variant)) {
        preparedNative.add(variant);
        host.sink.shader?.(t.key, JSON.stringify(t));
        host.sink.material(-preparedNative.size, JSON.stringify({type: 'ShaderMaterial', shader: true, custom: t.key,
          unlit: !t.lit, blending: m.blending, transparent: m.transparent, side: m.side, color: [1, 1, 1], opacity: 1}));
      }
    }
  }
  return {pending, failed};
};
