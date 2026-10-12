/** Stand-in for THREE.WebGLRenderer on the Unreal target. Unreal draws the scene, so render calls
 *  only record what was drawn last; every other renderer API answers with plausible values. */
import {frameCount} from './frameCount';

const g = globalThis as Record<string, any>;
const COMPRESSED = new Set(['EXT_texture_compression_bptc', 'WEBGL_compressed_texture_s3tc', 'WEBGL_compressed_texture_s3tc_srgb']);

/** Any property is another callable no-op, so deep renderer internals (state.buffers.depth...) answer undefined. */
export function deepNoop(): any {
  const fn = function () { return undefined; };
  return new Proxy(fn, {get: (t, k) => k in t ? (t as any)[k] : k === Symbol.toPrimitive ? () => 0 : deepNoop(), set: () => true});
}

/** The scene Unreal mirrors: the latest Scene the main renderer drew with a perspective camera
 *  (into the screen or into a post-processing target), else the latest Scene it drew at all. */
/** linear: the view is drawn into a render target that post-processing shows (EffectComposer), not to the screen. */
export const lastFrame: {scene: unknown; camera: unknown; frame: number; renderer: unknown; linear: boolean} = {scene: null, camera: null, frame: 0, renderer: null, linear: false};
/** Post-processing the game asked for, read from its renderer and full-screen passes. */
export const post: Record<string, number> = {exposure: 1, toneMapping: 0, bloomStrength: 0, bloomRadius: 0, bloomThreshold: 1, bloomFrame: -1};
const renderers: Record<string, any>[] = [];
/** Scenes the game draws into render targets, by target: the latest scene and camera, and the animation frame. */
export const captures = new Map<Record<string, any>, {scene: Record<string, any>; camera: Record<string, any>; frame: number}>();
// The animation frame in which a perspective camera was last rendered.
let perspectiveFrame = -1;
function mainRenderer() {
  // The renderer whose canvas sits in the page and is largest is the game view.
  let best: Record<string, any> | null = null, area = -1;
  for (const r of renderers) { const c = r.domElement; const a = (c?.isConnected ? 1e9 : 0) + (c?.width ?? 0) * (c?.height ?? 0); if (a > area) { area = a; best = r; } }
  return best;
}
function notePost(scene: Record<string, any>) {
  // UnrealBloomPass and similar passes keep their settings in shader uniforms.
  const u = scene?.material?.uniforms; if (!u) return;
  if (u.bloomStrength) { post.bloomStrength = +u.bloomStrength.value || 0; post.bloomRadius = +u.bloomRadius?.value || 0; post.bloomFrame = lastFrame.frame; }
  if (u.luminosityThreshold) post.bloomThreshold = +u.luminosityThreshold.value;
}

export class UnrealRenderer {
  constructor(params: Record<string, unknown> = {}) {
    const canvas = (params.canvas as Record<string, any>) ?? g.document.createElement('canvas');
    let target: unknown = null, pixelRatio = 1, width = g.innerWidth, height = g.innerHeight;
    const clear = {r: 0, g: 0, b: 0}; let clearAlpha = 1;
    const info = {
      autoReset: true, programs: [] as unknown[],
      render: {frame: 0, calls: 0, triangles: 0, points: 0, lines: 0},
      memory: {geometries: 0, textures: 0, programs: 0},
      reset() { this.render.calls = this.render.triangles = this.render.points = this.render.lines = 0; },
    };
    const gl = new Proxy({}, {get: (_t, k) => k === 'getParameter' ? () => 0 : k === 'getExtension' ? () => null : k === 'getContextAttributes' ? () => ({alpha: false, antialias: true}) : k === 'isContextLost' ? () => false : k === 'drawingBufferWidth' ? width : k === 'drawingBufferHeight' ? height : () => undefined});
    const base: Record<string, unknown> = {
      isWebGLRenderer: true, isUnrealRenderer: true, domElement: canvas,
      autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true, sortObjects: true,
      localClippingEnabled: false, clippingPlanes: [], outputColorSpace: 'srgb', toneMapping: 0, toneMappingExposure: 1,
      transmissionResolutionScale: 1, useLegacyLights: false, coordinateSystem: 2000,
      shadowMap: {enabled: false, autoUpdate: true, needsUpdate: false, type: 1, render() {}, cullFace: 1},
      xr: {enabled: false, isPresenting: false, addEventListener() {}, removeEventListener() {}, setSession: async () => {}, getSession: () => null, setAnimationLoop() {}},
      debug: {checkShaderErrors: false, onShaderError: null},
      capabilities: {isWebGL2: true, maxSamples: 4, maxTextures: 16, maxVertexTextures: 16, maxTextureSize: 16384, maxCubemapSize: 16384, maxAttributes: 16,
        maxVertexUniforms: 4096, maxVaryings: 30, maxFragmentUniforms: 1024, precision: 'highp', logarithmicDepthBuffer: false, reverseDepthBuffer: false,
        vertexTextures: true, floatFragmentTextures: true, floatVertexTextures: true, getMaxAnisotropy: () => 16, getMaxPrecision: () => 'highp',
        textureFormatReadable: () => true, textureTypeReadable: () => true},
      // The GPU formats Unreal uploads as they are, as a desktop browser reports them: KTX2 and Basis
      // textures then arrive as BC7 or DXT instead of 4x larger RGBA.
      extensions: {get: (name: string) => COMPRESSED.has(name) ? {} : null, has: (name: string) => COMPRESSED.has(name), init() {}},
      properties: {get: (o: Record<string, unknown>) => (o.__jsgbProps ??= {}), remove() {}, update() {}, dispose() {}},
      state: deepNoop(),
      info,
      getContext: () => gl,
      getContextAttributes: () => ({alpha: false, antialias: true}),
      getPixelRatio: () => pixelRatio,
      setPixelRatio: (r: number) => { pixelRatio = r; },
      getSize: (v: {set(x: number, y: number): unknown}) => v.set(width, height),
      setSize: (w: number, h: number, updateStyle = true) => {
        width = w; height = h; canvas.width = Math.floor(w * pixelRatio); canvas.height = Math.floor(h * pixelRatio);
        if (updateStyle && canvas.style) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
      },
      getDrawingBufferSize: (v: {set(x: number, y: number): unknown}) => v.set(width * pixelRatio, height * pixelRatio),
      setDrawingBufferSize: (w: number, h: number, r: number) => { width = w; height = h; pixelRatio = r; },
      getViewport: (v: {set(a: number, b: number, c: number, d: number): unknown}) => v.set(0, 0, width, height),
      getScissor: (v: {set(a: number, b: number, c: number, d: number): unknown}) => v.set(0, 0, width, height),
      getScissorTest: () => false,
      getClearColor: (c: {setRGB(r: number, g: number, b: number): unknown}) => c.setRGB(clear.r, clear.g, clear.b),
      setClearColor: (c: {r?: number; g?: number; b?: number} | number, a = 1) => { if (typeof c === 'object' && c) { clear.r = c.r ?? 0; clear.g = c.g ?? 0; clear.b = c.b ?? 0; } clearAlpha = a; },
      getClearAlpha: () => clearAlpha,
      setClearAlpha: (a: number) => { clearAlpha = a; },
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => { target = t; },
      getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      render: (scene: Record<string, any>, camera: Record<string, any>) => {
        info.render.frame++;
        if (self !== mainRenderer()) return;
        g.__jsgbCanvas = canvas;
        post.exposure = (self as Record<string, any>).toneMappingExposure ?? 1; post.toneMapping = (self as Record<string, any>).toneMapping ?? 0;
        if (!scene?.isScene) { notePost(scene); return; }
        // A scene drawn into a render target that a material shows (a screen, a minimap) is a capture; Unreal
        // draws it with a scene capture, and it never replaces the game's view.
        const t = target as Record<string, any> | null;
        if (t?.texture) {
          captures.set(t, {scene, camera, frame: frameCount.animation});
          if (t.texture.__jsgbMapped) return;
        }
        const perspective = !!camera?.isPerspectiveCamera;
        // The scene Unreal mirrors: a perspective render, or an orthographic one in a frame without one. Within a
        // frame, an orthographic pass after the perspective scene is a HUD or overlay, not the view.
        if (perspective || perspectiveFrame !== frameCount.animation) { lastFrame.scene = scene; lastFrame.camera = camera; lastFrame.renderer = self; lastFrame.linear = !!t; lastFrame.frame++; }
        if (perspective) perspectiveFrame = frameCount.animation;
      },
      compile: () => new Set(), compileAsync: async () => {},
      setAnimationLoop: (fn: ((t: number) => void) | null) => { if (fn) { const loop = (t: number) => { fn(t); g.requestAnimationFrame(loop); }; g.requestAnimationFrame(loop); } },
      readRenderTargetPixels() {}, readRenderTargetPixelsAsync: async (_t: unknown, _x: number, _y: number, _w: number, _h: number, buffer: unknown) => buffer,
      copyFramebufferToTexture() {}, copyTextureToTexture() {}, copyTextureToTexture3D() {}, initTexture() {}, initRenderTarget() {},
      resetState() {}, dispose() {}, forceContextLoss() {}, clear() {}, clearColor() {}, clearDepth() {}, clearStencil() {},
      setViewport() {}, setScissor() {}, setScissorTest() {}, setOpaqueSort() {}, setTransparentSort() {}, renderBufferDirect() {},
      setEffects() {}, hasInitialized: () => true, init: async () => {},
    };
    const self = new Proxy(base, {
      get: (t, k: string) => k in t ? t[k] : (typeof k === 'string' && /^(get|has|is)/.test(k) ? () => undefined : () => {}),
      set: (t, k: string, v) => { t[k] = v; return true; },
    });
    renderers.push(self);
    base.dispose = () => { const i = renderers.indexOf(self); if (i >= 0) renderers.splice(i, 1); };
    return self as unknown as UnrealRenderer;
  }
}
