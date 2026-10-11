// The PNG decoder canvas 2D and textures use when the host has no image decoder (Runtime/src/png.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodePng} from '../../Runtime/src/png.ts';
import {imageSize} from '../../Runtime/src/imageSize.ts';

const file = new URL('../suite/public/quad.png', import.meta.url);

test('decodes the suite texture to RGBA at its own size', () => {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const size = imageSize(bytes);
  const png = decodePng(bytes);
  assert.ok(png);
  assert.equal(png.width, size.width);
  assert.equal(png.height, size.height);
  assert.equal(png.data.length, size.width * size.height * 4);
  assert.ok(png.data.some(v => v !== png.data[0]), 'the image is not one flat value');
});

test('refuses bytes that are not a PNG', () => {
  assert.equal(decodePng(new Uint8Array([1, 2, 3, 4])), null);
});
