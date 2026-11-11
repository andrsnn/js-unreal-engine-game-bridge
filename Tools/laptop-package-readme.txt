JsGameBridge play build

This folder runs the latest builds of three browser games inside Unreal Engine 5.8 through JsGameBridge:
Hard Burn and Unlit Worlds (three.js) and Saltblade (pixi.js). You don't need to install anything apart from
the graphics driver.

To play, use the desktop shortcuts, or double-click "Play Hard Burn.cmd", "Play Unlit Worlds.cmd" or
"Play Saltblade.cmd" in this folder.

Keys
- F6 switches the DLSS mode: off, DLAA, Quality, Balanced, Performance, then DLSS 5. Each game starts with DLSS
  off. On the RTX 5080 laptop the graphics card drops to a low clock speed while DLSS runs, and about one frame in
  ten then takes 17 to 40 ms. With DLSS off the games run at 260 to 380 FPS on that laptop.
- F7 switches Frame Generation: off, 2x, then 3x and 4x on RTX 50 series cards (Multi Frame Generation).
- F9 turns Lumen mode on and off. Each game starts with it off. In Hard Burn it is also in Options > Display, as
  "Lumen lighting". Lumen mode lights the game with Unreal's Lumen, swaps in the full-detail ship models (they take a
  few seconds to load the first time) and adds Unreal's own engine light, gunfire light and lit smoke. It needs a
  fast graphics card.
- The box in the top right shows the mode, the frame rate and the GPU time per frame.

What each mode needs
- DLAA, Quality, Balanced, Performance: an NVIDIA RTX graphics card. Without one, these modes use Unreal's TSR.
- Frame Generation 2x: an RTX 40 or RTX 50 series card, with the game window on screen.
- Multi Frame Generation 3x and 4x: an RTX 50 series card.
- DLSS 5: NVIDIA hasn't released it for Unreal yet, so this mode uses DLAA and the box says why.

How the games run
- Hard Burn and Unlit Worlds: Unreal draws the game's three.js scene, and the game's JavaScript runs on its own
  thread. Shader effects a game writes itself draw with the bridge's plain materials in this packaged build.
- Saltblade: pixi.js draws with WebGL, so the game's own web build runs in Unreal's built-in browser, and Unreal
  shows that page full screen. Frame Generation works on the whole picture.

Logs are in host\Windows\JsgbHost\Saved\Logs, one per game (jsgb-hardburn.log and so on).
