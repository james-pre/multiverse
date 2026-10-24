import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { entryLines } from '../src/inspection.js';
import * as nrbf from '../src/nrbf.js';

/** A 32-bit float member, since other numbers are written as 32-bit integers */
export class Single {
	public constructor(public readonly value: number) {}
}

class Bytes {
	public readonly parts: number[] = [];

	public u8(...values: number[]): this {
		this.parts.push(...values);
		return this;
	}

	protected number(size: number, write: (view: DataView) => void): this {
		const bytes = new Uint8Array(size);
		write(new DataView(bytes.buffer));
		this.parts.push(...bytes);
		return this;
	}

	public i32 = (value: number) => this.number(4, view => view.setInt32(0, value, true));
	public f32 = (value: number) => this.number(4, view => view.setFloat32(0, value, true));

	public string(text: string): this {
		const bytes = encodeUTF8(text);
		let length = bytes.length;
		do {
			const byte = length & 0x7f;
			length >>= 7;
			this.parts.push(length ? byte | 0x80 : byte);
		} while (length);
		this.parts.push(...bytes);
		return this;
	}
}

const libraryId = 1000;

/**
 * Serializes objects made of integers, `Single`s, strings, nulls, `Int32Array`s, arrays and nested objects.
 * Objects need `nrbf.className` set.
 */
export function serialize(root: object): Uint8Array {
	const output = new Bytes();
	let nextId = 1;
	const classIds = new Map<string, number>();
	const deferred: (() => void)[] = [];

	const binaryType = (value: unknown): number => {
		if (typeof value == 'number' || value instanceof Single) return 0;
		if (typeof value == 'string') return 1;
		if (value === null) return 2;
		if (value instanceof Int32Array) return 7;
		if (Array.isArray(value)) return 5;
		return 4;
	};

	const writeArray = (id: number, array: Int32Array | unknown[]): void => {
		if (array instanceof Int32Array) {
			output.u8(15).i32(id).i32(array.length).u8(8);
			for (const value of array) output.i32(value);
			return;
		}
		output.u8(16).i32(id).i32(array.length);
		for (let i = 0; i < array.length; i++) {
			if (array[i] !== null) {
				writeValue(array[i]);
				continue;
			}
			let count = 1;
			while (array[i + count] === null) count++;
			output.u8(13).u8(count);
			i += count - 1;
		}
	};

	const writeValue = (value: unknown): void => {
		if (typeof value == 'number') output.i32(value);
		else if (value instanceof Single) output.f32(value.value);
		else if (typeof value == 'string') output.u8(6).i32(nextId++).string(value);
		else if (value === null) output.u8(10);
		else if (value instanceof Int32Array || Array.isArray(value)) {
			const id = nextId++;
			output.u8(9).i32(id);
			deferred.push(() => writeArray(id, value));
		} else writeClass(value as nrbf.Instance);
	};

	const writeClass = (object: nrbf.Instance): void => {
		const id = nextId++;
		const name = object[nrbf.className];
		const members = Object.entries(object);
		const metadataId = classIds.get(name);
		if (metadataId !== undefined) {
			output.u8(1).i32(id).i32(metadataId);
		} else {
			classIds.set(name, id);
			output.u8(5).i32(id).string(name).i32(members.length);
			for (const [member] of members) output.string(member);
			for (const [, value] of members) output.u8(binaryType(value));
			for (const [, value] of members) {
				if (typeof value == 'number' || value instanceof Int32Array) output.u8(8);
				else if (value instanceof Single) output.u8(11);
				else if (binaryType(value) == 4) output.string((value as nrbf.Instance)[nrbf.className]).i32(libraryId);
			}
			output.i32(libraryId);
		}
		for (const [, value] of members) writeValue(value);
	};

	output.u8(0).i32(1).i32(-1).i32(1).i32(0);
	output.u8(12).i32(libraryId).string('Test');
	writeClass(root as nrbf.Instance);
	while (deferred.length) deferred.shift()!();
	output.u8(11);
	return new Uint8Array(output.parts);
}

suite('nrbf', () => {
	const point = (x: number, y: number) => ({ [nrbf.className]: 'Test.Point', x: new Single(x), y: new Single(y) });

	test('reads classes, strings, arrays, references and runs of nulls', () => {
		const data = serialize({
			[nrbf.className]: 'Test.Root',
			count: 42,
			name: 'root',
			values: new Int32Array([1, 2, 3]),
			items: ['item', null, null, point(5, 6)],
			missing: null,
			first: point(1.5, 2.5),
			second: point(3, 4),
		});
		const root = nrbf.parse(data);
		assert.ok(nrbf.isInstance(root));
		assert.equal(root[nrbf.className], 'Test.Root');
		assert.equal(root.count, 42);
		assert.equal(root.name, 'root');
		assert.deepEqual(root.values, new Int32Array([1, 2, 3]));
		assert.equal(root.missing, null);

		const items = root.items as unknown[];
		assert.equal(items.length, 4);
		assert.deepEqual(items.slice(0, 3), ['item', null, null]);
		assert.deepEqual(items[3], { [nrbf.className]: 'Test.Point', x: 5, y: 6 });
		assert.deepEqual(root.first, { [nrbf.className]: 'Test.Point', x: 1.5, y: 2.5 });
		assert.deepEqual(root.second, { [nrbf.className]: 'Test.Point', x: 3, y: 4 });
	});

	test('rejects other data', () => {
		assert.throws(() => nrbf.parse(encodeUTF8('{}')));
	});

	test('shortTypeName drops namespaces and assembly details', () => {
		const name =
			'System.Collections.Generic.Dictionary`2[[System.Int32, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089],[UI.Data+Entry, DNO.Main, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null]]';
		assert.equal(nrbf.shortTypeName(name), 'Dictionary<Int32, Data+Entry>');
	});

	test('entry shows lists as their items and enums by their values', () => {
		const list = {
			[nrbf.className]:
				'System.Collections.Generic.List`1[[System.Int32, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089]]',
			_items: new Int32Array([4, 5, 0, 0]),
			_size: 2,
			_version: 2,
		};
		const root = {
			[nrbf.className]: 'Test.Root',
			mode: { [nrbf.className]: 'Test.Mode', value__: 1 },
			ids: list,
			points: [point(1, 2), point(3, 4), point(5, 6), point(7, 8)],
		};
		assert.deepEqual(
			[...entryLines(nrbf.entry('Root', nrbf.parse(serialize(root))), { items: 3 })],
			[
				'Root: Root',
				'\tmode: Mode(1)',
				'\tids: List<Int32>(2)',
				'\t\t0: 4',
				'\t\t1: 5',
				'\tpoints: Point[4]',
				'\t\t0: Point',
				'\t\t\tx: 1',
				'\t\t\ty: 2',
				'\t\t1: Point',
				'\t\t\tx: 3',
				'\t\t\ty: 4',
				'\t\t2: Point',
				'\t\t\tx: 5',
				'\t\t\ty: 6',
				'\t\t… 1 more',
			]
		);
	});
});
