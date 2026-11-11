// Base64 (atob, data: URLs) and the image files a 2D canvas decodes: PNG, JPEG and the BMP canvas.toDataURL writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {base64Bytes, bytesBase64} from '../../Runtime/src/base64.ts';
import {decodeImageFile} from '../../Runtime/src/imageDecode.ts';
import {imageSize} from '../../Runtime/src/imageSize.ts';

test('base64 round-trips every length and matches Node', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 100, 1001, 65537]) {
    const b = new Uint8Array(crypto.randomBytes(n));
    const s = Buffer.from(b).toString('base64');
    assert.equal(bytesBase64(b), s);
    assert.deepEqual(Buffer.from(base64Bytes(s)), Buffer.from(b));
    assert.deepEqual(Buffer.from(base64Bytes(s.replace(/(.{60})/g, '$1\n'))), Buffer.from(b), 'line breaks ignored');
  }
});

test('a 32-bit top-down BMP (canvas toDataURL) decodes to RGBA and reports its size', () => {
  const w = 3, h = 2, out = new Uint8Array(54 + w * h * 4), v = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; v.setUint32(2, out.length, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, -h, true); v.setUint16(26, 1, true); v.setUint16(28, 32, true);
  const px = 54 + (1 * w + 2) * 4; out[px] = 30; out[px + 1] = 20; out[px + 2] = 10; out[px + 3] = 255; // BGRA at (2, 1)
  assert.deepEqual(imageSize(out), {width: 3, height: 2});
  const p = decodeImageFile(out);
  assert.ok(p);
  const o = (1 * w + 2) * 4;
  assert.deepEqual([...p.data.slice(o, o + 4)], [10, 20, 30, 255]);
});

test('a JPEG decodes (Tray portraits are JPEGs)', () => {
  // 8x8 baseline JPEG, colour (200, 150, 100).
  const jpg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD1Oiiivyc/TT//2Q==', 'base64');
  const p = decodeImageFile(new Uint8Array(jpg));
  assert.ok(p, 'decoded');
  assert.equal(p.width, 8); assert.equal(p.height, 8);
  assert.ok(Math.abs(p.data[0] - 200) < 6 && Math.abs(p.data[1] - 150) < 6 && Math.abs(p.data[2] - 100) < 6, `colour ${[...p.data.slice(0, 3)]}`);
});
