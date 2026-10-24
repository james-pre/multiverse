import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { diplomacyIsNotAnOption } from '../src/games/diplomacy-is-not-an-option/index.js';
import { inspector } from '../src/games/diplomacy-is-not-an-option/inspect.js';
import * as nrbf from '../src/nrbf.js';
import { Timeline } from '../src/timeline.js';
import { serialize, Single } from './nrbf.test.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));
mkdirSync(join(directory, 'Lord'));

interface SaveOptions {
	name: string;
	time: Temporal.Instant;
	playTime: number;
	kills: number;
	research: number[];
	mission?: number;
}

function writeSave({ name, time, playTime, kills, research, mission = 7 }: SaveOptions): void {
	const path = join(directory, 'Lord', name);
	const container = {
		[nrbf.className]: 'Utility.SaveContainer',
		saveVersion: 16,
		mapSeed: 99,
		missionIndex: mission,
		difficultyIndex: 1,
		sessionTime: {
			[nrbf.className]: 'Components.SingletonComponents.CurrentSessionTimeSingleton',
			elapsedTime: new Single(playTime * 2),
			elapsedTimeUnscaled: new Single(playTime),
		},
		research: {
			[nrbf.className]: 'Utility.ResearchSaveData',
			completeBuildings: new Int32Array(research),
			completeResearches: new Int32Array([]),
		},
		buildings: [null, null],
		citizens: [null, null, null],
		deathCounter: {
			[nrbf.className]: 'Components.SingletonComponents.KilledEnemiesCounterSingleton',
			value: kills,
		},
		currentGold: {
			[nrbf.className]: 'Components.ResourceSaveData',
			valueContainer: {
				[nrbf.className]: 'Components.ResourceValueContainer',
				value: 100,
				dailyIncrease: 5,
				dailyDecrease: 1,
			},
		},
	};
	writeFileSync(path, serialize(container));
	writeFileSync(`${path}.dat`, '');
	const seconds = time.epochMilliseconds / 1000;
	utimesSync(path, seconds, seconds);
}

suite('diplomacy is not an option', () => {
	const start = Temporal.Instant.from('2026-10-11T20:00:00Z');
	writeSave({ name: 'Wake-up call, mission start', time: start, playTime: 1, kills: 0, research: [1] });
	writeSave({ name: 'AutoSave_1', time: start.add({ minutes: 10 }), playTime: 600, kills: 20, research: [1, 2] });
	writeSave({ name: 'Grrr', time: start.add({ minutes: 20 }), playTime: 1200, kills: 50, research: [1, 2, 3] });
	writeSave({ name: 'AutoSave_2', time: start.add({ hours: 24 }), playTime: 300, kills: 5, research: [1, 4] });
	writeSave({ name: 'Elsewhere', time: start, playTime: 100, kills: 0, research: [], mission: 8 });

	test('scan reads the save container', () => {
		const save = diplomacyIsNotAnOption.scan(directory).find(save => save.name == 'Grrr')!;
		assert.equal(save.playthrough, 'Lord/7/99');
		assert.equal(save.playTime, 1200);
		assert.equal(save.kind, 'manual');
		assert.equal(save.time.toInstant().toString(), start.add({ minutes: 20 }).toString());
		assert.deepEqual(save.highlights, ['3 citizens', '50 kills']);
		assert.deepEqual(save.counters, { kills: 50, gameTime: 2400 });
		assert.deepEqual(save.companions, [`${save.path}.dat`]);
	});

	test('checkpoints are named after their mission', () => {
		const save = diplomacyIsNotAnOption.scan(directory).find(save => save.name.endsWith('mission start'))!;
		assert.equal(save.kind, 'auto');
		assert.equal(save.label, 'Wake-up call');
	});

	test('saves are grouped by mission and branch where research differs', () => {
		const timelines = Timeline.fromSaves(diplomacyIsNotAnOption.scan(directory));
		assert.equal(timelines.length, 2);
		const timeline = timelines.find(timeline => timeline.playthrough == 'Lord/7/99')!;
		assert.equal(diplomacyIsNotAnOption.describe(timeline), 'Grrr · 3 citizens');
		assert.deepEqual(Object.fromEntries(timeline.nodes.map(node => [node.save.name, node.parent?.save.name])), {
			'Wake-up call, mission start': undefined,
			AutoSave_1: 'Wake-up call, mission start',
			Grrr: 'AutoSave_1',
			AutoSave_2: 'Wake-up call, mission start',
		});
	});

	test('inspect recognizes saves by either file and shows the session', () => {
		const path = join(directory, 'Lord', 'Grrr');
		assert.ok(inspector.recognizes(path));
		assert.ok(inspector.recognizes(`${path}.dat`));
		const inspection = inspector.open(`${path}.dat`);
		assert.equal(inspection.section('session').find(row => row.label == 'Enemies killed')?.value, '50');
		const [buildings] = inspection.section('research');
		assert.equal(buildings.value, '3');
		assert.deepEqual(
			buildings.rows?.map(row => row.label),
			['1', '2', '3']
		);
		assert.ok(inspection.section('entities').some(row => row.label == 'Citizens' && row.value == '3'));
	});

	test('edits resources and writes them to a copy beside the save', () => {
		const path = join(directory, 'Lord', 'Grrr');
		const inspection = inspector.open(path);
		const [resource] = inspection.section('resources');
		assert.ok(resource.edit?.safe);
		resource.edit.set(1234);
		const copy = inspector.copy!(path);
		inspection.write!(copy);
		assert.equal(copy, join(directory, 'Lord', 'Grrr copy'));
		assert.ok(existsSync(`${copy}.dat`));
		assert.equal(inspector.open(copy).section('resources')[0].value, '1,234');
		assert.equal(inspector.open(path).section('resources')[0].value, resource.value);
		rmSync(copy);
		rmSync(`${copy}.dat`);
	});
});
