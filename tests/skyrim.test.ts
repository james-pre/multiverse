import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { parseEditValue } from '../src/editing.js';
import { skyrim } from '../src/games/skyrim/index.js';
import { parsePlayTime } from '../src/games/skyrim/strings.js';
import { inspector } from '../src/games/skyrim/inspect.js';
import { literalBlock } from './compression.test.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

class Writer {
	protected parts: Uint8Array[] = [];

	protected number(size: number, write: (view: DataView) => void): this {
		const bytes = new Uint8Array(size);
		write(new DataView(bytes.buffer));
		this.parts.push(bytes);
		return this;
	}

	public u8 = (value: number) => this.number(1, view => view.setUint8(0, value));
	public u16 = (value: number) => this.number(2, view => view.setUint16(0, value, true));
	public u32 = (value: number) => this.number(4, view => view.setUint32(0, value, true));
	public i32 = (value: number) => this.number(4, view => view.setInt32(0, value, true));
	public f32 = (value: number) => this.number(4, view => view.setFloat32(0, value, true));
	public u64 = (value: bigint) => this.number(8, view => view.setBigUint64(0, value, true));

	public bytes(bytes: Uint8Array): this {
		this.parts.push(bytes);
		return this;
	}

	public wstring(text: string): this {
		const bytes = encodeUTF8(text);
		return this.u16(bytes.length).bytes(bytes);
	}

	public get length(): number {
		return this.parts.reduce((total, part) => total + part.length, 0);
	}

	public toBytes(): Uint8Array {
		const result = new Uint8Array(this.length);
		let offset = 0;
		for (const part of this.parts) {
			result.set(part, offset);
			offset += part.length;
		}
		return result;
	}
}

interface SaveOptions {
	number: number;
	playTime: string;
	time: Temporal.Instant;
	level: number;
	quests: number;
}

/** A minimal Skyrim save with a 2 by 1 screenshot and misc stats */
function writeSave({ number, playTime, time, level, quests }: SaveOptions): void {
	const fileTime = time.epochNanoseconds / 100n + 116_444_736_000_000_000n;
	const header = new Writer()
		.u32(12)
		.u32(number)
		.wstring('Wozim')
		.u32(level)
		.wstring('Mzulft')
		.wstring(playTime)
		.wstring('BretonRace')
		.u16(0)
		.f32(0)
		.f32(100)
		.u64(fileTime)
		.u32(2)
		.u32(1)
		.u16(2)
		.toBytes();

	const plugins = new Writer().u8(1).wstring('Skyrim.esm').u16(0).toBytes();
	const stats = new Writer()
		.u32(2)
		.wstring('Quests Completed')
		.u8(1)
		.i32(quests)
		.wstring('Whiterun Bounty')
		.u8(5)
		.i32(40)
		.toBytes();
	// The player's change form, with a name and a race, Breton changed from Nord.
	const playerData = new Writer()
		.wstring('Wozim')
		.bytes(new Uint8Array([0x41, 0x37, 0x41, 0x41, 0x37, 0x46]))
		.toBytes();
	const player = new Writer()
		.bytes(new Uint8Array([0x40, 0, 7]))
		.u32((1 << 5) | (1 << 25))
		.u8(9)
		.u8(78)
		.u8(playerData.length)
		.u8(0)
		.bytes(playerData)
		.toBytes();
	const bodyStart = 13 + 4 + header.length + 8;
	const table = 5 + plugins.length;
	const globals = table + 100;
	const forms = globals + 8 + stats.length;
	const body = new Writer()
		.u8(78)
		.u32(plugins.length)
		.bytes(plugins)
		.u32(0)
		.u32(0)
		.u32(bodyStart + globals)
		.u32(bodyStart + forms)
		.u32(bodyStart + forms)
		.u32(bodyStart + forms + player.length)
		.u32(1)
		.u32(0)
		.u32(0)
		.u32(1)
		.bytes(new Uint8Array(15 * 4))
		.u32(0)
		.u32(stats.length)
		.bytes(stats)
		.bytes(player)
		.toBytes();
	const compressed = literalBlock(body);

	const file = new Writer()
		.bytes(encodeUTF8('TESV_SAVEGAME'))
		.u32(header.length)
		.bytes(header)
		.bytes(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))
		.u32(body.length)
		.u32(compressed.length)
		.bytes(compressed);
	writeFileSync(
		join(directory, `Save${number}_7C72702B_0_576F7A696D_Mzulft01_000000_20260321020854_${level}_1.ess`),
		file.toBytes()
	);
}

suite('skyrim', () => {
	const start = Temporal.Instant.from('2026-03-21T00:00:00Z');
	writeSave({ number: 1, playTime: '010.00.00', time: start, level: 10, quests: 3 });
	writeSave({ number: 2, playTime: '011.00.00', time: start.add({ hours: 1 }), level: 11, quests: 4 });
	writeSave({ number: 3, playTime: '010.30.00', time: start.add({ hours: 30 }), level: 10, quests: 3 });

	test('parsePlayTime reads hours, minutes and seconds', () => {
		assert.equal(parsePlayTime('104.19.59'), 104 * 3600 + 19 * 60 + 59);
	});

	test('scan reads the header, misc stats and screenshot', () => {
		const save = skyrim.scan(directory).find(save => save.name == 'Save 2')!;
		assert.equal(save.playthrough, '7C72702B');
		assert.equal(save.playTime, 11 * 3600);
		assert.equal(save.label, 'Mzulft');
		assert.deepEqual(save.highlights, ['Breton', 'Level 11']);
		assert.equal(save.time.toInstant().toString(), '2026-03-21T01:00:00Z');
		assert.deepEqual(save.counters, { level: 11, 'Quests Completed': 4 });
		assert.ok(typeof save.screenshot == 'function');
		assert.deepEqual(Array.from(save.screenshot().data), [255, 0, 0, 255, 0, 0, 255, 255]);
	});

	test('inspect shows the character and plugins', () => {
		const path = skyrim.scan(directory).find(save => save.name == 'Save 1')!.path;
		assert.ok(inspector.recognizes(path));
		const inspection = inspector.open(path);
		assert.ok(inspection.section('character').some(row => row.label == 'Name' && row.value == 'Wozim'));
		assert.deepEqual(
			inspection.section('plugins').map(row => row.label),
			['Skyrim.esm']
		);
	});

	test('edits the level and misc stats, writing them to a copy with the next save number', () => {
		const path = skyrim.scan(directory).find(save => save.name == 'Save 3')!.path;
		const inspection = inspector.open(path);
		const level = inspection.section('character').find(row => row.label == 'Level')!;
		assert.ok(level.edit && !level.edit.safe);
		level.edit.set(50);
		const quests = inspection
			.section('stats')
			.flatMap(row => row.rows ?? [])
			.find(row => row.label == 'Quests Completed')!;
		quests.edit!.set(99);

		const copy = inspector.copy!(path);
		inspection.write!(copy);
		assert.match(copy, /Save4_7C72702B_/);
		const save = skyrim.scan(directory).find(save => save.path == copy)!;
		assert.equal(save.counters?.level, 50);
		assert.equal(save.counters?.['Quests Completed'], 99);
		assert.equal(skyrim.scan(directory).find(save => save.path == path)?.counters?.level, 10);
		rmSync(copy);
	});

	test('edits the name, race and sex in the header and the player change form', () => {
		const path = skyrim.scan(directory).find(save => save.name == 'Save 1')!.path;
		const inspection = inspector.open(path);
		const row = (label: string) => inspection.section('character').find(row => row.label == label)!;
		assert.equal(row('Race').edit?.value, 'BretonRace');
		assert.equal(row('Sex').edit?.value, 'Male');
		row('Name').edit!.set('Wozimington');
		row('Race').edit!.set(parseEditValue(row('Race').edit!, 'nord'));
		row('Sex').edit!.set('Female');
		assert.throws(() => row('Name').edit!.set(' '), /empty/);

		const copy = inspector.copy!(path);
		inspection.write!(copy);
		const edited = inspector.open(copy);
		const values = ['Name', 'Race', 'Sex'].map(
			label => edited.section('character').find(row => row.label == label)?.value
		);
		assert.deepEqual(values, ['Wozimington', 'Nord', 'Female']);
		const editedRow = (label: string) => edited.section('character').find(row => row.label == label)!;
		assert.equal(editedRow('Race').edit?.value, 'NordRace');
		assert.equal(editedRow('Sex').edit?.value, 'Female');
		assert.equal(editedRow('Name').edit?.value, 'Wozimington');
		const stats = edited.section('stats').flatMap(row => row.rows ?? []);
		assert.equal(stats.find(row => row.label == 'Whiterun Bounty')?.value, '40');
		rmSync(copy);
	});
});
