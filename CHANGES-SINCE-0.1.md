# JsGameBridge: the biggest changes from v0.1.0 to v0.5.1

What any game running on JsGameBridge gets now:

1. You can package a game as a normal Unreal build, copy it to another PC and play it with a double-click.
2. One setting turns on NVIDIA DLSS, including Frame Generation, and other graphics cards get Unreal's TSR.
3. The game's JavaScript and its Web Workers run on their own threads, so they don't slow down Unreal's frames.
4. A test suite runs each game in Chrome and in Unreal and checks that every frame draws the same objects.
5. More of three.js works in Unreal, like skinned and morphing meshes, bloom, render targets and thick or dashed lines.
6. 2D WebGL games made with pixi.js run too, inside Unreal's built-in browser.
7. A game's own options menu can change the resolution, window mode, vsync and frame cap.
8. A rules file can swap a game's models for high-detail Unreal models, and Lumen lighting turns on and off while you play.
