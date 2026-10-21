import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const safeName = value => value.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 100) + '_' + hash(value).slice(0, 8);
const objectPath = (directory, name) => `${directory}/${name}.${name}`;

// Produce separate registries: shared event names such as "rifle" keep their
// original spelling while each game resolves them to its own Unreal content.
export async function registerAudio(handoffs, {readFile = filename => fs.readFile(filename)} = {}) {
  const result = {version: 1, units: 'centimeters', games: {}};
  for (const handoff of handoffs) {
    const {game} = handoff;
    const audioPass = handoff.audioPass ?? 4;
    if (!Number.isInteger(audioPass) || audioPass < 1) throw Error('Invalid audio pass');
    if (!['hardburn', 'karvos', 'unlit'].includes(game) || result.games[game]) throw Error('Invalid or duplicate game: ' + game);
    if (handoff.version !== 1 || !handoff.cues || !Object.keys(handoff.cues).length) throw Error('Empty or unsupported audio handoff');
    const directory = '/JsGameBridge/Audio/' + ({hardburn: 'HardBurn', karvos: 'Karvos', unlit: 'UnlitWorlds'}[game]);
    const scale = handoff.unitsToCentimeters ?? 100;
    if (!Number.isFinite(scale) || scale <= 0) throw Error('Invalid coordinate scale');
    const cues = {}, aliases = {...handoff.aliases}, sourceDocuments = {};
    for (const [key, definition] of Object.entries(handoff.cues).sort(([a], [b]) => a.localeCompare(b))) {
      if (!key || key.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Invalid event key');
      if (typeof definition.loop !== 'boolean' || typeof definition.spatial !== 'boolean' || !definition.bus) throw Error('Missing loop/spatial/bus semantics: ' + key);
      const files = [...new Set(definition.files)];
      if (!files.length || files.length > 32) throw Error('Cue needs 1–32 variants: ' + key);
      if (!definition.licence && !definition.provenance) throw Error('Missing source licence: ' + key);
      if (definition.sourceManifest && !sourceDocuments[definition.sourceManifest]) {
        const document = await readFile(definition.sourceManifest);
        const text = document.toString('utf8');
        sourceDocuments[definition.sourceManifest] = {sha256: hash(document), document: /\.json$/i.test(definition.sourceManifest) ? JSON.parse(text) : text};
      }
      const variants = [];
      for (const source of files) {
        if (!/^[A-Za-z]:[\\/]/.test(source) || !/\.ogg$/i.test(source)) throw Error('Expected an absolute compressed game source: ' + source);
        const data = await readFile(source);
        if (data.subarray(0, 4).toString() !== 'OggS') throw Error('Not an OGG source: ' + source);
        // Deduplicate waves shared by aliases/body/tail cues without conflating
        // recordings that happen to have identical basenames in two folders.
        const waveName = 'SW_' + safeName(source.replace(/\\/g, '/'));
        variants.push({source: source.replace(/\\/g, '/'), wave: objectPath(directory + '/Waves', waveName), sha256: hash(data)});
      }
      const minDistance = (definition.near ?? 3) * scale;
      const maxDistance = (definition.far ?? 100) * scale;
      if (!Number.isFinite(minDistance) || !Number.isFinite(maxDistance) || minDistance < 0 || maxDistance <= minDistance) throw Error('Invalid attenuation distances: ' + key);
      const name = 'SC_' + safeName(key);
      const {files: ignoredFiles, ...metadata} = definition;
      cues[key] = {...metadata, sound: objectPath(directory, name), variants, minDistance, maxDistance, volume: 1, pitch: 1};
    }
    const resolve = (key, seen = new Set()) => {
      if (Object.hasOwn(cues, key)) return key;
      if (seen.has(key) || !Object.hasOwn(aliases, key)) throw Error('Broken or cyclic cue alias: ' + key);
      seen.add(key); return resolve(aliases[key], seen);
    };
    for (const alias of Object.keys(aliases)) {
      if (Object.hasOwn(cues, alias) || ['__proto__', 'constructor', 'prototype'].includes(alias)) throw Error('Alias collides with a cue: ' + alias);
      aliases[alias] = resolve(alias);
    }
    const {version: ignoredVersion, game: ignoredGame, cues: ignoredCues, aliases: ignoredAliases, ...gameMetadata} = handoff;
    result.games[game] = {...gameMetadata, audioPass, unitsToCentimeters: scale, sourceCommit: handoff.sourceCommit ?? null, sourceDocuments, cues, aliases};
  }
  return result;
}

export function registryForGame(manifest, game) {
  const entry = manifest.games[game];
  if (!entry) throw Error('Unknown audio registry game: ' + game);
  const assets = {};
  for (const [key, cue] of Object.entries(entry.cues)) {
    assets[key] = {sound: cue.sound, loop: cue.loop, spatial: cue.spatial, bus: cue.bus, minDistance: cue.minDistance, maxDistance: cue.maxDistance};
  }
  for (const [alias, key] of Object.entries(entry.aliases)) assets[alias] = {...assets[key]};
  return {version: 1, game, audioPass: entry.audioPass, sourceCommit: entry.sourceCommit, eventControls: entry.eventControls ?? entry.mixerParity?.eventControls ?? {}, mix: entry.mix ?? entry.mixerMetadata ?? entry.mixerParity ?? {}, ...(entry.mixerParity ? {mixerParity: entry.mixerParity} : {}), ...(entry.limits ? {limits: entry.limits} : {}), assets};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputOption = process.argv.slice(2).find(value => value.startsWith('--out='));
  const outputName = outputOption?.slice(6) ?? 'audio-cues-v4.json';
  if (!/^[A-Za-z0-9_-]+\.json$/.test(outputName)) throw Error('Output must be a manifest filename');
  const filenames = process.argv.slice(2).filter(value => value !== outputOption);
  if (filenames.length < 2 || filenames.length > 3) throw Error('Usage: node register-audio.mjs karvos-handoff.json unlit-handoff.json [hardburn-handoff.json] [--out=audio-cues-vN.json]');
  const handoffs = await Promise.all(filenames.map(async filename => JSON.parse(await fs.readFile(filename, 'utf8'))));
  const manifest = await registerAudio(handoffs);
  const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../Registry');
  await fs.mkdir(directory, {recursive: true});
  const write = async (name, document) => {const target=path.join(directory,name),temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify(document,null,2)+'\n');await fs.rename(temporary,target);};
  await write(outputName,manifest);
  for (const game of Object.keys(manifest.games)) await write(game+'-sounds.json',registryForGame(manifest,game));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(manifest.games).map(([game, item]) => [game, {cues: Object.keys(item.cues).length, aliases: Object.keys(item.aliases).length, variants: Object.values(item.cues).reduce((n, cue) => n + cue.variants.length, 0)}]))));
}
