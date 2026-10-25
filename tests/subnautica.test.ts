import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { subnautica } from '../src/games/subnautica/index.js';
import { inspector } from '../src/games/subnautica/inspect.js';
import { fieldEdit, readFields } from '../src/protobuf.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

/** Ticks that lose precision as a number */
const start = '638610803244323210';

function writeSlot(folderName: string, gameTime: number, dateTicks: string): void {
	mkdirSync(join(directory, folderName), { recursive: true });
	writeFileSync(
		join(directory, folderName, 'gameinfo.json'),
		`﻿{"version":2,"gameTime":${gameTime},"dateTicks":${dateTicks},"startTicks":${start},"changeSet":83031,"gameMode":0,"seamothPresent":true,"cyclopsPresent":false}`
	);
}

function varint(value: number): number[] {
	const bytes: number[] = [];
	do {
		bytes.push((value & 0x7f) | (value > 0x7f ? 0x80 : 0));
		value = Math.floor(value / 0x80);
	} while (value);
	return bytes;
}

/** A protocol buffer message, from its fields' numbers and values, where floats are written as fixed32 */
function message(fields: [number, number | string | number[] | { float: number } | { double: number }][]): number[] {
	return fields.flatMap(([number, value]) => {
		if (typeof value == 'number') return [...varint(number << 3), ...varint(value)];
		if (typeof value == 'string') value = Array.from(encodeUTF8(value));
		if (Array.isArray(value)) return [...varint((number << 3) | 2), ...varint(value.length), ...value];
		const isFloat = 'float' in value;
		const bytes = new Uint8Array(isFloat ? 4 : 8);
		const view = new DataView(bytes.buffer);
		if ('float' in value) view.setFloat32(0, value.float, true);
		else view.setFloat64(0, value.double, true);
		return [...varint((number << 3) | (isFloat ? 5 : 1)), ...bytes];
	});
}

function delimited(bytes: number[]): number[] {
	return [...varint(bytes.length), ...bytes];
}

/** An object as `ProtobufSerializer` writes it, with each component's type and message */
function object(id: string, components: [string, number[]][]): number[] {
	return [
		...delimited(
			message([
				[2, 1],
				[6, id],
			])
		),
		...delimited(message([[1, components.length]])),
		...components.flatMap(([type, data]) => [
			...delimited(
				message([
					[1, type],
					[2, 1],
				])
			),
			...delimited(data),
		]),
	];
}

function writeObjects(folderName: string): void {
	const player = object('player', [
		['LiveMixin', message([[1, { float: 80 }]])],
		[
			'Survival',
			message([
				[1, 1],
				[2, { float: 40 }],
				[3, { float: 60 }],
				[4, { float: 0 }],
			]),
		],
		[
			'Player',
			message([
				[1, 5],
				[5, 528],
				[5, 43],
				[13, 3],
			]),
		],
	]);
	const cycle = [
		...delimited(message([[1, 1]])),
		...object('cycle', [
			[
				'DayNightCycle',
				message([
					[1, 2],
					[3, { double: 2500 }],
				]),
			],
		]),
	];
	const entry = (name: string, data: number[], isTree: number) =>
		message([
			[1, name],
			[
				2,
				message([
					[1, 2],
					[2, name],
					[3, data],
					[4, isTree],
				]),
			],
		]);
	const scene = message([
		[1, 1],
		[2, entry('Player', player, 0)],
		[2, entry('DayNightCycle', cycle, 1)],
	]);
	writeFileSync(join(directory, folderName, 'scene-objects.bin'), new Uint8Array(delimited(scene)));
	const global = [
		...delimited(
			message([
				[1, 1369164567],
				[2, 4],
			])
		),
		...delimited(message([[1, 2]])),
		...object('base', [['BaseRoot', []]]),
		...object('beacon', [['Beacon', message([[1, 'Home']])]]),
	];
	writeFileSync(join(directory, folderName, 'global-objects.bin'), new Uint8Array(global));
}

suite('protobuf', () => {
	test('reads fields and edits varints in the size they have', () => {
		const data = new Uint8Array(
			message([
				[1, 300],
				[2, 'hi'],
				[3, { float: 1.5 }],
			])
		);
		const [count, name, float] = readFields(data);
		assert.deepEqual([count.number, name.length, float.number], [1, 2, 3]);
		const edit = fieldEdit(count)!;
		assert.equal(edit.value, 300);
		assert.equal(edit.maximum, 2 ** 14 - 1);
		edit.set(5);
		assert.equal(fieldEdit(readFields(data)[0])!.value, 5);
		assert.equal(data.length, 12);
		assert.throws(() => edit.set(2 ** 14));
		fieldEdit(float)!.set(2.5);
		assert.equal(fieldEdit(readFields(data)[2])!.value, 2.5);
	});
});

suite('Subnautica', () => {
	writeSlot('slot0001', 55515, '639008830447033331');
	writeSlot('slot0003', 60000, '639018830447033331');
	writeSlot('slot0001_backup', 50000, '638908830447033331');

	test('reads slots, with exact ticks', () => {
		const saves = subnautica.scan(directory).toSorted((a, b) => a.playTime - b.playTime);
		assert.deepEqual(
			saves.map(save => save.name),
			['Slot 1', 'Slot 3']
		);
		const [first] = saves;
		assert.equal(first.playthrough, start);
		assert.equal(first.id, 'slot0001@639008830447033331');
		assert.equal(first.time.toPlainDateTime().toString(), '2025-12-09T13:17:24.7033331');
		assert.deepEqual(first.highlights, ['Seamoth']);
	});

	test('freeSlot picks the slot after the highest', () => {
		assert.ok(subnautica.archive && 'freeSlot' in subnautica.archive);
		assert.equal(subnautica.archive.freeSlot(directory), 'slot0004');
	});

	test('inspects the player and world, and edits them in a copy with a new save time', () => {
		writeObjects('slot0003');
		const path = join(directory, 'slot0003');
		assert.ok(inspector.recognizes(path));
		const inspection = inspector.open(path);
		const row = (section: string, label: string) => inspection.section(section).find(row => row.label == label)!;
		assert.equal(row('player', 'Health').value, '80');
		assert.equal(row('player', 'Blueprints known').value, '2');
		assert.equal(row('player', 'Things scanned').value, '1');
		assert.equal(row('game', 'Day').value, '3');
		assert.equal(row('world', 'Beacons').value, '1');
		assert.ok(row('player', 'Food').edit?.safe);
		assert.throws(() => row('player', 'Water').edit!.set(101), /highest/);
		row('player', 'Food').edit!.set(150);
		row('player', 'Health').edit!.set(100);
		row('game', 'Game mode').edit!.set(1790);

		const copy = inspector.copy!(path);
		assert.equal(copy, join(directory, 'slot0004'));
		inspection.write!(copy);
		const edited = inspector.open(copy);
		const editedRow = (section: string, label: string) =>
			edited.section(section).find(row => row.label == label)?.value;
		assert.deepEqual(
			[editedRow('player', 'Food'), editedRow('player', 'Health'), editedRow('game', 'Game mode')],
			['150', '100', 'Creative']
		);
		assert.equal(
			inspector
				.open(path)
				.section('player')
				.find(row => row.label == 'Food')?.value,
			'40'
		);
		const ids = subnautica.scan(directory).map(save => save.id);
		assert.ok(!ids.includes('slot0004@639018830447033331'), 'the copy has a new save time');
		const contents = edited.contents().children!();
		assert.deepEqual(
			contents.map(entry => entry.name),
			['gameinfo.json', 'scene-objects.bin', 'global-objects.bin']
		);
	});
});
