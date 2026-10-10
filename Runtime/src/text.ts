import {host} from './host';
import {setTextRasterizer, type TextRun} from './canvas2d';

/** Canvas text through the host's FreeType rasterizer. A CSS font string picks the game's own
 *  @font-face file (TTF/OTF, listed by the build in /jsgb/fonts.json) or the engine's Roboto. */
type Face = {family: string; weight: number; style: string; url: string};
let faces: Face[] | null = null;
function gameFaces(): Face[] {
  if (!faces) {
    try { const b = host.readFile('/jsgb/fonts.json'); faces = b ? JSON.parse(new TextDecoder().decode(b)) as Face[] : []; } catch { faces = []; }
  }
  return faces;
}

const WEIGHTS: Record<string, number> = {normal: 400, bold: 700, bolder: 800, lighter: 300};
function parseFont(font: string) {
  const m = /^\s*((?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3}|[\w-]+)\s+)*?)(\d+(?:\.\d+)?)(px|pt|em|rem)(?:\s*\/\s*[^\s]+)?\s+(.+?)\s*$/.exec(font);
  if (!m) return {size: 10, weight: 400, italic: false, families: ['sans-serif']};
  const words = m[1].trim().split(/\s+/).filter(Boolean);
  const weightWord = words.find(w => /^\d{3}$/.test(w) || w in WEIGHTS);
  const unit = m[3], value = parseFloat(m[2]);
  return {size: unit === 'pt' ? value * 4 / 3 : unit === 'px' ? value : value * 16, weight: weightWord ? (WEIGHTS[weightWord] ?? +weightWord) : 400,
    italic: words.includes('italic') || words.includes('oblique'), families: m[4].split(',').map(f => f.trim().replace(/^['"]|['"]$/g, ''))};
}

function fontFile(font: string): {path: string; size: number} {
  const f = parseFont(font);
  for (const family of f.families) {
    const matches = gameFaces().filter(x => x.family.toLowerCase() === family.toLowerCase());
    if (!matches.length) continue;
    matches.sort((a, b) => (Number(a.style === 'italic') !== Number(f.italic) ? 1000 : 0) + Math.abs(a.weight - f.weight) - ((Number(b.style === 'italic') !== Number(f.italic) ? 1000 : 0) + Math.abs(b.weight - f.weight)));
    return {path: matches[0].url, size: f.size};
  }
  const mono = f.families.some(x => /mono|courier|consol/i.test(x));
  const name = mono ? 'DroidSansMono.ttf' : `Roboto-${f.weight >= 800 ? 'Black' : f.weight >= 700 ? 'Bold' : f.weight >= 500 ? 'Medium' : f.weight <= 300 ? 'Light' : f.italic ? '' : 'Regular'}${f.italic && !mono ? 'Italic' : ''}.ttf`;
  return {path: '@engine/' + name, size: f.size};
}

const cache = new Map<string, TextRun | null>();
setTextRasterizer((font, text) => {
  const key = font + '\u0000' + text;
  if (cache.has(key)) return cache.get(key)!;
  let run: TextRun | null = null;
  const rasterize = host.text;
  if (rasterize && text) {
    const {path, size} = fontFile(font);
    const bytes = rasterize(path, size, text);
    if (bytes && bytes.byteLength > 20) {
      const head = new Float32Array(bytes, 0, 5);
      run = {width: head[0], height: head[1], ascent: head[2], descent: head[3], advance: head[4], alpha: new Uint8Array(bytes, 20)};
    }
  }
  if (cache.size > 1024) cache.delete(cache.keys().next().value!);
  cache.set(key, run);
  return run;
});
