import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {shipShaders} from '../../Tools/ship-shaders.mjs';
test('packaging rejects a failed known shader and copies only complete translations', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-package-'));
  try {
    const store = path.join(dir, 'store'); fs.mkdirSync(store);
    const name = 'shader-' + 'a'.repeat(32) + '.json';
    fs.writeFileSync(path.join(store, name), '{"failed":true}');
    assert.throws(() => shipShaders(store, dir), /Shader .* is not ready; fix its shader error and package again/);
    fs.writeFileSync(path.join(store, name), JSON.stringify({key: 'test', hlsl: 'complete'}));
    assert.equal(shipShaders(store, dir), 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'jsgb-store', name))).hlsl, 'complete');
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
