# Performance

How fast three.js games run through the bridge in Unreal, what made them slow, and what the bridge does about
it. Every fix here is part of the framework. None of it is specific to one game.

The target is above 60 FPS on every frame at 1440p on an RTX 4090, without frame generation. So the numbers
below include the 1% low (the average frame rate of the slowest 1% of frames) and the slowest single frame, not
just the average.

## How it's measured

`node Tools/bench.mjs <game> --script <steps> --from <s> --to <s> --res 2560x1440 [--js-thread] [--dlss quality]`
runs the game off screen, waits until the game is ready, and records every frame time between `--from` and `--to`
seconds. It makes no requests to the game during that window, because a request is handled on Unreal's game
thread and can stall a frame. The host also logs a breakdown of any frame over 34 ms ("slow frame") and of any
JavaScript frame over 30 ms ("slow js frame"), and `-trace=cpu,frame` records an Unreal Insights trace. With the
JavaScript thread, any command it sends to the game thread that takes over 15 ms is logged with the bridge
function that sent it ("Slow game-thread command").

All runs: RTX 4090, 1440p, DLSS off (FXAA), Unreal 5.8 editor build in `-game` mode, off screen. Hard Burn sits on its
starting view with no input from 25 to 65 s after it's ready. Unlit Worlds starts a new game and stands on the
planet from 45 to 85 s.

## Results so far

| Step | Hard Burn average | Hard Burn 1% low | Unlit average | Unlit 1% low |
| --- | --- | --- | --- | --- |
| Start of today (JavaScript on the game thread) | 14 to 21 | about 3 | 23 to 55 | not measured |
| Unchanged data no longer re-sent, Web Audio fix | 37 to 58 | 3 | 73 | 26 |
| Web Workers on their own threads, compressed textures | 32 to 47 | 5 to 8 | | |
| JavaScript on its own thread (`--js-thread`) | 78 to 132 | 13 to 28 | 196 | 68 |
| Puerts deletion patch, interpolation, mesh buffers on the JavaScript thread, no polling | 162 | 39 | 91 | 13 to 25 |
| Images and sounds decoded off the game thread | 125 | 24 | 78 | 60 (slowest frame 21 ms) |

The averages vary between runs by up to 20%, mostly with what the game streams in during the window. Unlit's
averages after the first rows are lower for a good reason. A vertex color fix made its grass and foliage draw,
so the GPU now does more work (15 ms per frame instead of 3).

The last row was measured while another project used the same GPU (see "Two causes of slow frames are on this PC"
below), so its GPU time per frame swung between 5.6 and 12.5 ms for the same scene.

Hard Burn rows measured between c832e80 and this fix may have drawn the sky without its nebula shader (see the second
bug below the numbered list), which makes the GPU's work lighter than it should be. The next measurement includes the fix.

The target isn't met yet. See "What's left".

## What was slow, and the framework fixes

Each entry is a cause found with the logs or a profile, and the general fix for it.

1. **Web Audio automation piled up.** A game that sets a volume target every frame added an event every frame,
   and every sound lookup scanned all of them. Past events are now folded into one.
2. **Unchanged data was re-sent.** Games often mark vertex data and textures as changed every frame without
   changing them. WebGL shrugs that off, but the bridge rebuilt Unreal meshes and textures. The bridge now compares
   the bytes with the last ones it sent.
3. **Plain and shader materials were described in full every frame.** Their values are now compared as numbers
   first.
4. **Mesh builds went through Unreal's editor mesh format.** The bridge now writes Unreal's render buffers directly
   (15 ms instead of 265 ms for a 300,000-vertex mesh). With the JavaScript thread, the buffers are built there, and
   the game thread only wraps them (0.1 ms).
5. **Web Workers ran on the game thread.** Texture transcoding (KTX2/Basis) and mesh decoding in workers froze
   frames for up to a second. Each worker now gets its own thread and JavaScript engine, as in a browser. Bundled
   workers get standalone bundles, and blob URLs are shared between the page and its workers.
6. **Compressed textures were expanded to RGBA.** The bridge now reports BC7 and S3TC support, so KTX2 textures
   arrive 4x smaller and upload to Unreal as they are.
7. **Unreal waited for the game's JavaScript on every frame.** With `-JsgbJsThread`, the game's JavaScript runs on
   its own thread and hands Unreal a snapshot per game frame. Unreal draws at its own rate, and objects and the
   camera glide between snapshots, one snapshot behind. Objects can opt out with `userData.jsgbNoInterpolate`.
8. **Puerts locked the JavaScript engine from Unreal's game thread.** That happened for every deleted UObject and
   once a second for a delegate check, and each time Unreal waited for the game's frame. The bridge's patch
   (Patches/puerts-thread-safe.patch) moves both into the next call into JavaScript.
9. **Registry assets loaded synchronously on first use.** They now load in the background as soon as the registry
   is read.
10. **Garbage collection ran in one piece.** It now runs incrementally (reachability and gathering in 2 ms slices).
11. **Image textures were decoded on the game thread.** PNG and JPEG decoding took 10 to 18 ms per image, and each
    upload started twice. Images now decode on the JavaScript thread, and the game thread uploads each one once.
    Unlit loading its planet went from a 216 ms frame to none over 34 ms.
12. **Sound files were decoded on the game thread when they first played** (222 to 276 ms for a music track). They
    now decode in the background as soon as the game loads them (`decodeAudioData`, `new Audio(src)`). A sound
    played before its decode finishes starts a few frames late. The registry's Unreal sounds also load in the
    background.
13. **One update could add a thousand objects.** Unlit's planet creates about 1,150 objects at once (103 ms). With
    the JavaScript thread, the mirror now creates new objects for at most 8 ms per frame and leaves the rest for the
    next snapshot. Deterministic captures still create everything at once.
14. **Loading a game's own assets waited for every background load.** A synchronous load (generated materials'
    default textures, registry assets) made Unreal finish all queued background loads first (62 ms). The bridge's
    fixed assets now load once at startup, and assets already in memory are used without a load.
15. **New shader materials re-registered every object in the scene.** `PostEditChange` on a new generated material
    flushes the render thread and recreates every component's render state. New materials now compile their shaders
    directly (`-JsgbMaterialPostEditChange` restores the old path).
16. **Test scripts waited for the JavaScript thread.** A script's `wait` step asked the game a question and blocked
    Unreal's frame until it answered, up to a second while the game loads. Script steps now ask and read the answer
    on a later frame. This only affected scripted runs such as the benchmark.
17. **The game thread read the JavaScript thread's delegates.** Each tick checked whether the game's frame callback
    was bound while the JavaScript thread was calling it. Unreal's race detector caught it, and writing each report
    froze the game for about 2 s. The game thread no longer touches the game's delegates while the JavaScript
    thread runs.

Two causes of slow frames are on this PC, not in the bridge or Unreal:

- **Another project shares the GPU from WSL.** While its job runs (up to 100% of the GPU), Unreal's GPU time per
  frame doubles and Windows can hold back Unreal's GPU submissions for 300 ms. Benchmarks run when that job is idle.
- **Windows switching the display on and off.** The PC sits on its lock screen, and Windows turns the display on
  and off every minute or two. Each switch (System log, Kernel-Power event 566, at the same second) stalls the GPU
  queue for 300 to 400 ms, even in an empty game. A player at the screen never sees this. `Tools/bench.mjs` keeps
  the display on while it measures.

Two bugs found while checking these changes against the conformance films:

- **Workers had no `OffscreenCanvas`.** Since Web Workers got their own threads, a worker that draws with
  `OffscreenCanvas` (Hard Burn's settlement textures) failed. Workers now get the same canvas as the page.
- **A shader material exported before the shader compiler finished loading stayed generic.** The exporter skips a
  material whose values haven't changed, so it never retried the translation. Hard Burn's nebula sky then drew as
  plain white in deterministic captures. A shader material is now re-sent every frame until its translation is
  done.

## Motion vectors for DLSS

DLSS and TSR need to know how far each pixel moved since the last frame. I checked this with Unreal's velocity
buffer view (`r.BufferVisualizationTarget Velocity`) on the suite's `motion` case. It has a box sweeping across
the view, a row of instances moving up and down, and a sphere that teleports every half second.

- **Moving objects** had motion vectors already. Unreal works them out from each object's old and new transform.
- **Instances** had none. Every transform update rebuilt the instanced mesh's render proxy, and a new proxy draws
  no velocity. Updates now go to the existing proxy along with each instance's previous transform. This also
  saves a proxy rebuild per moving instanced mesh per frame.
- **Teleports** drew a streak across the jump. `ResetSceneVelocity` runs before Unreal applies the move, so it had
  no effect. A teleport now sets its previous transform to its new one through Unreal's motion vector
  simulation. three.js has no teleport flag, so a move that starts from rest and covers more than twice the
  object's size in one frame counts as one. New objects start with no motion, and a camera jump over 50 m is a
  camera cut.

Not covered yet:

- Skinned and morph-target meshes are deformed on the CPU. The mesh as a whole has motion vectors, but the
  movement of its vertices inside the mesh doesn't.
- With JavaScript on its own thread, the game can update less often than Unreal draws. Instances then keep the
  same motion vectors on the frames in between, which overstates how far they moved.
- Transparent objects don't write motion vectors, which is also Unreal's default.

## Web Workers load slower than in Chrome

Unlit Worlds builds its planet in Web Workers. In Unreal the planet appears several seconds later than in Chrome,
with the same game code and the same seed. Each worker now logs any message that takes over 250 ms, split into
copying the message in, the worker's own code, and copying the replies out.

| Worker | Chrome | Unreal (worker code) |
| --- | --- | --- |
| planet-terrain | 607 ms, 2008 ms | 698 ms, 2481 ms |
| character-pose-meshing | 629 ms | 421 ms |
| cliff-ground-support | 1327 ms | 10254 ms |

Copying the messages costs little (36 ms in, 34 ms out for the 5.3 MB cliff message). The worker's own code is what's
slow, and only in some workers: the cliff worker runs about 8 times slower, while the terrain worker runs about 1.2
times slower. Raising the worker threads to normal priority didn't change it. Puerts runs JavaScript on V8 9.4, from
2021, and Chrome uses a much newer V8. The next step is a V8 profile of the cliff worker, to find the code that's slow
on V8 9.4, and then deciding between a workaround in the runtime and moving Puerts to V8 11.8, which Puerts supports.

## Setup for the JavaScript thread

1. Apply `Patches/puerts-thread-safe.patch` to Puerts. It sets `ThreadSafe = true` in `JsEnv.Build.cs` and
   contains the two lock fixes in item 8 above. Then rebuild the host.
2. Start Unreal with `--js-thread` (`-JsgbJsThread`). `--js-hz` caps how often the game updates (60 by default).
   Without the Puerts patch, the flag logs a warning and JavaScript stays on the game thread.

Deterministic captures (`--fixed-fps`, used by the conformance films) keep JavaScript on the game thread.

## What's left

- **A clean measurement on an idle GPU** of every game, with min and 1% low, after the fixes above.
- **Measuring DLSS and Frame Generation** with these changes, at 1440p and 4K. That needs an unlocked desktop for
  Frame Generation.
- **Motion vectors for vertex animation** (skinned and morph-target meshes), and for instances when JavaScript runs
  on its own thread. See "Motion vectors for DLSS" above.
- **Automatic instancing** of repeated geometry and material pairs, and sending only changed objects each frame.
