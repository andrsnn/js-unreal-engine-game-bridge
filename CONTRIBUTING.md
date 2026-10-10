# Contributing

Thanks for helping. Bug reports, fixes and new browser APIs are all welcome.

## Before you start

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Keep games unchanged. If a game needs a change to run in Unreal, the fix belongs in the bridge.

## Setting up

Follow the quick start in the [README](README.md) to get the orbit demo running in a browser and in
Unreal. Then:

```
node Tools/jsgb.mjs smoke orbit-demo        # boots the demo in Node with the bridge's browser APIs
npm run conformance -- orbit-demo           # browser and Unreal side by side, checked frame by frame
```

## Where things live

| Folder | What it holds |
| --- | --- |
| `Runtime/src` | The browser APIs, the stand-in renderer, the scene exporter and the shader translator (TypeScript, bundled with the game) |
| `Source/JsGameBridge` | The Unreal plugin: the host, the scene mirror, audio and the bridge object Puerts exposes to JavaScript |
| `JavaScript` | The Puerts bootstrap and the overlay page's client script |
| `Tools` | Build, reload, smoke test, conformance films and the material script |
| `Content/Mirror` | The generic Unreal materials the mirror draws with (made by `Tools/materials/make_materials.py`) |
| `Examples/orbit-demo` | The open example game |
| `Tests` | A small fixture game and conformance scripts |

## Pull requests

- Run the smoke test and a conformance film for the orbit demo, and say in the pull request what you
  checked. The conformance run must pass its object, line and billboard checks.
- Match the code style around your change. Comments explain why, not what.
- One topic per pull request, with a short description written in plain English.

## Reporting a bug

Include the Unreal version, the three.js version, what you expected, what happened, and the host's
log (`Saved/Logs` in your host project). A conformance film of the problem helps the most.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
