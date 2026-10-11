#!/usr/bin/env node
// Continuous integration on a Windows machine with Unreal and an RTX GPU: builds the host project's editor (with
// this plugin), then runs the conformance suite (Tools/suite.mjs) and exits with its result. Arguments after the
// script name go to the suite, for example --only-cases. Engine and project come from jsgb.local.json or
// JSGB_ENGINE and JSGB_PROJECT.
//   node Tools/ci.mjs [suite arguments]
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {settings} from './jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {engine, project} = settings();
if (!engine || !project) { console.error('ci: set "engine" and "project" in jsgb.local.json (or JSGB_ENGINE and JSGB_PROJECT)'); process.exit(2); }

const buildBat = path.resolve(path.dirname(engine), '../../Build/BatchFiles/Build.bat');
console.log(`ci: building the editor for ${project}`);
const build = spawnSync('cmd', ['/c', buildBat, 'UnrealEditor', 'Win64', 'Development', `-Project=${project}`, '-WaitMutex', '-NoHotReloadFromIDE'], {stdio: 'inherit'});
if (build.status !== 0) { console.error(`ci: the Unreal build failed (exit ${build.status})`); process.exit(1); }

const suite = spawnSync(process.execPath, [path.join(bridge, 'Tools/suite.mjs'), ...process.argv.slice(2)], {stdio: 'inherit'});
process.exit(suite.status ?? 1);
