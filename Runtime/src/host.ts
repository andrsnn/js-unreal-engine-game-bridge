/** The native host the bundle runs inside. The Puerts bootstrap (Unreal) and the Node smoke harness
 *  both install `globalThis.__jsgbHost` before the bundle loads. Game code never calls this. */
export interface SceneSink {
  geometry(id: number, positions: ArrayBuffer, normals: ArrayBuffer | null, uvs: ArrayBuffer | null, colors: ArrayBuffer | null, colorSize: number, indices: ArrayBuffer | null, groups: string): void;
  releaseGeometry(id: number): void;
  /** A material or texture the game disposed of, or no longer holds: the host frees its Unreal copy. */
  releaseMaterial?(id: number): void;
  releaseTexture?(id: number): void;
  material(id: number, json: string): void;
  texture(id: number, json: string, bytes: ArrayBuffer | null): void;
  frame(floats: ArrayBuffer, count: number, instanceData: ArrayBuffer, instanceFloats: number): void;
  /** A custom shader translated to an Unreal material body, sent once per shader key. */
  shader?(key: string, json: string): void;
  /** One-shot and keyed events this frame (effects, sounds, camera shakes) as a JSON array. */
  events?(json: string): void;
}

export interface JsgbHost {
  /** Reads a file below the web build's site root ("/models/x.glb"); null when missing. */
  readFile(path: string): ArrayBuffer | null;
  /** Web Workers on their own threads: create returns 0 when the host runs workers on the game thread. */
  workerCreate?(source: string, url: string, name: string): number;
  workerPost?(id: number, bytes: ArrayBuffer): void;
  /** Replies since the last poll: [id, kind (0 message, 1 error), length, bytes padded to 4] repeated. */
  workerPoll?(): ArrayBuffer | null;
  workerTerminate?(id: number): void;
  /** Monotonic milliseconds. */
  now(): number;
  log(level: 'log' | 'warn' | 'error', text: string): void;
  /** location.search the web build would have (e.g. "?play"). */
  search: string;
  /** Log each drawn object's identity the first time it is drawn (-JsgbTraceMirror). */
  trace?: boolean;
  /** Restart the whole game (location.reload). */
  reload(): void;
  /** The game's entry module finished evaluating. */
  ready?(info: string): void;
  /** The display: modes and current settings as JSON, and a change as JSON (see display.ts). */
  display?: {modes(): string; get(): string; set(json: string): void};
  /** Unreal graphics: the current state as JSON {lumen, available}, and a change as JSON (see graphics.ts). */
  graphics?: {get(): string; set(json: string): void};
  /** Persistent key/value store for localStorage and sessionStorage. */
  storage?: {load(key: string): string | null; save(key: string, data: string): void};
  /** Bytes that outlive a hot reload (the JS environment restarts, the host keeps them). */
  cache?: {get(key: string): ArrayBuffer | null; put(key: string, bytes: ArrayBuffer): void};
  sink?: SceneSink;
  /** The game's DOM UI, serialized for the CEF overlay. */
  ui?: {publish(html: string): void; canvas?(id: string, width: number, height: number, rgba: ArrayBuffer): void};
  /** WebAudio voices as a JSON array of start/update/stop operations. */
  audio?: {voices(json: string): void; pcm?(id: number, samples: ArrayBuffer, sampleRate: number): void; preload?(path: string): void};
  /** Canvas text: alpha mask and metrics for a run (see JsgbBridge::Text). */
  text?(fontPath: string, sizePx: number, run: string): ArrayBuffer | null;
  /** Seed for Math.random (deterministic captures); 0 or absent keeps it random. */
  seed?: number;
  /** Milliseconds per frame when game time is stepped (deterministic captures); 0 or absent for real time. */
  fixedStepMs?: number;
  /** Asset registry JSON ({assets: {key: {mesh, material, niagara, sound}}}); empty when none. */
  registry?: string;
}

const g = globalThis as unknown as {__jsgbHost?: JsgbHost};
export const host: JsgbHost = g.__jsgbHost as JsgbHost;
if (!host) throw Error('JsGameBridge: __jsgbHost is missing. Load the bundle through the Unreal host or Tools/jsgb.mjs smoke.');

export type RegistryEntry = {mesh?: string; material?: string; materialKey?: string; niagara?: string; sound?: string; loop?: boolean; spatial?: boolean; bus?: string};
let registry: Record<string, RegistryEntry> | null = null;
export function assetRegistry(): Record<string, RegistryEntry> {
  if (!registry) {
    try { registry = (JSON.parse(host.registry || '{}').assets ?? {}) as Record<string, RegistryEntry>; }
    catch (error) { host.log('warn', 'asset registry unreadable: ' + error); registry = {}; }
  }
  return registry;
}

let swaps: {assets: boolean; effects: boolean} | null = null;
/** Which registry swaps the game turned on (registry.json "swaps", from Games/<game>.json). */
export function registrySwaps(): {assets: boolean; effects: boolean} {
  if (!swaps) {
    try { const j = JSON.parse(host.registry || '{}').swaps ?? {}; swaps = {assets: !!j.assets, effects: !!j.effects}; }
    catch { swaps = {assets: false, effects: false}; }
  }
  return swaps;
}
