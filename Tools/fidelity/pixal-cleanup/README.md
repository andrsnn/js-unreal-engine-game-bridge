# Pixal3D clean-up

Pixal3D models come out lumpy: flat plates bulge, straight edges wave, and the model is several shells that cut through
each other. These scripts clean a model for Unreal and rebuild it for the web. They run in Blender 5.2 from the command
line and need nothing installed beyond Blender (the web packer also needs Node and a `node_modules` with
`@gltf-transform` and `meshoptimizer`).

## One command

```
blender --background --python cleanup.py -- <in.glb> <out.glb> [--strength 0.5] [--organic auto|on|off]
        [--web-out <folder> --web-triangles 115000 --web-texture 2048]
```

- `<out.glb>` is the full-detail model for Unreal. Every triangle, UV and texture is the original's. Vertices move by
  a few centimetres: flat areas are made flat, edges straightened, lumps and ripples removed. The owner picked this
  method on 13 October 2026.
- `--web-out <folder>` also writes the web models from the same input, in the same place and at the same scale, so a
  gun seat on one is a gun seat on the other:
  - `lod0.glb` at `--web-triangles`, `lod1.glb` at 37% of that, `lod2.glb` at 10%. Geometry is quantized and meshopt
    compressed. One material.
  - `colour-4096.png` and `metal-rough-4096.png`: the paint, taken from the original once. The GLBs carry the same two
    textures at `--web-texture`.
  - `report.json`: for each level, its triangles, how many triangles cut through others, loose pieces, flipped and
    folded faces, and how far the surface is from the original.
- `--strength` is the one setting, 0 to 1. The default 0.5 lets a vertex move at most 0.6% of the model's diagonal.
- `--organic auto` leaves a model with few large flat areas (a statue, a creature) mostly alone: it gets a fifth of the
  strength. Inside a hard-surface model, parts that are not flat also get a fifth.

## What the web side needs to adopt a hull

1. Give `cleanup.py` the hull the game already uses as its source of truth: the Pixal3D original after the game's own
   symmetry repair, in the original's frame. The cleaned and rebuilt models stay in that frame.
2. Take `lod0.glb`, `lod1.glb` and `lod2.glb` in place of the hull's three levels. The textures are PNG inside the GLB:
   the game's asset step should turn them into KTX2 as it does for its own.
3. The rebuilt hull has a new texture layout. Anything keyed to the old layout (a hand-painted mask, a stencil placed in
   texture space) has to be made again. Paint the game applies by position in ship space carries over as it is.
4. Gun seats: the hull's surface moves by up to 0.8% of its size where lumps were. Run the gun fit and the ship judge on
   the new hull before publishing.
5. Measure before it goes near the published game: the same 30-ship battle, frame rate, load time and memory, against
   the current hulls.

## Other files

- `spread.py`, `compose.py`: the technique comparison sheet (`technique-spread.jpg`).
- `rebuild.py`: the one-skin rebuild behind `--web-out`.
- `pack-web.mjs`: quantizes and meshopt compresses `lodN-plain.glb` into `lodN.glb`.
- `decode-web.mjs`: turns a game's compressed web model into a plain GLB Blender can open.
- `ship_camera.py`: a camera over a Hard Burn hull's deck, for the sheet.
