import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { encodeUTF8 } from 'utilium';
import { plagueInc } from '../src/games/plague-inc/index.js';
import { inspector } from '../src/games/plague-inc/inspect.js';
import { ticksToDateTime } from '../src/dotnet.js';
import { decodeValue, readField, replaceField } from '../src/games/plague-inc/save-file.js';
import { Timeline } from '../src/timeline.js';
import { literalLzf } from './compression.test.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

const base64 = (text: string) => encodeUTF8(text).toBase64();

/** Fields with each value stored as base64, like the game does */
function fields(values: Record<string, string>): string {
	return Object.entries(values)
		.map(([name, value]) => `${name}:${base64(value)}`)
		.join('\n');
}

interface SaveOptions {
	slot: number;
	start: bigint;
	day: number;
	gameTime: number;
	history: string;
}

function writeSave({ slot, start, day, gameTime, history }: SaveOptions): void {
	const disease = fields({
		name: 'PAX-12',
		diseaseType: 'NEURAX',
		diseaseTypeGui: 'Neurax Worm',
		difficulty: '2',
		turnNumber: String(day),
		evoPoints: '12',
		totalInfected: '2086',
		totalDead: '0',
		cureCompletePercent: '0.25',
		tech: history.replace(/\d+@/g, ''),
		techhistory: history,
	});
	const world = fields({ startDate: String(start), gameType: 'Official', totalPopulation: '8212708793' });
	const usa = fields({ name: 'USA' });
	const usaState = fields({ infectedPercent: '0.5', deadPercent: '0.1', originalPopulation: '316128839' });
	const save = [
		'version:0.1.1',
		`world:${base64(world)}`,
		`0:${base64(disease)}`,
		`usa:${base64(usa)}`,
		`0/usa:${base64(usaState)}`,
		`gameTime:${gameTime}`,
	].join('\n');
	writeFileSync(join(directory, `save_${slot}.dat`), literalLzf(encodeUTF8(save)).toBase64());
}

suite('plague inc', () => {
	const start = 639273455185067800n;
	writeSave({ slot: 21, start, day: 75, gameTime: 185, history: '3@adult,11@announce_game' });
	writeSave({ slot: 22, start, day: 184, gameTime: 290, history: '3@adult,11@announce_game,16@launch_kickstarter' });
	writeSave({ slot: 23, start: start + 1n, day: 4, gameTime: 56, history: '' });
	const slot = (number: number, day: number, date: string) =>
		`${number}:${day}:2:1:0:0:${base64('PAX-12')}:${base64('board_game')}:${base64(date)}:NEURAX:Official:3:${base64('0')}::0:${base64('Neurax Worm')}:\n`;
	writeFileSync(
		join(directory, 'meta.dat'),
		slot(21, 75, '10/11/2026 20:01:47') + slot(22, 184, '10/11/2026 20:03:31')
	);

	test('decodeValue decodes base64 until it is no longer text', () => {
		assert.equal(decodeValue(base64(base64('day:1\n'))), 'day:1\n');
		assert.equal(decodeValue('Official'), 'Official');
		assert.equal(decodeValue('184'), '184');
	});

	test('ticksToDateTime reads .NET ticks', () => {
		assert.equal(ticksToDateTime(start).toString(), '2026-10-11T19:58:38.50678');
	});

	test('scan groups saves by run and reads the slot list', () => {
		const saves = plagueInc.scan(directory);
		const save = saves.find(save => save.name == 'Slot 22')!;
		assert.equal(save.label, 'PAX-12');
		assert.equal(save.playTime, 290);
		assert.deepEqual(save.highlights, ['Neurax Worm', 'Day 184']);
		assert.equal(save.time.toPlainDateTime().toString(), '2026-10-11T20:03:31');
		assert.deepEqual(save.counters, { day: 184 });

		const timelines = Timeline.fromSaves(saves);
		assert.equal(timelines.length, 2);
		const run = timelines.find(timeline => timeline.nodes.length == 2)!;
		assert.equal(run.find(save.id)?.parent?.save.name, 'Slot 21');
		assert.equal(plagueInc.describe(run), 'PAX-12 · Neurax Worm');
	});

	test('inspect shows the disease, world and countries', () => {
		const path = join(directory, 'save_22.dat');
		assert.ok(inspector.recognizes(path));
		const inspection = inspector.open(path);
		const disease = inspection.section('disease');
		assert.ok(disease.some(row => row.label == 'Difficulty' && row.value == 'Brutal'));
		assert.deepEqual(
			disease.find(row => row.label == 'Evolved traits')?.rows?.map(row => row.label),
			['Adult', 'Announce game', 'Launch kickstarter']
		);
		assert.ok(inspection.section('world').some(row => row.label == 'Cure' && row.value == '25%'));
		assert.deepEqual(inspection.section('countries'), [
			{ label: 'USA', value: '50%', detail: '10% dead of 316,128,839' },
		]);
	});

	test('replaceField changes every line of a nested field, encoding each level as it was', () => {
		const text = `a:1\n0:${base64(base64('dna:5\nx:y\ndna:5\n'))}`;
		const replaced = replaceField(text, ['0', 'dna'], '9');
		assert.equal(readField(replaced, ['0', 'dna']), '9');
		assert.equal(replaced, `a:1\n0:${base64(base64('dna:9\nx:y\ndna:9\n'))}`);
	});

	test('edits DNA points and writes them to a copy in the next slot, which the slot list includes', () => {
		const path = join(directory, 'save_22.dat');
		const inspection = inspector.open(path);
		const dna = inspection.section('disease').find(row => row.label == 'DNA points')!;
		assert.ok(dna.edit?.safe);
		assert.equal(dna.edit.value, 12);
		dna.edit.set(500);
		const copy = inspector.copy!(path);
		inspection.write!(copy);
		assert.equal(copy, join(directory, 'save_24.dat'));
		assert.equal(
			inspector
				.open(copy)
				.section('disease')
				.find(row => row.label == 'DNA points')?.value,
			'500'
		);
		assert.equal(
			inspector
				.open(path)
				.section('disease')
				.find(row => row.label == 'DNA points')?.value,
			'12'
		);
		assert.match(readFileSync(join(directory, 'meta.dat'), 'utf8'), /^24:184:/m);
		assert.equal(plagueInc.scan(directory).find(save => save.path == copy)?.name, 'Slot 24');
	});
});
