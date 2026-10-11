# Changelog

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
