# Lumen mode: original models, Lumen and Unreal effects

A game running through the bridge can look better in Unreal than in the browser without changing its JavaScript.
Lumen mode does it, and the player turns it on and off while playing. Every game starts with it off, drawn as in
the browser. With it on:

- **Unreal's own lighting.** Lumen global illumination and reflections, a sky light, the game's directional lights
  as suns with soft virtual shadow maps, and volumetric fog.
- **Asset overrides.** A file named `overrides.json` beside the game's `publication.json` swaps three.js meshes
  for Unreal assets, such as Nanite meshes with full PBR materials. The game still places, turns, scales and hides
  every object. With no file, nothing is swapped.
- **Unreal effects.** Each one has its own switch in `overrides.json` (see below).

How to switch it:

- **F9** in any game.
- **A game's options menu**, through `window.jsgb.graphics`: `get()` returns `{lumen, available}`, `set({lumen})`
  changes it, and a `jsgbgraphicschange` event on `window` follows every change. Hard Burn gets a "Lumen lighting"
  row in Options > Display from `Games/adapters/hardburn-options.js`, an adapter the bridge adds to the game's
  build (Games/<game>.json `"adapters"`), so the game's own files stay as they are.
- **`-JsgbLumen`** starts a run with it on (`run-unreal.mjs --lumen`), and `-JsgbLumen=light` is a cheaper preset.
  `-JsgbNoLumen` takes the switch away.

`Games/hardburn.json` and `Games/hardburn-fidelity.json` both use `Overrides/hardburn.json`.

## The override file

```json
{
  "version": 1,
  "overrides": [
    {
      "name": "concept_tdf_frigate",
      "match": {"url": "*/concept-tdf-frigate/67dadcf78ae6/*"},
      "mesh": "/Game/Fidelity/HardBurn/concept_tdf_frigate/.../SM_concept_tdf_frigate.SM_concept_tdf_frigate",
      "fit": "none",
      "bounds": [[-0.50, -0.21, -0.36], [0.40, 0.30, 0.33]],
      "params": {"EnvIntensity": 0.5, "RoughnessScale": 0.7, "Tint": [0.86, 0.97, 1.1]}
    },
    {"name": "planet_moon", "match": {"texture": "*pole-safe/moon.png"}, "mesh": "/Game/.../SM_planet_sphere.SM_planet_sphere",
     "material": "/Game/.../MI_planet_moon.MI_planet_moon", "fit": "bounds", "bounds": [[-1, -1, -1], [1, 1, 1]]},
    {"name": "hide-example", "match": {"object": "debug-helper"}, "hide": true}
  ]
}
```

A rule applies to a mesh or instanced mesh when every field in `match` matches. Patterns are globs (`*`, `?`),
case-insensitive, and a field can hold one pattern or a list.

| Match field | What it tests |
| --- | --- |
| `url` | The URL of the glTF file the mesh came from. The bridge's build tags every model GLTFLoader parses, and the tag survives clones and geometry copies that share the loaded attributes (instanced batches). |
| `object` | The name of the object or any of its parents |
| `mesh`, `geometry`, `material` | The mesh, geometry or material name |
| `texture` | The image URL of any texture the material shows, including a shader's sampler uniforms |
| `userData` | `{"key": "pattern"}` against `userData` on the object or a parent |

| Rule field | Meaning |
| --- | --- |
| `mesh` | The Unreal static mesh to draw |
| `fit` | `bounds` lines the mesh's source bounds up with the three.js geometry's bounds (centres meet, largest sides match). `none` uses the source's own units. |
| `bounds` | The Unreal mesh's bounds in its source file's units, for `fit: bounds` |
| `material` | An Unreal material for every slot. Without it, each slot keeps the mesh's own material. |
| `params` | Scalar (number) and vector (`[r, g, b]`) parameters set on the materials |
| `others` | Other meshes from the same glTF file: `hide` (the default) or `keep` |
| `hide` | Draw nothing for what the rule matches |

The host adds the scene's ambient light to override materials that have an `Ambient` parameter, as three.js does.

`"effects"` switches each Unreal effect on (`true`) or off. An effect left out is off.

```json
"effects": {"engineLight": true, "gunfire": false, "trails": false, "smoke": false, "explosions": false, "debris": false}
```

| Effect | What Unreal adds in Lumen mode |
| --- | --- |
| `engineLight` | A point light in each drive plume's colour (userData.vfxKey `plume.*`), as bright as the plume's throttle, so drives light their own hull and the ships near them. The 32 plumes nearest the camera get one. |
| `gunfire`, `trails`, `smoke`, `explosions`, `debris` | Not built yet. Hard Burn is redoing its sprite effects, and these will follow the new look and timing. |

## Building overrides from source models

`Tools/fidelity/build-overrides.mjs <sources.json> <overrides.json> --work <dir>` turns a list of sources into
Unreal assets and rules. It needs the host project in `jsgb.local.json` and waits for the Unreal slot.

1. `Tools/fidelity/symfix.mjs` applies a symmetry repair receipt to a full-resolution mesh, when the source names one.
   It writes to a temporary name first, so a stopped run never leaves a half-written model for the next run to reuse.
2. `Tools/fidelity/prepare-glb.mjs` writes the textures as PNG (Unreal's glTF importer reads no WebP) and records
   the bounds.
3. `Tools/fidelity/import_assets.py` runs in an editor commandlet: it imports each mesh with Nanite on, imports
   the textures, and makes a material instance of `M_JsgbFidelityPBR` (glTF metal and roughness, a studio
   reflection, the scene's ambient light, and an optional faction livery).
4. The rules go into the overrides file. `--clean` deletes the PNGs and repaired copies after the import.

`Tools/fidelity/check-hulls.mjs <sources.json> <overrides.json> --out <dir>` checks that each imported hull lines up
with the model the game draws. It lays the repaired source over the game's own model from three sides, measures how
much the outlines overlap and how far the bounds differ, writes an overlay image per hull, and fails a hull below 93%
overlap or above 3% bounds difference.

Planets use `Tools/fidelity/make-sphere.mjs` (a dense sphere with three.js SphereGeometry's UVs) and
`Tools/fidelity/planet_maps.py` (the colour map, and a normal map from it for rocky bodies).

## Hard Burn

- `Overrides/make-hardburn-sources.mjs` reads the game's model manifest and lists every ship and station model
  with its exact original Pixal3D file: the one in `F:/AssetVault/hard-burn/assets/<model>/originals/<hash>/` whose
  hash the manifest records. `Overrides/hardburn-models.md` is the resulting table.
- All 165 models that have a Pixal3D original are imported. 96 have the game's symmetry repair applied to the full
  original. 4 had their game models edited after Pixal3D made them (the Corsair ore hauler, the Helion scout, the TDF
  capital titan and the colony ship), so they use the game's own shape with the original's textures. Every model
  keeps its source's 4096 maps and every triangle (about 110,000 to 1,100,000 per model, drawn with Nanite). The game's
  two fast-attack hulls have no Pixal3D original, so they use the game's own model.
- Hulls use the same coordinates as the game's models (`fit: none`), so the game places, turns and scales them.
- Materials use each original's own textures. The game paints a faction livery over its hulls, and the override
  materials don't. The TDF frigate gets a cool tint and lower roughness, which keeps its red stripes and dark panels.
- Planets use the game's own planet maps on a 260,000-triangle sphere, with normal maps for the Moon and Mars.
  Higher-resolution planet maps are requested from gen in `F:/AssetVault/hard-burn/unreal-fidelity/REQUESTS-gen.md`.
- The host project, its cache and build output live on `H:/builds/JsgbFidelity` (`jsgb.local.json`), about 13 GB.
  Rebuild the rules with `node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json
  --work <dir> --only <names> --clean`.

## What works and what doesn't yet

Works:
- The override system: rules by glTF URL, name, texture or userData, Nanite meshes placed by the game, hide rules.
- All 165 Hard Burn models from the exact Pixal3D originals with the game's symmetry repairs, at full triangle
  counts and 4096 maps. All 165 pass the alignment check against the game's models: the outlines overlap by at
  least 93.6% and the bounds differ by at most 2.9%.
- Planets on a dense sphere with the game's maps and normal maps.
- Lumen mode on and off while the game runs (F9 or Options > Display), with Lumen lighting, a sky light, soft sun
  shadows, volumetric fog, the override models and engine light on the hulls.
- Close-ups: the MRN cruiser, the TDF frigate and the six-armed starbase show more surface detail in Unreal than in
  the browser (`G:/JsGameBridge-fidelity-order/shots/`).

Wrong or missing:
- Hull colours come from the Pixal3D originals. The game's livery isn't applied, so most hulls look warmer and less
  blue than in the browser. Only the frigate has its own tint so far.
- At the battle camera's distance the extra geometry is only a few pixels, so it adds little visible detail.
- Explosion smoke and some small effects draw less than in the browser, and drive plumes cast no light on hulls.
- Unreal needs `r.Streaming.FullyLoadUsedTextures=1` for stills: without it, a shot taken soon after loading shows
  low-resolution mips and the hulls look beige and blurry.

Taking matching shots: the designer view (`?view=designer`) turns and drifts the ship over time, and Chrome and
Unreal don't reach the same pose at the same time. The shot scripts set the ship's pose just before each shot and
use only the mouse wheel to frame it, since held keys pan by different amounts in each.

## Bridge fixes made along the way

These help every game, with or without fidelity mode:

- Shader materials on instanced meshes get the real `instanceMatrix`, instance colours and per-instance attributes
  (`InstancedBufferAttribute`, carried as per-instance custom data). Hard Burn's drive plumes and tracers were
  invisible before.
- Textures three.js uploads flipped (`flipY`) sample the right way up in translated shaders.
- A texture whose image arrives after its material reaches that material.
- A game that draws its view into an EffectComposer target gets its shader output as linear light. Hard Burn's
  dust nebula was too dark and too blue before.
- Opaque surfaces drawn without depth (sky domes) no longer hide what is drawn after them.
- `Tools/web.mjs capture --profile <dir>` keeps blobs on disk, so games that unpack many large models load in
  headless Chrome.

## Frame rate

Hard Burn's fleet battle (`?view=black`), 2560x1440, RTX 4090, JavaScript on its own thread (`--js-thread`), off
screen, 60 s from 20 s after the loading screen closes, measured with `Tools/bench.mjs`.

| Setup | Average FPS | 1% low FPS | Slowest frame (FPS) |
| --- | ---: | ---: | ---: |
| Game's own models, no Lumen, DLSS off | 195.9 | 99.8 | 26.1 |
| Override models, no Lumen, DLSS off | 196.4 | 99.5 | 42.6 |
| Override models, no Lumen, DLSS Quality | 203.0 | 60.9 | 7.8 |
| Override models with Lumen | not measured | | |

The Lumen runs were stopped before they ran. The single slowest frames come from new objects arriving during
the battle, not from the override models.

## Shots and film

`G:/JsGameBridge-fidelity-order/shots/` holds 2560x1440 pairs, browser on the left and Unreal with Lumen on the
right: `tdf-frigate-close`, `mrn-cruiser-close`, `tdf-starbase-close` and `fleet-battle-wide`, each as
`-side-by-side.png`, `-browser.png` and `-unreal.png`.

`G:/JsGameBridge-fidelity-order/hardburn-unreal-fidelity.mp4` (1080p) and `hardburn-unreal-fidelity-720p.mp4`: the
same seeded fleet battle in Chrome and in Unreal fidelity mode, full views on top and 2x crops below. The film shows
the older materials and the first 52 models.
