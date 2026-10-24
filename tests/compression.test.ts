import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8, decodeUTF8 } from 'utilium';
import { compressLZ4, compressLzf, decompressLZ4, decompressLzf } from '../src/compression.js';

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

/** LZF data that stores all of `data` as literals */
export function literalLzf(data: Uint8Array): Uint8Array {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 32) {
		const run = data.subarray(start, start + 32);
		output.push(run.length - 1, ...run);
	}
	return new Uint8Array(output);
}

suite('lzf', () => {
	test('decompresses literals', () => {
		const data = encodeUTF8('y'.repeat(100));
		assert.equal(decodeUTF8(decompressLzf(literalLzf(data))), 'y'.repeat(100));
	});

	test('decompresses overlapping back references', () => {
		// "abc", then a reference 3 bytes back for 1 + 2 bytes, then one for 7 + 2 + 3 bytes.
		const data = new Uint8Array([2, ...encodeUTF8('abc'), 0x20, 2, 0xe0, 3, 2]);
		assert.equal(decodeUTF8(decompressLzf(data)), 'abc' + 'abc' + 'abcabcabcabc');
	});

	test('rejects references before the start', () => {
		assert.throws(() => decompressLzf(new Uint8Array([0, 0x61, 0x20, 9])));
	});
});

/** Data with repeats, runs and noise, which exercises every kind of match */
function sample(): Uint8Array[] {
	const text = encodeUTF8('The quick brown fox jumps over the lazy dog. '.repeat(500));
	const noise = new Uint8Array(70_000).map((_, i) => (Math.imul(i, 2654435761) >>> 24) & 0xff);
	const mixed = new Uint8Array([...text, ...noise, ...new Uint8Array(1000).fill(7), ...text.subarray(0, 300)]);
	return [new Uint8Array(0), new Uint8Array([1, 2, 3]), new Uint8Array(12).fill(9), text, noise, mixed];
}

suite('compression', () => {
	test('compressLZ4 writes blocks that decompress to the same data', () => {
		for (const data of sample()) {
			const compressed = compressLZ4(data);
			assert.deepEqual(decompressLZ4(compressed, data.length), data);
		}
		assert.ok(compressLZ4(sample()[3]).length < sample()[3].length / 10);
	});

	test('compressLzf writes data that decompresses to the same data', () => {
		for (const data of sample()) assert.deepEqual(decompressLzf(compressLzf(data)), data);
		assert.ok(compressLzf(sample()[3]).length < sample()[3].length / 10);
	});
});
