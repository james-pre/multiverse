import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8, decodeUTF8 } from 'utilium';
import { decompressLZ4 } from '../src/compression.js';

/** An LZ4 block that stores all of `data` as literals */
export function literalBlock(data: Uint8Array): Uint8Array {
	const extra: number[] = [];
	if (data.length >= 15) {
		let remaining = data.length - 15;
		for (; remaining >= 255; remaining -= 255) extra.push(255);
		extra.push(remaining);
	}
	return new Uint8Array([Math.min(data.length, 15) << 4, ...extra, ...data]);
}

suite('lz4', () => {
	test('decompresses literals', () => {
		const data = encodeUTF8('x'.repeat(300));
		assert.equal(decodeUTF8(decompressLZ4(literalBlock(data), data.length)), 'x'.repeat(300));
	});

	test('decompresses overlapping matches', () => {
		// "abc", then a match 3 bytes back for 9 bytes.
		const block = new Uint8Array([0x35, ...encodeUTF8('abc'), 3, 0]);
		assert.equal(decodeUTF8(decompressLZ4(block, 12)), 'abcabcabcabc');
	});

	test('stops at the limit', () => {
		const block = new Uint8Array([0x35, ...encodeUTF8('abc'), 3, 0]);
		assert.equal(decodeUTF8(decompressLZ4(block, 12, 5)), 'abcab');
	});

	test('rejects matches before the start', () => {
		assert.throws(() => decompressLZ4(new Uint8Array([0x10, 0x61, 9, 0]), 10));
	});
});
