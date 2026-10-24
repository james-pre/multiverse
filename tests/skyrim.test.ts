import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { skyrim } from '../src/games/skyrim/index.js';
import { parsePlayTime } from '../src/games/skyrim/strings.js';
import { inspector } from '../src/games/skyrim/inspect.js';
import { literalBlock } from './lz4.test.js';

const directory = mkdtempSync(join(tmpdir(), 'save-multiverse-'));
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
		.i32(40);
	const body = new Writer()
		.u8(78)
		.u32(plugins.length)
		.bytes(plugins)
		.bytes(new Uint8Array(6 * 4))
		.u32(1)
		.u32(0)
		.u32(0)
		.u32(0)
		.bytes(new Uint8Array(15 * 4))
		.u32(0)
		.u32(stats.length)
		.bytes(stats.toBytes())
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

	test('inspect shows the header and plugins', () => {
		const path = skyrim.scan(directory).find(save => save.name == 'Save 1')!.path;
		assert.ok(inspector.recognizes(path));
		const lines = [...inspector.inspect(path, new Set(['header', 'plugins']))].join('\n');
		assert.match(lines, /Wozim/);
		assert.match(lines, /Skyrim\.esm/);
	});
});
