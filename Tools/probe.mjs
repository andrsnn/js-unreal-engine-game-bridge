#!/usr/bin/env node
// Drives a running JsGameBridge host (started with -JsgbAllowRemote) for debugging.
//   node Tools/probe.mjs [--port 5292] step step ...
// Steps: "wait:<seconds>", "shot:<png path>", "eval:<javascript>", "status".
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? args.splice(portAt, 2)[1] : 5292;
const base = `http://127.0.0.1:${port}/bridge`;
for (const step of args) {
  const at = step.indexOf(':');
  const verb = at < 0 ? step : step.slice(0, at), rest = at < 0 ? '' : step.slice(at + 1);
  if (verb === 'wait') { await new Promise(r => setTimeout(r, +rest * 1000)); continue; }
  const res = verb === 'status' ? await fetch(`${base}/status`) : await fetch(`${base}/${verb === 'shot' ? 'capture' : verb}`, {method: 'POST', body: rest});
  console.log(`${verb}: ${(await res.text()).slice(0, 2000)}`);
}
