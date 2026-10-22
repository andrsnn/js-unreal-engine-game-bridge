// Adds freshly prepared materials to an existing host without replacing any of its game art or other containers.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
export function shaderAssetName(m) {
  return ('M_' + m.custom).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 90) + '_B' + (m.blending === 2 ? 2 : m.transparent ? 1 : 0) + (m.side === 2 ? '_2S' : '');
}
export function validateShaderCookLog(log, coverage) {
  for (const line of log.split(/\r?\n/)) {
    if (!/Failed to compile Material|Default Material will be used/i.test(line)) continue;
    const entry = Object.entries(coverage).find(([name]) => line.includes(name))?.[1];
    if (entry) throw Error(`Shader ${entry.shader} did not compile; fix its editor error above and package again.`);
  }
}
export function cookShaderPatch({engine, project, captured, builds, host, coverage}) {
  const work = path.resolve(builds, '.shader-cook');
  fs.mkdirSync(work, {recursive: true});
  const sourceProject = path.dirname(project), name = path.basename(project, '.uproject');
  const cookProject = path.join(work, name + '.uproject');
  fs.copyFileSync(project, cookProject);
  for (const folder of ['Plugins', 'Binaries']) {
    const dest = path.join(work, folder);
    if (!fs.existsSync(dest)) fs.symlinkSync(path.join(sourceProject, folder), dest, process.platform === 'win32' ? 'junction' : 'dir');
  }
  fs.mkdirSync(path.join(work, 'Content'), {recursive: true});
  const materials = path.join(work, 'Content/JsgbGenerated');
  if (!fs.existsSync(materials)) fs.symlinkSync(captured, materials, process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(work, 'Config'), {recursive: true});
  fs.writeFileSync(path.join(work, 'Config/DefaultGame.ini'), '[/Script/UnrealEd.ProjectPackagingSettings]\nbShareMaterialShaderCode=False\nbUseZenStore=False\nbUseIoStore=True\n');
  fs.writeFileSync(path.join(work, 'Config/DefaultEngine.ini'), '[/Script/WindowsTargetPlatform.WindowsTargetSettings]\nDefaultGraphicsRHI=DefaultGraphicsRHI_DX12\n+D3D12TargetedShaderFormats=PCD3D_SM6\n');
  const env = {...process.env, 'UE-LocalDataCachePath': path.join(work, 'DDC'), TEMP: path.join(work, 'Temp'), TMP: path.join(work, 'Temp')};
  fs.mkdirSync(env.TEMP, {recursive: true});
  const run = (exe, args) => {
    const r = spawnSync(exe, args, {cwd: work, env, stdio: 'inherit', windowsHide: true});
    if (r.status !== 0) throw Error('Shader material preparation failed; fix the editor error above and package again.');
  };
  const bin = path.dirname(engine), cooked = path.join(work, 'Saved/Cooked/Windows');
  run(path.join(bin, 'UnrealEditor-Cmd.exe'), [cookProject, '-run=Cook', '-TargetPlatform=Windows', '-iostore', '-CookDir=' + materials,
    '-unversioned', '-unattended', '-NullRHI', '-nop4', '-stdout', '-UTF8Output', '-abslog=' + path.join(work, 'cook.log')]);
  validateShaderCookLog(fs.readFileSync(path.join(work, 'cook.log'), 'utf8'), coverage);
  for (const [asset, entry] of Object.entries(coverage)) {
    if (!fs.existsSync(path.join(cooked, name, 'Content/JsgbGenerated', asset + '.uasset'))) throw Error(`Shader ${entry.shader} was not compiled; fix its editor error and package again.`);
  }
  const files = walk(cooked).filter(f => /\.(uasset|ubulk|uexp)$/.test(f));
  if (!files.length) throw Error('No shader materials were compiled; run packaging again with the editor host configured.');
  const paks = path.join(work, 'paks'); fs.mkdirSync(paks, {recursive: true});
  const container = 'JsgbShaders-Windows_1_P';
  const response = path.join(work, 'shader-files.txt');
  fs.writeFileSync(response, files.map(f => `"${f}" "../../../${path.relative(cooked, f).replaceAll('\\', '/')}" -compress`).join('\n'));
  const commands = path.join(work, 'shader-commands.txt');
  fs.writeFileSync(commands, `-Output="${path.join(paks, container + '.utoc')}" -ContainerName=${container} -ResponseFile="${response}"\n`);
  const tool = path.join(bin, 'UnrealPak.exe');
  const projectStore = path.join(cooked, 'ue.projectstore');
  const manifest = path.join(cooked, name, 'Metadata/packagestore.manifest');
  const scriptObjects = path.join(cooked, name, 'Metadata/scriptobjects.bin');
  if (!fs.existsSync(projectStore) && !fs.existsSync(manifest)) throw Error('Shader package data is missing; fix the cook error above and package again.');
  run(tool, [cookProject, '-CreateGlobalContainer=' + path.join(paks, 'unused-global.utoc'),
    fs.existsSync(projectStore) ? '-ProjectStore=' + projectStore : '-PackageStoreManifest=' + manifest,
    '-ScriptObjects=' + scriptObjects,
    '-CookedDirectory=' + cooked, '-Commands=' + commands, '-compressionformats=Oodle', '-compresslevel=4', '-compressmethod=Kraken',
    '-WriteBackMetadataToAssetRegistry=Disabled', '-platform=Windows', '-unattended', '-nopak', '-abslog=' + path.join(work, 'iostore.log')]);
  const receipt = path.join(work, 'shader-coverage.json');fs.writeFileSync(receipt, JSON.stringify(coverage, null, 1));
  const pakList = path.join(work, 'shader-pak.txt');fs.writeFileSync(pakList, `"${receipt}" "../../../${name}/Content/JsgbShader-coverage.json"\n`);
  run(tool, [path.join(paks, container + '.pak'), '-Create=' + pakList, '-compress', '-abslog=' + path.join(work, 'pak.log')]);
  const dest = path.join(host, 'Windows', name, 'Content/Paks');fs.mkdirSync(dest, {recursive: true});
  for (const ext of ['pak', 'utoc', 'ucas']) {
    const file = `${container}.${ext}`;
    fs.copyFileSync(path.join(paks, file), path.join(dest, file + '.new'));
    fs.renameSync(path.join(dest, file + '.new'), path.join(dest, file));
  }
  console.log(`${Object.keys(coverage).length} prepared shader materials added to the host`);
}
