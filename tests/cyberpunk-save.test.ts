import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { factHash } from '../src/games/cyberpunk/facts.js';
import { typeName } from '../src/games/cyberpunk/package.js';
import { SaveFile, unpackDateTime } from '../src/games/cyberpunk/save-file.js';
import { literalBlock } from './lz4.test.js';

const directory = mkdtempSync(join(tmpdir(), 'save-multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

class Writer {
	public readonly parts: number[] = [];

	public get length(): number {
		return this.parts.length;
	}

	public bytes(bytes: ArrayLike<number>): this {
		this.parts.push(...Array.from(bytes));
		return this;
	}

	protected number(size: number, write: (view: DataView) => void): this {
		const bytes = new Uint8Array(size);
		write(new DataView(bytes.buffer));
		return this.bytes(bytes);
	}

	public u16 = (value: number) => this.number(2, view => view.setUint16(0, value, true));
	public u32 = (value: number) => this.number(4, view => view.setUint32(0, value, true));
	public i32 = (value: number) => this.number(4, view => view.setInt32(0, value, true));
	public u64 = (value: bigint) => this.number(8, view => view.setBigUint64(0, value, true));

	/** Writes a magic like `CSAV`, which is stored reversed */
	public magic(text: string): this {
		return this.bytes(encodeUTF8(text).toReversed());
	}

	/** A packed integer small enough for one byte */
	public packedInt(value: number): this {
		return this.bytes([value < 0 ? 0x80 | -value : value]);
	}

	public string(text: string): this {
		return this.packedInt(-text.length).bytes(encodeUTF8(text));
	}

	public toBytes(): Uint8Array {
		return new Uint8Array(this.parts);
	}
}

/** A package with a `Root` object that has a handle to a `Child` */
function writePackage(): Uint8Array {
	const names = [
		'Root',
		'level',
		'Int32',
		'mode',
		'ELevel',
		'High',
		'tags',
		'array:CName',
		'child',
		'handle:Child',
		'Child',
		'name',
		'String',
	];
	const index = (name: string) => names.indexOf(name);
	const nameData = new Writer();
	const descriptors = new Writer();
	const namesSize = names.length * 4;
	for (const name of names) {
		descriptors.u32(((name.length + 1) << 24) | (namesSize + nameData.length));
		nameData.bytes(encodeUTF8(name)).bytes([0]);
	}

	const root = new Writer().u16(4);
	const fields = [
		['level', 'Int32', new Writer().i32(5)],
		['mode', 'ELevel', new Writer().u16(index('High'))],
		['tags', 'array:CName', new Writer().u32(2).u16(index('level')).u16(index('mode'))],
		['child', 'handle:Child', new Writer().i32(1)],
	] as const;
	let offset = 2 + fields.length * 8;
	for (const [name, type, value] of fields) {
		root.u16(index(name)).u16(index(type)).u32(offset);
		offset += value.length;
	}
	for (const [, , value] of fields) root.bytes(value.parts);
	const child = new Writer().u16(1).u16(index('name')).u16(index('String')).u32(10).string('x');

	const chunksStart = namesSize + nameData.length;
	const chunks = new Writer()
		.u32(index('Root'))
		.u32(chunksStart + 16)
		.u32(index('Child'))
		.u32(chunksStart + 16 + root.length);
	return new Writer()
		.u16(4)
		.u16(6)
		.u32(1)
		.u32(0)
		.u32(namesSize)
		.u32(chunksStart)
		.u32(chunksStart + 16)
		.bytes(descriptors.parts)
		.bytes(nameData.parts)
		.bytes(chunks.parts)
		.bytes(root.parts)
		.bytes(child.parts)
		.toBytes();
}

function writeSave(path: string): void {
	const facts = new Writer().i32(1).packedInt(2).u32(factHash('q001_done')).u32(factHash('q101_done')).i32(1).i32(3);
	const packageData = writePackage();
	const systems = new Writer().i32(2).i32(packageData.length).bytes(packageData);
	const data = new Writer().i32(0).bytes(facts.parts).bytes(systems.parts).toBytes();

	const dataStart = 64;
	const chunk = new Writer().magic('XLZ4').u32(data.length).bytes(literalBlock(data));
	const header = new Writer()
		.magic('CSAV')
		.u32(269)
		.u32(2310)
		.string('')
		.u64(0x7ea41000_05ccedden)
		.u32(195)
		.magic('CLZF')
		.u32(1)
		.u32(dataStart)
		.u32(chunk.length)
		.u32(data.length);
	header.bytes(new Uint8Array(dataStart - header.length));

	const tableOffset = dataStart + chunk.length;
	const table = new Writer()
		.magic('NODE')
		.packedInt(3)
		.string('questSystem')
		.i32(2)
		.i32(1)
		.u32(dataStart)
		.u32(4 + facts.length)
		.string('FactsTable')
		.i32(-1)
		.i32(-1)
		.u32(dataStart + 4)
		.u32(facts.length)
		.string('ScriptableSystemsContainer')
		.i32(-1)
		.i32(-1)
		.u32(dataStart + 4 + facts.length)
		.u32(systems.length);

	const file = new Writer().bytes(header.parts).bytes(chunk.parts).bytes(table.parts).u32(tableOffset).magic('DONE');
	writeFileSync(path, file.toBytes());
}

suite('cyberpunk save file', () => {
	const path = join(directory, 'sav.dat');
	writeSave(path);

	test('unpackDateTime reads the packed date and time', () => {
		assert.equal(unpackDateTime(0x7ea41000_05ccedden).toString(), '2026-09-05T23:12:59.478');
	});

	test('reads the header and the node tree', () => {
		const file = new SaveFile(path);
		assert.equal(file.header.saveVersion, 269);
		assert.equal(file.header.gameVersion, 2310);
		assert.equal(file.header.time.toString(), '2026-09-05T23:12:59.478');
		assert.deepEqual(
			file.roots.map(node => node.name),
			['questSystem', 'ScriptableSystemsContainer']
		);
		assert.equal(file.find('FactsTable')?.parent?.name, 'questSystem');
	});

	test('reads facts by the hashes of their names', () => {
		const facts = new SaveFile(path).facts();
		assert.equal(facts.get(factHash('q001_done')), 1);
		assert.equal(facts.get(factHash('q101_done')), 3);
	});

	test('reads packages, with enums, names and handles', () => {
		const file = new SaveFile(path);
		const node = file.find('ScriptableSystemsContainer')!;
		assert.ok(file.isPackage(node));
		assert.ok(!file.isPackage(file.find('FactsTable')!));
		const [root, child] = file.package(node).objects;
		assert.equal(root[typeName], 'Root');
		assert.equal(root.level, 5);
		assert.equal(root.mode, 'High');
		assert.deepEqual(root.tags, ['level', 'mode']);
		assert.equal(root.child, child);
		assert.equal(child.name, 'x');
	});
});
