// Worker modules wrap as a function of their own self, also when a type declaration spans several lines.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {workerMainSource, workerScript} from '../../Tools/worker-main.mjs';

// esbuild has a native binary, so it loads at run time from the runtime's packages instead of being bundled.
const esbuild = await import(pathToFileURL(path.resolve('Runtime/node_modules/esbuild/lib/main.js')).href);

const TS = `import { a } from './a';
export type Request =
  | { id: number; kind: 'x' }
  | { id: number; kind: 'y' };
self.onmessage = (ev: MessageEvent<Request>) => { (self as unknown as Worker).postMessage(a(ev.data.id)); };
`;

test('a TypeScript worker with a multi-line union type wraps into valid JavaScript', async () => {
  const js = await workerScript(esbuild, TS, 'w.ts');
  const out = workerMainSource(js, '/jsgb/workers/w.js');
  assert.match(out, /^import \{ a \} from "\.\/a";/m);
  assert.ok(!/export type/.test(out), 'types removed');
  await esbuild.transform(out, {loader: 'js', format: 'esm'}); // parses
  assert.match(out, /__jsgbSelf\.onmessage =/);
});

test('JavaScript workers pass through unchanged before wrapping', async () => {
  assert.equal(await workerScript(esbuild, 'self.x = 1;', 'w.js'), 'self.x = 1;');
});
