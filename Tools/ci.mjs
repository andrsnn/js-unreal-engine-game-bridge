#!/usr/bin/env node
// Continuous integration on a Windows machine with Unreal and an RTX GPU: builds the host project's editor (with
// this plugin), then runs the conformance suite (Tools/suite.mjs) and exits with its result. Arguments after the
// script name go to the suite, for example --only-cases. Engine and project come from jsgb.local.json or
// JSGB_ENGINE and JSGB_PROJECT.
// --clean-host <folder> first makes a new, empty host project there (deleting what was there), links this checkout
// and the Puerts plugin from PUERTS_DIR into its Plugins folder, and builds and tests that project instead.
//   node Tools/ci.mjs [--clean-host <folder>] [suite arguments]
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {settings} from './jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const hostAt = args.indexOf('--clean-host');
if (hostAt >= 0) {
  const host = path.resolve(args[hostAt + 1]);
  args.splice(hostAt, 2);
  process.env.JSGB_PROJECT = cleanHost(host);
}
const {engine, project} = settings();
if (!engine || !project) { console.error('ci: set "engine" and "project" in jsgb.local.json (or JSGB_ENGINE and JSGB_PROJECT)'); process.exit(2); }

const buildBat = path.resolve(path.dirname(engine), '../../Build/BatchFiles/Build.bat');
console.log(`ci: building the editor for ${project}`);
// A code project builds its own editor target; a content-only project builds UnrealEditor with its plugins.
const editorTarget = path.basename(project, '.uproject') + 'Editor';
const target = fs.existsSync(path.join(path.dirname(project), 'Source', `${editorTarget}.Target.cs`)) ? editorTarget : 'UnrealEditor';
const build = spawnSync('cmd', ['/c', buildBat, target, 'Win64', 'Development', `-Project=${project}`, '-WaitMutex', '-NoHotReloadFromIDE'], {stdio: 'inherit'});
if (build.status !== 0) { console.error(`ci: the Unreal build failed (exit ${build.status})`); process.exit(1); }

const suite = spawnSync(process.execPath, [path.join(bridge, 'Tools/suite.mjs'), ...args], {stdio: 'inherit'});
process.exit(suite.status ?? 1);

// The same files as Unreal's Blank C++ template, named JsgbHost.
function cleanHost(host) {
  const puerts = process.env.PUERTS_DIR;
  if (!puerts || !fs.existsSync(path.join(puerts, 'Puerts.uplugin'))) { console.error('ci: set PUERTS_DIR to the Puerts plugin folder (the one with Puerts.uplugin)'); process.exit(2); }
  // The Puerts copy must have Patches/puerts-thread-safe.patch applied: then the patch applies in reverse.
  const check = spawnSync('git', ['apply', '--reverse', '--check', path.join(bridge, 'Patches/puerts-thread-safe.patch')], {cwd: puerts, encoding: 'utf8'});
  if (check.status !== 0) { console.error(`ci: ${puerts} does not have Patches/puerts-thread-safe.patch applied\n${check.stderr}`); process.exit(2); }
  console.log(`ci: new host project in ${host}`);
  fs.rmSync(host, {recursive: true, force: true});
  fs.mkdirSync(path.join(host, 'Source/JsgbHost'), {recursive: true});
  for (const dir of ['Config', 'Content', 'Plugins']) fs.mkdirSync(path.join(host, dir), {recursive: true});
  fs.writeFileSync(path.join(host, 'JsgbHost.uproject'), JSON.stringify({FileVersion: 3, EngineAssociation: '5.8', Category: '', Description: '',
    Modules: [{Name: 'JsgbHost', Type: 'Runtime', LoadingPhase: 'Default'}]}, null, 2));
  for (const [name, type] of [['JsgbHost', 'Game'], ['JsgbHostEditor', 'Editor']]) fs.writeFileSync(path.join(host, `Source/${name}.Target.cs`), [
    'using UnrealBuildTool;', `public class ${name}Target : TargetRules`, '{', `\tpublic ${name}Target(TargetInfo Target) : base(Target)`, '\t{',
    `\t\tType = TargetType.${type};`, '\t\tDefaultBuildSettings = BuildSettingsVersion.Latest;', '\t\tIncludeOrderVersion = EngineIncludeOrderVersion.Latest;',
    '\t\tExtraModuleNames.Add("JsgbHost");', '\t}', '}', ''].join('\n'));
  fs.writeFileSync(path.join(host, 'Source/JsgbHost/JsgbHost.Build.cs'), [
    'using UnrealBuildTool;', 'public class JsgbHost : ModuleRules', '{', '\tpublic JsgbHost(ReadOnlyTargetRules Target) : base(Target)', '\t{',
    '\t\tPCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;', '\t\tPublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore" });',
    '\t}', '}', ''].join('\n'));
  fs.writeFileSync(path.join(host, 'Source/JsgbHost/JsgbHost.cpp'), '#include "Modules/ModuleManager.h"\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, JsgbHost, "JsgbHost");\n');
  fs.symlinkSync(bridge, path.join(host, 'Plugins/JsGameBridge'), 'junction');
  fs.symlinkSync(path.resolve(puerts), path.join(host, 'Plugins/Puerts'), 'junction');
  return path.join(host, 'JsgbHost.uproject');
}
