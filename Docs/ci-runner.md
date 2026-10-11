# Continuous integration

Two workflows run on GitHub Actions.

- `.github/workflows/ci.yml` runs on every push and pull request on GitHub's hosted Linux runners. It installs the
  tools, checks every script and JSON file (`node Tools/lint.mjs`), runs the unit tests (`node Tools/unit.mjs`),
  builds the runtime with the orbit demo, boots the example games in Node's fake DOM (`jsgb.mjs smoke`), and plays
  the browser half of the conformance suite in headless Chromium (`suite.mjs --web-only`). It uploads the browser
  report.
- `.github/workflows/unreal.yml` needs Unreal, so it runs on a self-hosted Windows runner with the label `unreal`.
  It makes a new host project, builds the plugin in it, runs the whole conformance suite off screen, and uploads
  the report and the side-by-side films. A full run takes about an hour, so it runs every night at 09:00 UTC and
  whenever you start it from the Actions tab (Unreal, then Run workflow). You can pass suite arguments there, for
  example `--games orbit-demo`.

Merge to main only when CI is green, and tag releases only from green commits.

## Set up the self-hosted runner

You need a Windows PC with Unreal Engine 5.8, an NVIDIA RTX GPU, Node 22, Git and ffmpeg on the PATH.

1. Prepare a Puerts plugin folder once, outside the repository. Follow steps 2 and 3 of Setup in the README: the
   Puerts source at the tested commit, the V8 folder from the 1.0.9 release, and
   `git apply Patches/puerts-thread-safe.patch` from inside the Puerts folder. The CI job checks that the patch is
   applied and stops with a message if it is not. The first build compiles Puerts in this folder, and later runs
   reuse it.
2. On GitHub, open the repository's Settings, then Actions, then Runners, and click New self-hosted runner. Choose
   Windows and follow the download steps into an empty folder on a drive with at least 50 GB free.
3. Configure it with the label `unreal`:

   ```
   config.cmd --url https://github.com/<owner>/<repository> --token <token from that page> --labels unreal
   ```

4. Create a file named `.env` in the runner folder with the paths for this machine. The workflow files never
   contain them.

   ```
   JSGB_ENGINE=<Unreal folder>/Engine/Binaries/Win64/UnrealEditor.exe
   PUERTS_DIR=<the Puerts folder from step 1>
   JSGB_BUILDS=<a folder for the suite's work files, kept between runs (optional)>
   ```

5. Start the runner with `run.cmd` from a signed-in Windows session. Unreal needs the desktop session to use the GPU,
   so don't install the runner as a service. To start it when you sign in, add a Task Scheduler task that runs
   `run.cmd` at log on.

The job runs one Unreal process at a time. Don't run other Unreal work on that PC while it runs, because both
would share the GPU and the frame timings in the report would be wrong.

## Run the same checks on your own PC

```
node Tools/lint.mjs
node Tools/unit.mjs
node Tools/jsgb.mjs smoke orbit-demo
node Tools/suite.mjs --web-only --games orbit-demo,threejs-fps,threejs-pointerlock
node Tools/ci.mjs --clean-host <empty folder> --films
```

The last command needs `JSGB_ENGINE` and `PUERTS_DIR`, either as environment variables or with `engine` in
`jsgb.local.json`.
