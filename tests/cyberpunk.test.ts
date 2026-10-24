import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { convertToManual, cyberpunk, parseTimestamp } from '../src/games/cyberpunk/index.js';

const directory = mkdtempSync(join(tmpdir(), 'save-timeline-'));
after(() => rmSync(directory, { recursive: true, force: true }));

function writeSave(name: string, playthroughTime: number): void {
	mkdirSync(join(directory, name));
	const metadata = {
		RootType: 'saveMetadataContainer',
		Data: {
			metadata: {
				name,
				playthroughID: 'test',
				playthroughTime,
				timestampString: '23:19:28, 5.09.2026',
				trackedQuestEntry: 'quests/meta/01_find_mikoshi',
				finishedQuests: 'q001 q003',
				lifePath: 'Corporate',
				level: 60,
				streetCred: 50,
				difficulty: 'Easy',
				buildPatch: '2.31',
				isModded: false,
			},
		},
	};
	writeFileSync(join(directory, name, 'metadata.9.json'), JSON.stringify(metadata, null, 4));
}

suite('cyberpunk', () => {
	writeSave('ManualSave-1', 100);
	writeSave('ManualSave-7', 200);
	writeSave('AutoSave-3', 300);

	test('scan reads saves and describes the playthrough', () => {
		const saves = cyberpunk.scan(directory);
		assert.equal(saves.length, 3);
		const autoSave = saves.find(save => save.name == 'AutoSave-3')!;
		assert.equal(autoSave.kind, 'auto');
		assert.equal(autoSave.label, 'Find mikoshi');
		assert.deepEqual(autoSave.highlights, ['Corpo', 'Level 60']);
	});

	test('convertToManual moves a save into the next manual slot', () => {
		const autoSave = cyberpunk.scan(directory).find(save => save.name == 'AutoSave-3')!;
		convertToManual(autoSave);
		assert.ok(!existsSync(join(directory, 'AutoSave-3')));
		const metadata = readFileSync(join(directory, 'ManualSave-8', 'metadata.9.json'), 'utf8');
		assert.equal(JSON.parse(metadata).Data.metadata.name, 'ManualSave-8');
	});

	test('parseTimestamp reads the game timestamps', () => {
		assert.equal(parseTimestamp('23:19:28, 5.09.2026').toPlainDateTime().toString(), '2026-09-05T23:19:28');
	});
});
