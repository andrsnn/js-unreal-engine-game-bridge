# Why Hard Burn was slow in Unreal

## 2026-10-10 23:20 PDT: Unreal waited for the game's JavaScript on every frame

**What was slow.** Even with the bridge's own costs fixed, Hard Burn's JavaScript takes 12 to 25 ms per game
frame on Puerts' older V8, and some updates take a few hundred milliseconds. Unreal ran that JavaScript on its
game thread, so no frame could finish faster than the game's update, and every slow update froze the picture.

**The framework fix.** The game's JavaScript now runs on its own thread (`-JsgbJsThread`). Each finished game
frame goes to Unreal as a snapshot, and Unreal draws at its own rate, applying the newest snapshot each time. Web
Workers also run on their own threads now, so decoding textures and building meshes in workers never blocks either
thread. One more stall came from inside Puerts: in its thread-safe mode it locked the JavaScript engine for every
object Unreal deleted, so Unreal's garbage collector waited for the game's frame. The bridge's Puerts patch
(Patches/puerts-thread-safe.patch) queues those deletions instead.

| 1440p, DLSS off | Average FPS | 1% low FPS | Game updates per second |
| --- | --- | --- | --- |
| Hard Burn, before today | 14 to 21 | about 3 | same as FPS |
| Hard Burn, JavaScript on its own thread | 132 | 28 | 40 to 55 |
| Unlit Worlds, JavaScript on its own thread | 196 | 68 | 60 (capped) |

**Still to do for "above 60 on every frame".** Hard Burn's 1% low is still 28 FPS. The slowest frames now come
from big texture and mesh uploads landing in one frame, and from Unreal's own garbage collection. Next: spread
uploads over frames and prepare mesh buffers on the JavaScript thread. Also, because Unreal now draws faster than
the game updates, moving objects need smoothing between game frames, so they glide instead of stepping.

## 2026-10-10 23:10 PDT: frames froze for up to a second while the game loaded ship models

The new target is above 60 FPS on every frame, so I now measure the slowest frames, not the average. Hard Burn's
average was 50 to 58 FPS, but its slowest 1% of frames ran at about 3 FPS: frames of 100 to 900 ms, several times
a minute. I timed each part of every slow frame. Three causes, each one general:

1. **Mesh builds were slow.** A new or changed mesh went through Unreal's editor mesh format first. A 300,000-vertex
   ship took 265 ms. The bridge now writes Unreal's render buffers straight from the game's arrays: 15 ms for the
   same mesh.
2. **Textures were re-sent when their pixels hadn't changed.** Like the vertex data before, a texture marked for
   update was converted pixel by pixel and uploaded again, 400 ms for a large one. The bridge now compares the pixels
   with the last ones sent, and copies byte textures without converting each pixel.
3. **Web Workers ran on the game thread.** This is the biggest one left. Hard Burn streams ship models while you
   play, and three.js decodes their compressed textures (KTX2/Basis) and geometry (meshopt) in Web Workers. In a
   browser, workers run on other threads, so the page never waits for them. The bridge ran them on Unreal's game
   thread, so each model load froze the frame for 200 to 900 ms. The fix is what browsers do: each Web Worker gets
   its own thread and its own JavaScript engine, and messages are copied between them. This helps every game that
   uses workers, including Unlit Worlds' terrain and plant generation. In progress now.

| Hard Burn, 1440p, DLSS off | Average FPS | 1% low FPS | Slowest frame |
| --- | --- | --- | --- |
| Before today's fixes | 14 to 21 | not measured | not measured |
| After fix 1 of the first entry (unchanged meshes) | 50 | 3 | 400 ms |
| After fixes 1 and 2 above | 46 to 54 | 8 to 11 | 400 ms |
| After workers on their own threads | (in progress) | | |

## 2026-10-10 21:50 PDT: meshes rebuilt every frame for data that never changed

**What was slow.** Hard Burn tells three.js that some per-vertex data on its ship hulls changed, every frame
(it sets `needsUpdate` on attributes such as hull coverage, damage and window glow). The data itself doesn't
change. In a browser that costs almost nothing, because WebGL just re-uploads a small buffer. The bridge took
every one of those signals as a new mesh. It copied the hull geometry out of JavaScript and rebuilt an Unreal
static mesh of about 30,000 vertices, for 4 hulls and several small parts, every frame.

**Numbers (Unreal, 2560x1440, RTX 4090, DLSS off).**

| | Before | After |
| --- | --- | --- |
| Frame rate | 14 to 21 FPS | 50 FPS average, 53 to 60 FPS in the latest windows |
| Mesh rebuilds | about 3 per frame (1,693 to 1,952 per 600 frames) | none after loading |
| Scene mirror time per frame | 25 ms | 2.3 ms |
| JavaScript time per frame | 30 to 55 ms | 12 to 13 ms |

**The framework fix (no per-game code).** When a game marks vertex data as changed, the bridge now compares
the bytes with the last ones it sent to Unreal, and only rebuilds when they really differ. This works for any
three.js game that calls `needsUpdate` more often than it changes data, which is a common pattern.

**How it was found.** The bridge's frame log now splits the scene mirror into its parts, and the build queue
took 21 to 24 ms of every frame. With `-JsgbTraceMirror` (or `JSGB_TRACE=1` in the Node harness), the bridge
names every geometry it keeps re-sending and which data changed, and for Hard Burn the answer was "nothing".

**Earlier, the same kind of cause in Unlit Worlds.** Web Audio volume targets that the game set every frame
piled up until each sound lookup scanned thousands of old entries. Unlit went from 23 to 55 FPS to 53 to 73 FPS
once old entries were folded together.
