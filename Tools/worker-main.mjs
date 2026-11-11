// A worker module as a function of its own `self` (the main bundle's copy of a worker; Tools/jsgb.mjs).
// Imports stay at the top of the module; the rest becomes the body of __jsgbWorkerMain(__jsgbSelf).
// TypeScript is turned into JavaScript first, so type declarations that span several lines
// (export type X = | {...} | {...}) never end up split between the top and the body.
//   workerMainSource(code, url) -> JavaScript source
export function workerMainSource(code, url) {
  const top = [], body = [];
  for (const line of code.split(/\r?\n/)) {
    if (/^\s*import\s/.test(line)) top.push(line);
    else if (/^export\s*\{\s*\};?\s*$/.test(line) || /^\/\/\/\s*<reference/.test(line)) continue;
    else body.push(line.replace(/\bself\b/g, '__jsgbSelf').replace(/\bglobalThis\b/g, '__jsgbSelf').replace(/^(\s*)onmessage\s*=/, '$1__jsgbSelf.onmessage ='));
  }
  return `${top.join('\n')}\nexport default function __jsgbWorkerMain(__jsgbSelf) {\nconst postMessage = (d, t) => __jsgbSelf.postMessage(d, t);\nconst WorkerGlobalScope = {[Symbol.hasInstance]: o => o === __jsgbSelf}, DedicatedWorkerGlobalScope = WorkerGlobalScope;\n${body.join('\n')}\n}\n__jsgbWorkerMain.url = ${JSON.stringify(url)};\n`;
}

/** TypeScript to JavaScript with esbuild (imports kept on one line each, types removed). */
export async function workerScript(esbuild, code, file) {
  if (!/\.m?tsx?$/.test(file)) return code;
  return (await esbuild.transform(code, {loader: file.endsWith('x') ? 'tsx' : 'ts', format: 'esm', target: 'es2022'})).code;
}
