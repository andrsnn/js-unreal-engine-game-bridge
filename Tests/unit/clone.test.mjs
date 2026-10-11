// The byte encoding for worker messages (Runtime/src/clone.ts): what goes in comes back out.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode, decode, hashBytes} from '../../Runtime/src/clone.ts';

const roundTrip = value => decode(encode(value).buffer);

test('plain data, special numbers and undefined survive', () => {
  const value = {a: 1, b: 'two', c: [true, null, {d: 4}], e: undefined, f: NaN, g: -Infinity, h: 12345678901234567890n};
  const back = roundTrip(value);
  assert.deepEqual({...back, f: String(back.f)}, {...value, f: 'NaN'});
});

test('typed arrays keep their type, offset and length, and share a buffer when they did', () => {
  const buffer = new ArrayBuffer(64);
  const floats = new Float32Array(buffer, 16, 4); floats.set([1.5, -2, 3, 4]);
  const bytes = new Uint8Array(buffer, 0, 8); bytes.set([1, 2, 3, 4, 5, 6, 7, 8]);
  const back = roundTrip({floats, bytes});
  assert.ok(back.floats instanceof Float32Array);
  assert.deepEqual([...back.floats], [1.5, -2, 3, 4]);
  assert.deepEqual([...back.bytes], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(back.floats.buffer, back.bytes.buffer);
});

test('maps, sets, dates and a key named $', () => {
  const value = {map: new Map([['k', 1], [2, [3]]]), set: new Set(['x', 'y']), date: new Date(1700000000000), $: 'dollar'};
  const back = roundTrip(value);
  assert.deepEqual([...back.map], [...value.map]);
  assert.deepEqual([...back.set], [...value.set]);
  assert.equal(back.date.getTime(), value.date.getTime());
  assert.equal(back.$, 'dollar');
});

test('values a worker cannot send are refused', () => {
  assert.equal(encode({f: () => 1}), null);
  assert.equal(encode(new (class Thing {})()), null);
});

test('hashBytes depends on the bytes and the seed', () => {
  const a = hashBytes(new Uint8Array([1, 2, 3, 4, 5])), b = hashBytes(new Uint8Array([1, 2, 3, 4, 6]));
  assert.notEqual(a, b);
  assert.notEqual(hashBytes(new Uint8Array([1, 2, 3]), 'x'), hashBytes(new Uint8Array([1, 2, 3]), 'y'));
  assert.equal(a, hashBytes(new Uint8Array([1, 2, 3, 4, 5])));
});
