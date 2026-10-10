# Changelog

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
