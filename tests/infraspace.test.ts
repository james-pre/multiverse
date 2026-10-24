import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { infraspace } from '../src/games/infraspace/index.js';
import { inspector } from '../src/games/infraspace/inspect.js';
import { objectAfter, parseDate } from '../src/games/infraspace/save-file.js';
import { Timeline } from '../src/timeline.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

interface SaveOptions {
	version: string;
	name: string;
	date: string;
	playTime: number;
	nextId: number;
	research: Record<string, number>;
	map?: string;
}

/** A save with the sections the adapter reads, separated by filler like the buildings that real saves have */
function writeSave({ version, name, date, playTime, nextId, research, map }: SaveOptions): void {
	const body = {
		mapSeed: 1234,
		nextID: nextId,
		simulationFrame: nextId * 10,
		totalGameTime: playTime * 1.5,
		totalPlayTime: playTime,
		buildings: Array.from({ length: 100 }, (_, i) => ({ buildingName: 'powerPole', ID: i, customName: '{' })),
		goalManager: { currentGoal: null, currentGoalIndex: 1 },
		researchManager: { researchProgress: research, currentResearch: null, researchQueue: [] },
		populationManager: { cityLevel: 3 },
		storyMessagesModule: { shownMessages: ['Welcome'] },
	};
	const header = ['InfraSpace', version, ...(map ? [map] : []), date];
	mkdirSync(join(directory, version), { recursive: true });
	writeFileSync(
		join(directory, version, `${name}.sav`),
		'﻿' + [...header, JSON.stringify(body, null, 2)].join('\r\n')
	);
}

suite('infraspace', () => {
	writeSave({
		version: 'Alpha 12.6.259',
		name: 'Kurai',
		date: '03/29/2023 00:23:19',
		playTime: 1000,
		nextId: 500,
		research: { farming: 10000, stadiums: 10000 },
	});
	writeSave({
		version: 'InfraSpace 1.56.460',
		name: 'Autosave 1',
		date: '10/11/2026 20:00:00',
		playTime: 1500,
		nextId: 600,
		research: { farming: 10, trains: 0 },
		map: 'BiomesWorld',
	});
	writeSave({
		version: 'InfraSpace 1.56.460',
		name: 'Kurai v2',
		date: '10/11/2026 20:10:00',
		playTime: 2000,
		nextId: 700,
		research: { farming: 10, trains: 200 },
		map: 'BiomesWorld',
	});

	test('parseDate reads month first, in UTC', () => {
		assert.equal(parseDate('10/11/2026 21:58:04').toString(), '2026-10-11T21:58:04Z');
	});

	test('objectAfter ignores braces in strings', () => {
		assert.deepEqual(objectAfter('{"a": {"b": "}{"}, "c": 1}', 'a'), { b: '}{' });
	});

	test('scan reads the header, play time and managers', () => {
		const save = infraspace.scan(directory).find(save => save.name == 'Kurai v2')!;
		assert.equal(save.playthrough, '1234');
		assert.equal(save.playTime, 2000);
		assert.equal(save.kind, 'manual');
		assert.equal(save.label, 'InfraSpace 1.56.460');
		assert.equal(save.time.toInstant().toString(), '2026-10-11T20:10:00Z');
		assert.deepEqual(save.highlights, ['City level 3', '2 researched']);
		assert.deepEqual([...save.progress], ['Welcome']);
		assert.equal(save.counters?.['research.trains'], 1);
	});

	test('saves continue across game versions, even when research was removed', () => {
		const [timeline] = Timeline.fromSaves(infraspace.scan(directory));
		assert.deepEqual(
			[...timeline.walk()].map(step => [step.node.save.name, step.isBranchStart]),
			[
				['Kurai', true],
				['Autosave 1', false],
				['Kurai v2', false],
			]
		);
		assert.equal(timeline.nodes.find(node => node.save.name == 'Autosave 1')?.save.kind, 'auto');
	});

	test('inspect shows the header, city, research and contents', () => {
		const path = join(directory, 'InfraSpace 1.56.460', 'Kurai v2.sav');
		assert.ok(inspector.recognizes(path));
		const inspection = inspector.open(path);
		const city = inspection.section('city');
		assert.ok(city.some(row => row.label == 'Map' && row.value == 'BiomesWorld'));
		assert.ok(city.some(row => row.label == 'City level' && row.value == '3'));
		const researched = inspection.section('research').find(row => row.label == 'Researched');
		assert.deepEqual(
			researched?.rows?.map(row => row.label),
			['Farming', 'Trains']
		);
		assert.ok(inspection.section('contents').some(row => row.label == 'Buildings' && row.value == '100'));
	});
});
