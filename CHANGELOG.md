# Changelog

## 0.5.1

- Asset overrides: rules in the file a game names with `"overrides"` in `Games/<game>.json` replace its models with
  Unreal assets, matched by mesh name, model file or texture URL. Parts drawn through a `BatchedMesh` can be
  replaced too. The game's code doesn't change.
- Lumen mode: F9 or `window.jsgb.graphics.set({lumen: true})` turns Unreal's Lumen lighting on and off while a game
  runs. It's off by default. It loads the override models when it turns on and releases them when it turns off.
- Materials with an environment map (`envMap` or `scene.environment`) get the light they reflect from it, so lit
  surfaces are no longer close to black.
- Sprite sheets in WebP draw: the build writes PNG copies, since Unreal can't decode WebP. Camera-facing sprites on
  instanced meshes draw over the surface they sit on, and Unreal no longer culls them by their flat quad's bounds.
- Memory: materials and textures a game disposes of are freed in Unreal. A texture sent again at the same size gets
  its new pixels in the Unreal texture it already has, so Unreal no longer makes a new texture each time. The runtime
  no longer keeps a copy of compressed textures' pixels.
- Storage is written out before a reload, so a game that saves to `sessionStorage` and reloads at once keeps what it
  saved.
- Scripted runs ignore the desktop mouse.
- `Tools/play-live.mjs` and `Tools/play-splash.ps1` play a game full screen behind a launch window with a progress
  bar.

## 0.5.0

- `<select>` and `<option>` work as in a browser: `add`, `remove(index)`, `options`, `length`, `selectedIndex`,
  `selectedOptions`, `value`, and each option's `text`, `index` and `selected`.
- Each game keeps its own display settings in `Saved/JsGameBridge/<game>/display.json`. Unreal's shared settings
  file isn't written any more, so a page game's 60 FPS cap no longer carries over to other games.
- If a packaged game bundles a pipeline cache, the loading screen stays up until the GPU driver has compiled it, so
  the game doesn't stop mid-play to compile a shader.
- Shader materials drawn through an `EffectComposer` are no longer decoded from sRGB a second time. Before this fix
  they came out much too dark.
- Uniforms with names HLSL reserves (`noise`, `line`, `point` and others) are bound again. The shader translator
  renames them, and the bridge now maps the new name back to the uniform.
- An editor run with `-JsgbSaveMaterials` saves a captured material again when its scene parameter references are
  out of date, because those materials failed to compile in a cook with an empty shader cache.
- `jsgb.local.json` can set where conformance captures go (`captures`) and Unreal's local derived data cache (`ddc`).
- A new conformance case draws a 3D-noise sky sphere through an `EffectComposer`.

## 0.4.0

- Packaged builds draw a game's own shaders. An editor run with `-JsgbSaveMaterials` saves every shader material
  the game generates, the package cooks them, and the packaged host loads them by the shader's key. The log names
  any shader that wasn't captured.
- `window.jsgb.display`: a game's options menu can list resolutions and set the resolution, window mode, vsync and
  frame cap. The Fullscreen API (`requestFullscreen`, `exitFullscreen`) works on top of it.
- 2D WebGL games (pixi.js and the like) run in Unreal's built-in browser with `"page": true`. Unreal holds its frame
  rate to the page's, keys reach the page with the right `code`, and the page has the keyboard without a click.
- Unlit, additive and sprite materials blend in sRGB values as WebGL does, so the transparency test passes.
- A loading screen with the game's name and a progress bar shows until the game draws something.
- Instanced meshes update without rebuilding Unreal's render state when their count changes, and an update with the
  same data is skipped.
- Objects glide between game updates by the time the JavaScript thread made each update, and a readout (F8) shows
  frame-time spread, the 1% low, the worst frame and the game's update rate.
- Ogg Opus audio plays (Unreal's own runtime decoder reads only Ogg Vorbis).
- A texture background (an equirectangular sky) draws behind the scene.
- The display stays on while a game runs, which removes 300 to 400 ms stalls when Windows would switch it off.
- Shader translations cached on disk are keyed by the translator's build, so a newer bridge never reuses old ones.

## 0.3.0

- Faster frames in Unreal: the mirror only sets the material parameters a material has, the host answers the
  engine's window focus check without calling into Windows, and game runs start without Unreal's Python plugin.
  Hard Burn's slowest frame went from 400 ms to 22 ms at 1440p.
- `Patches/puerts-thread-safe.patch` builds Puerts thread-safe, so the game's JavaScript can run on its own
  thread (`--js-thread`). The Quick start applies it.
- `--dlss 5` checks for DLSS 5 Neural Rendering (an RTX 50 GPU, driver 616.64 or newer and NVIDIA's plugin),
  says in the log what's missing, and uses DLAA until all three are there.
- GitHub Actions runs `npm run lint`, `npm test`, the fake-DOM boot of the examples and the browser half of the
  conformance suite on every push and pull request.
- Config files saved with a byte order mark (by Notepad or Windows PowerShell) load.
- A conformance suite runs 23 feature tests and three games in Chrome and in Unreal, and checks the
  pictures, the objects drawn and JavaScript errors. It writes a report (`npm run suite`), and `npm run ci`
  runs it after a build. 25 of 26 runs pass.
- One flag turns on NVIDIA DLSS 4.5 (Super Resolution, DLAA or Frame Generation). Other GPUs get Unreal's TSR.
- Skinned meshes and morph targets, render targets, `onBeforeCompile` material patches, thick and dashed
  lines, and `UnrealBloomPass` bloom now draw in Unreal.
- Custom `ShaderMaterial` colors, line colors and one-sided transparent materials match the browser.
- Moving objects and instances have motion vectors for DLSS and TSR, and a teleport leaves no streak.
- Web Workers run on their own threads.
- Script steps run on the same game frame in Chrome and in Unreal, and seeded games build the same world
  on both sides.
- A game's `publication.json` can use relative paths, so a built game folder runs from any location.

## 0.1.0

The first public release.

- Runs unchanged three.js browser games inside Unreal Engine 5.8 through Puerts.
- Browser APIs in V8: a linkedom DOM, timers, `requestAnimationFrame`, `fetch`, storage, input,
  gamepads, canvas 2D with FreeType text, Web Workers, Web Audio and an en-US `Intl`.
- Scene mirror: meshes, instanced meshes, lights, fog, lines, points, sprites, and custom GLSL
  shaders compiled to Unreal materials.
- New objects are drawn in the frame they first appear, as in WebGL.
- Lines are drawn in three.js order, so overlapping rings never flicker.
- The page's HTML and CSS draw over the game through CEF, and clicks and keys reach the game.
- One-command hot reload into a running Unreal, with the build and reload time shown on screen.
- Conformance films: the browser and Unreal side by side from one commit, with per-frame checks
  for missing objects, untextured objects, line segments and billboards.
- Worker results and compiled shaders are cached between reloads and launches.
- The orbit demo, a small open three.js game to try it with.
