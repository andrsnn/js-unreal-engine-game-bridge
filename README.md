<p align="center">
  <img src="docs/images/hero.png" alt="JS Unreal Engine Game Bridge: the same three.js game in a browser and in Unreal Engine 5, side by side" width="100%">
</p>

<h1 align="center">JS Unreal Engine Game Bridge</h1>

<p align="center">
  Run an unchanged three.js browser game inside Unreal Engine 5.8.<br>
  Build and test on the web in seconds. Ship it with Unreal.
</p>

<p align="center">
  <img src="docs/images/demo.gif" alt="The orbit demo in a browser and in Unreal, then a live edit that shows up in both" width="100%">
</p>

## What it is

JS Unreal Engine Game Bridge takes a three.js game written for the browser and runs it inside
Unreal Engine 5.8 without changing the game. The game's own JavaScript runs in V8 through Puerts.
Its three.js scene is copied into Unreal meshes, lights and materials every frame. Its HTML and CSS
draw on top through Unreal's built-in Chromium (CEF), and its Web Audio plays through Unreal's audio
engine.

You keep writing one game for the web. Save a file and it reloads in the browser and in Unreal, and
each one shows how long the reload took.

## Why this matters

- **Build fast on the web.** A web game reloads in about a second. You keep that speed while the same
  game also runs in Unreal.
- **Ship with Unreal.** The same game gets Unreal's renderer, post processing, packaging and platforms.
  You can swap in Unreal meshes, materials and Niagara effects one asset at a time.
- **One codebase.** There's no port to maintain. Gameplay, UI and sound stay in the web project.
- **Made for AI-driven development.** An AI agent works well in a web codebase: it can read every
  file, run the game in a headless browser, take screenshots and fix what it sees in seconds. In an
  Unreal project, a lot of the game lives in binary assets and Blueprints. With the bridge, the agent
  keeps working on the web, and a conformance test films the browser and Unreal side by side from the
  same commit, so the agent can check the Unreal build without ever opening Unreal itself.

## Side by side

| Orbit demo (included) | Hard Burn (a larger private game) |
| --- | --- |
| ![The orbit demo in a browser and in Unreal](docs/images/orbit-demo-side-by-side.png) | ![Hard Burn in a browser and in Unreal](docs/images/hardburn-side-by-side.png) |

In each image the browser is on the left and Unreal is on the right, built from the same commit.

## How it works

<p align="center">
  <img src="docs/images/architecture.svg" alt="Architecture: the game builds for the browser with Vite, and into one bundle that runs in Puerts V8 inside Unreal, which feeds the scene mirror, the CEF overlay and audio" width="100%">
</p>

1. **One bundle.** esbuild builds the game with the bridge runtime into one script, in about a second.
   three.js is swapped for a stand-in renderer that records the scene instead of drawing it.
2. **Browser APIs in V8.** linkedom provides the DOM. The runtime adds `window`, timers,
   `requestAnimationFrame`, `fetch` for the game's files, `localStorage`, keyboard, mouse and gamepad
   input, canvas 2D with real text, Web Workers, Web Audio, and an en-US `Intl`.
3. **Scene mirror.** Each frame, the camera, lights, fog, meshes, instances, lines, points and sprites
   go to Unreal as one float array. Geometry, textures and materials go once and again only when they
   change. Custom `ShaderMaterial` GLSL is compiled to HLSL (glslang and SPIRV-Cross, built to
   WebAssembly) and becomes an Unreal material.
4. **UI overlay.** The page's body and stylesheets render in a transparent CEF browser over the game
   view. Clicks and key presses go back to the game's own handlers.
5. **Audio.** Web Audio graphs become Unreal voices, from sound files or synthesized sound.

## Features

| Area | Supported | Notes |
| --- | :---: | --- |
| Meshes, groups, instanced meshes | ✅ | Built in the frame they first appear |
| Standard, Phong, Lambert, Basic materials | ✅ | Color, maps, emissive, roughness, metalness, transparency |
| Custom `ShaderMaterial` and `RawShaderMaterial` | ✅ | GLSL to HLSL at run time (editor builds) |
| Lines, line loops, line segments | ✅ | Drawn in three.js order |
| Points and sprites | ✅ | Camera-facing billboards, world or pixel size |
| Lights, fog, background, tone mapping, bloom | ✅ | |
| HTML and CSS UI | ✅ | CEF overlay, clicks and keys go to the game |
| Canvas 2D (including text) | ✅ | FreeType text with the game's fonts |
| Web Audio and `<audio>` | ✅ | Gain, pitch, pan, 3D position, low-pass |
| Web Workers | ✅ | Run on the game thread, results cached between launches |
| `localStorage`, `fetch`, timers, input, gamepads | ✅ | |
| Hot reload with timings | ✅ | Build plus restart, shown on screen |
| Browser and Unreal conformance films | ✅ | Per-frame checks of objects, lines and billboards |
| Custom `EffectComposer` passes | ❌ | Bloom, fog, tone mapping and exposure only |
| WebGPU and TSL node materials | ❌ | Drawn with generic materials |
| Packaged (shipping) builds | ⚠️ | Custom shaders need an editor build, or a registry material |

## Quick start

You need Windows, [Unreal Engine 5.8](https://www.unrealengine.com/), [Node.js 22](https://nodejs.org/)
and [Puerts](https://github.com/Tencent/puerts).

1. **Make a host project.** Create an empty Unreal 5.8 C++ project. Put Puerts in
   `Plugins/Puerts` and this repository in `Plugins/JsGameBridge`, then build the editor target.
2. **Install the tools.**

   ```
   cd Plugins/JsGameBridge/Runtime
   npm install
   cd ../Examples/orbit-demo
   npm install
   ```

3. **Tell the tools where Unreal is.** Copy `jsgb.local.example.json` to `jsgb.local.json` and set
   `engine` (UnrealEditor.exe) and `project` (your host `.uproject`).
4. **Play.** Double-click `Play in Browser.cmd`, then `Play in Unreal.cmd`. Both open the orbit demo.
5. **Live edit.** Double-click `Demo/Add Feature.cmd`. It adds a label to the demo's HUD, and both
   windows reload. `Demo/Remove Feature.cmd` takes it out again.

## Performance

Measured on one Windows PC with a desktop GPU, Unreal 5.8 editor build, 1280×720.

| | Orbit demo | Hard Burn |
| --- | --- | --- |
| Bundle build | 0.5 s | 0.6 s |
| Hot reload in Unreal (save to first frame) | 0.6 s | 13 to 18 s |
| Page reload in the browser (to first frame) | 0.1 to 0.6 s | about 4 s |
| Frame time in Unreal after loading | about 3 ms | about 20 ms |

Most of a large game's reload time is the game's own loading: workers run on the game thread, and V8
in Puerts is older than Chrome's.

## Port your own game

Most games need one config file. Plan on under an hour.

1. Add `Games/<name>.json`. Paths are relative to this repository:

   ```json
   {
     "title": "My Game",
     "repo": "../my-game",
     "index": "index.html",
     "public": ["public"]
   }
   ```

2. Run `node Tools/jsgb.mjs smoke <name>`. It boots the game in Node with the same browser APIs as
   Unreal and reports missing files, errors and what the scene contains. Fix those first.
3. Run `npm run unreal -- <name>`. It builds, starts Unreal, and reloads on every save.
4. Write `Tests/scripts/<name>.txt` and run `npm run conformance -- <name>` to film the browser and
   Unreal side by side and check every frame.

A conformance script has one step per line, in seconds after the game starts:

```
0 wait 'NEW GAME'      wait until an element with this text (or CSS selector) exists
1 gone #loading        wait until an element no longer exists
2 shot title           save a screenshot
3 click 'NEW GAME'     click it
5 key Escape           press a key
20 quit
```

## Known limits

- Generated shader materials need an editor build of the host (`UnrealEditor -game`). In a packaged
  game they fall back to generic materials unless the registry supplies one.
- Loading is slower than in a browser, because workers run on the game thread. Worker results are
  cached on disk, so later launches are faster.
- Lines are one pixel wide, as in most WebGL browsers, and have no antialiasing. Their colors skip
  three.js tone mapping, so bright lines can look more saturated than in the browser.
- HUD text can come out a few percent larger in the CEF overlay than in Chrome.
- Canvases drawn by a second renderer (minimaps, previews) show as empty in the overlay.
- Web Audio effect nodes other than gain, pan and low-pass (delay, convolver, compressor) are skipped.
- Windows only for now.

## Roadmap

- Run Web Workers on their own threads.
- Packaged builds with shader materials cooked ahead of time.
- Wide, antialiased lines.
- Custom post-processing passes.
- macOS and Linux hosts.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT. See [LICENSE](LICENSE). The vendored shader compiler in `Runtime/vendor/cross-shader` keeps its
own MIT license.
