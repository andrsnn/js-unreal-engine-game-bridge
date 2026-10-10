/** Extra vertex attributes (a shader's own `attribute float intensity;` and the like) travel to
 *  Unreal in UV channels 1-7, so generated shader materials can read them per vertex. A name keeps
 *  its channel for the whole session; attributes wider than two floats take two channels. */
const BUILTIN = new Set(['position', 'normal', 'uv', 'color', 'tangent', 'skinIndex', 'skinWeight', 'instanceMatrix', 'instanceColor']);
const channels = new Map<string, {channel: number; size: number}>();
let next = 1;

export const isExtraAttribute = (name: string) => !BUILTIN.has(name);

/** The first UV channel holding attribute `name` (size 1-4), or null when the channels are used up. */
export function channelFor(name: string, size: number): {channel: number; size: number} | null {
  let c = channels.get(name);
  if (!c) {
    const need = size > 2 ? 2 : 1;
    if (next + need > 8) return null;
    c = {channel: next, size}; next += need; channels.set(name, c);
  }
  return c;
}
