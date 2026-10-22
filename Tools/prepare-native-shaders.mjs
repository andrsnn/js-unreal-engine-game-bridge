// Prepares native materials from the shader bodies discovered by the automated game views.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn, spawnSync} from 'node:child_process';
export async function prepareNativeShaders({engine, project, game, captured, coverage}) {
  const missing = Object.entries(coverage).filter(([name]) => !fs.existsSync(path.join(captured, name + '.uasset')));
  if (!missing.length) return;
  const build = path.resolve(path.dirname(engine), '../../Build/BatchFiles/Build.bat');
  const target = path.basename(project, '.uproject') + 'Editor';
  const result = spawnSync('cmd', ['/c', build, target, 'Win64', 'Development', '-Project=' + project, '-WaitMutex', '-NoHotReload'], {stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) throw Error('The shader preparation host did not build; fix the editor error above and package again.');
  // The scripted views already collected the exact shader bodies. Start just the material host here:
  // loading the game again adds unrelated startup work and can start native game workers in the editor.
  const preparation = path.join(game.out, '.shader-material-preparation');
  fs.mkdirSync(preparation, {recursive: true});
  fs.writeFileSync(path.join(preparation, 'prepare.mjs'), "globalThis.__jsgbHost.ready('Preparing shader materials');\n");
  fs.writeFileSync(path.join(preparation, 'publication.json'), JSON.stringify({title: 'Shader preparation', bundle: 'prepare.mjs', publicRoots: ['.']}));
  const port = await new Promise((resolve, reject) => {
    const server = net.createServer();server.on('error', reject);server.listen(0, '127.0.0.1', () => {const p = server.address().port;server.close(() => resolve(p));});
  });
  const child = spawn(engine, [project, '/Engine/Maps/Entry?game=/Script/JsGameBridge.JsgbGameMode', '-game', '-JsgbGame=' + preparation,
    '-JsgbAllowRemote', '-JsgbPort=' + port, '-JsgbMaxSeconds=420', '-JsgbSaveMaterials', '-DisablePython',
    '-RenderOffScreen', '-windowed', '-ForceRes', '-ResX=1280', '-ResY=720', '-unattended', '-nosplash', '-log=jsgb-shader-preparation.log'],
    {cwd: path.dirname(project), stdio: 'ignore', windowsHide: true});
  let exited = false;child.on('exit', () => {exited = true;});
  const request = async (route, body) => fetch(`http://127.0.0.1:${port}/bridge/${route}`, {method: body === undefined ? 'GET' : 'POST', body, signal: AbortSignal.timeout(30000)});
  try {
    const deadline = Date.now() + 420000;
    let ready = false;
    while (!exited && Date.now() < deadline) {
      try {const s = await (await request('status')).json();if (s.ready) {ready = true;break;}} catch {}
      await new Promise(r => setTimeout(r, 500));
    }
    if (!ready) throw Error('The shader preparation host did not open; fix its editor log and package again.');
    const entries = missing.map(([name, entry], i) => {
      if (!entry.body) throw Error(`Shader ${entry.shader} has no preparation data; build the game again before packaging.`);
      const blend = /_B([012])(_2S)?$/.exec(name);
      return {body: entry.body, id: 1000000 + i, material: {type: 'ShaderMaterial', shader: true, custom: entry.shader,
        unlit: !entry.body.lit, blending: blend[1] === '2' ? 2 : 1, transparent: blend[1] === '1', side: blend[2] ? 2 : 0, color: [1,1,1], opacity: 1}};
    });
    const code = `(()=>{const a=${JSON.stringify(entries)};for(const e of a){__jsgbHost.sink.shader(e.body.key,JSON.stringify(e.body));__jsgbHost.sink.material(e.id,JSON.stringify(e.material));}return a.length;})()`;
    const reply = await (await request('eval', code)).json();
    if (+reply.result !== entries.length) throw Error('Shader materials could not be sent to the preparation host; fix its editor error and package again.');
    while (!exited && Date.now() < deadline && missing.some(([name]) => !fs.existsSync(path.join(captured, name + '.uasset')))) await new Promise(r => setTimeout(r, 500));
    for (const [name, entry] of missing) if (!fs.existsSync(path.join(captured, name + '.uasset'))) throw Error(`Shader ${entry.shader} is not ready; fix its editor error and package again.`);
    await request('close', '').catch(() => {});
    const closeDeadline = Date.now() + 60000;
    while (!exited && Date.now() < closeDeadline) await new Promise(r => setTimeout(r, 200));
    console.log(`${missing.length} native shader materials prepared`);
  } finally {if (!exited) child.kill();}
}
