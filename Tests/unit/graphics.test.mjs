// The Unreal graphics options a game's menu reads and changes through window.jsgb.graphics (Runtime/src/graphics.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadRuntime} from './load-runtime.mjs';

let events = [];
globalThis.dispatchEvent = e => { events.push(e.type); return true; };

/** A host whose graphics state is whatever the test last put in `current`, and which keeps every change it is sent. */
function graphicsHost() {
  const host = {log() {}, registry: '', current: '', sent: []};
  host.graphics = {get: () => host.current, set: json => host.sent.push(json)};
  return host;
}

test('the page hears about a change once, when the host state changes', async () => {
  const host = graphicsHost();
  const m = await loadRuntime('graphics.ts', host);
  events = [];
  host.current = JSON.stringify({lumen: true, available: true, models: false});
  m.refreshGraphics();
  m.refreshGraphics();
  assert.deepEqual(events, ['jsgbgraphicschange']);
  assert.deepEqual(m.graphicsState(), {lumen: true, available: true, models: false});
  // A report with only some fields keeps the others.
  host.current = JSON.stringify({models: true});
  m.refreshGraphics();
  assert.deepEqual(events, ['jsgbgraphicschange', 'jsgbgraphicschange']);
  assert.deepEqual(m.graphicsState(), {lumen: true, available: true, models: true});
});

test('a report that is not JSON changes nothing and sends no event', async () => {
  const host = graphicsHost();
  const m = await loadRuntime('graphics.ts', host);
  events = [];
  host.current = '{broken';
  m.refreshGraphics();
  assert.deepEqual(events, []);
  assert.deepEqual(m.graphicsState(), {lumen: false, available: false, models: false});
});

test('jsgb.graphics sends a change to the host as JSON and hands out copies of the state', async () => {
  const host = graphicsHost();
  const m = await loadRuntime('graphics.ts', host);
  const api = globalThis.jsgb.graphics;
  assert.equal(api, m.graphics);
  assert.equal(api.supported, true);
  api.set({lumen: true});
  assert.deepEqual(host.sent, ['{"lumen":true}']);
  const copy = api.get();
  copy.lumen = true;
  assert.equal(api.get().lumen, false);
});

test('a host without graphics is reported as unsupported and ignores changes', async () => {
  const m = await loadRuntime('graphics.ts', {log() {}, registry: ''});
  events = [];
  assert.equal(m.graphics.supported, false);
  m.graphics.set({lumen: true});
  m.refreshGraphics();
  assert.deepEqual(events, []);
});
