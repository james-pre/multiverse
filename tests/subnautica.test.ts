import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { subnautica } from '../src/games/subnautica/index.js';

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
});
