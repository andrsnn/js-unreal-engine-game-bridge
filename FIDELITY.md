# Fidelity mode: original models and Lumen

A game running through the bridge can look better in Unreal than in the browser without changing its JavaScript.
Two switches do it:

- **Asset overrides.** A file named `overrides.json` beside the game's `publication.json` swaps three.js meshes
  for Unreal assets, such as Nanite meshes with full PBR materials. The game still places, turns, scales and hides
  every object. With no file, nothing changes.
- **`-JsgbLumen`.** Unreal's own lighting: Lumen global illumination and reflections, a sky light, the game's
  directional lights as suns with soft virtual shadow maps, and volumetric fog. `-JsgbLumen=light` is a cheaper
  preset. Without the switch, the bridge lights the scene as three.js does.

For Hard Burn, `Games/hardburn-fidelity.json` turns on the overrides, and `run-unreal.mjs --lumen` adds Lumen.

## The override file

```json
{
  "version": 1,
  "overrides": [
    {
      "name": "concept_tdf_frigate",
      "match": {"url": "*/concept-tdf-frigate/67dadcf78ae6/*"},
      "mesh": "/Game/Fidelity/HardBurn/concept_tdf_frigate/.../SM_concept_tdf_frigate.SM_concept_tdf_frigate",
      "fit": "bounds",
      "bounds": [[-0.50, -0.21, -0.36], [0.37, 0.31, 0.34]],
      "params": {"EnvIntensity": 0.3, "Tint": [0.83, 0.95, 1.0]}
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

## Building overrides from source models

`Tools/fidelity/build-overrides.mjs <sources.json> <overrides.json> --work <dir>` turns a list of sources into
Unreal assets and rules. It needs the host project in `jsgb.local.json` and waits for the Unreal slot.

1. `Tools/fidelity/symfix.mjs` applies a symmetry repair receipt to a full-resolution mesh, when the source names one.
2. `Tools/fidelity/prepare-glb.mjs` writes the textures as PNG (Unreal's glTF importer reads no WebP) and records
   the bounds.
3. `Tools/fidelity/import_assets.py` runs in an editor commandlet: it imports each mesh with Nanite on, imports
   the textures, and makes a material instance of `M_JsgbFidelityPBR` (glTF metal and roughness, a studio
   reflection, the scene's ambient light, and an optional faction livery).
4. The rules go into the overrides file. `--clean` deletes the PNGs and repaired copies after the import.

Planets use `Tools/fidelity/make-sphere.mjs` (a dense sphere with three.js SphereGeometry's UVs) and
`Tools/fidelity/planet_maps.py` (the colour map, and a normal map from it for rocky bodies).

## Hard Burn

- `Overrides/make-hardburn-sources.mjs` reads the game's model manifest and lists every ship and station model
  with its original Pixal3D source and the symmetry repair the game adopted for it. `Overrides/hardburn-models.md`
  is the resulting table: 165 models, 96 with symmetry repairs. The two fast-attack hulls have no Pixal3D original.
- The models in the fleet battle view keep their 4096 maps. The rest import with 2048 maps to fit the disk
  budget. Nanite keeps every source triangle (about 930,000 to 1,000,000 per hull).
- Planets use the game's own planet maps on a 260,000-triangle sphere, with normal maps for the Moon and Mars.
  Higher-resolution planet maps are requested from gen in `F:/AssetVault/hard-burn/unreal-fidelity/REQUESTS-gen.md`.

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

FPS_TABLE

## Film

`G:/JsGameBridge-fidelity-order/hardburn-unreal-fidelity.mp4` (1080p) and `hardburn-unreal-fidelity-720p.mp4`: the
same seeded fleet battle in Chrome and in Unreal fidelity mode, full views on top and 2x crops below.
