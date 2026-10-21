# Legacy renderer notes (JsGameBridgeHost and ThreeUnrealRenderer)

One generic Unreal renderer for ordinary Three.js scene graphs. Gameplay remains in the browser repository; generated target bundles are build products, not a second editable game implementation.

`JavaScript/ThreeUnrealRenderer.mjs` implements the renderer surface and sends version-1 scene packets to `UJsGameBridgeComponent::ApplyScene`. Geometry is cached by uuid plus index/attribute versions. Frames carry entities, lights, camera, materials, imported asset keys, instanced batches and one-shot events. Input returns through `OnAction` as `{action, parameters}`. Asset overrides live in JSON, rather than gameplay-specific C++.

Coordinate contract: positions are Three units, matrices are column-major `matrixWorld`. Unreal uses `(X,Z,Y) * UnitsToCentimeters`, with reversed procedural triangle winding. Camera FOV is vertical on the wire and converted to horizontal using the supplied aspect ratio. Registry objects map keys to `mesh`, `material`, `niagara`, `sound`, `cameraShake` paths.

The generic renderer, Puerts host and support modules **compile in UE 5.8**. The original whole-game module graph builds from the canonical browser repo; native original-main/New Game/faction reload/save execution passes in NullRHI; visual/audio playability acceptance is still pending. The first adapter reports unsupported point/line/sprite and ambient-light cases explicitly. Multi-material geometry, texture uniforms, imported multipart hull overrides, environment application, animation state, native UI/audio validation still require integration. The reload command acknowledges the exact canonical commit and hash after actual entry completion. Do not call this a whole-game run, feature parity or performance proof yet.

The owner-facing Hard Burn delivery stays on its checked renderer until the shared backend passes native compilation and a full original-source campaign boot. See `NOTES.md` for ownership and cross-project coordination. No other game project is modified by this module.

Audio v4 is registered in `Registry/audio-cues-v4.json`, the per-game `*-sounds.json` maps, and `JavaScript/{hardburn,karvos,unlit}-assets.json`. Existing mesh/material/Niagara entries are preserved. All 249 native event keys resolve to 191 actual SoundCue assets with 507 SoundWaves; independent UE 5.8.2 disk reload passed all 530 variant references. See `Tools/AudioImporter/reports/audio-cues-v4-acceptance.json` and the final metadata receipt.

Use `UnrealAudioCatalog.mjs` to merge game sound keys into the complete asset registry before `SetAssetRegistry`, which replaces the registry. Sound events carry volume/pitch at the top level. Engines, cutters and score stems require retained, stoppable AudioComponents; the helper rejects looping cues through the one-shot event path. Bus/master/mute and adaptive stem controls remain the port adapter's responsibility. The cook must include `/JsGameBridge/Audio`; JSON alone does not root assets for packaging. See `Tools/AudioImporter/README.txt` for the verified import and loop contract.

A generic viewport host is `/Script/JsGameBridge.JsGameBridgeGameMode`. Launch it with `JsBundle`, `JsSourceRoot`, `JsBootstrap`, and `JsRegistry` paths; optional `JsReloadPort` overrides5292. It hosts the shared body/CSS through one transparent CEF UI, forwards input/layout to the original Puerts handlers, and contains no game UI definitions or simulation rules. The UI mirror has CPU service checks and compiles; native GUI validation is pending. Audio currently remains a silent bootstrap graph.

Audio v5 retains the same249 event/alias keys and191 cue object paths. Updated
`Registry/audio-cues-v5.json` and per-game `*-sounds.json` maps include calibrated
mixer and lifecycle metadata for hbue, uwopus and kvopus. Six shorter PDC variants
and separate cutter/shot-cycle release contracts passed incremental native import
and fresh UE disk reload; see `Tools/AudioImporter/reports/audio-cues-v5-acceptance.json`.
Port handoffs and current browser/editor ownership are appended in `NOTES.md`.

Imported geometry is marked with `userData.assetContent`; its material retains `userData.assetMaterialKey` through clones/batches. A root override honors the source geometry's camera layers and preserves unmarked runtime attachments through LOD/content containers. Dirty geometry carries RGBA vertex colours without spatial axis conversion. Native references pass one batched433-path existence check; that is not rendered parity.
