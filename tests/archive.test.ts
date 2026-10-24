import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, suite, test } from 'node:test';
import { Archive } from '../src/archive.js';
import type { ArchiveSupport, Game } from '../src/games/index.js';
import type { Save } from '../src/save.js';

interface Info {
	playthrough: string;
	playTime: number;
}

/** A game whose saves are `slot_N` folders, each with an `info.json` */
function testGame(archive: ArchiveSupport): Game {
	return {
		id: 'test',
		name: 'Test',
		describe: timeline => timeline.playthrough,
		actions: [],
		archive,
		scan(directory) {
			return readdirSync(directory)
				.filter(name => /^slot_\d+$/.test(name) && existsSync(join(directory, name, 'info.json')))
				.map((name): Save => {
					const path = join(directory, name);
					const info = JSON.parse(readFileSync(join(path, 'info.json'), 'utf8')) as Info;
					return {
						id: `${name}@${info.playthrough}/${info.playTime}`,
						name,
						path,
						game: 'test',
						playthrough: info.playthrough,
						playTime: info.playTime,
						time: Temporal.Instant.fromEpochMilliseconds(info.playTime * 1000).toZonedDateTimeISO('UTC'),
						kind: 'manual',
						label: info.playthrough,
						highlights: [],
						progress: new Set(),
						details: {},
					};
				});
		},
	};
}

const fixedSlots = { slots: ['slot_1', 'slot_2'] };

const unlimitedSlots = {
	freeSlot: (directory: string) => `slot_${readdirSync(directory).length + 1}`,
};

suite('Archive', () => {
	let root: string;
	let saves: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'multiverse-'));
		saves = join(root, 'saves');
		mkdirSync(saves);
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function writeSave(slot: string, info: Info): void {
		mkdirSync(join(saves, slot), { recursive: true });
		writeFileSync(join(saves, slot, 'info.json'), JSON.stringify(info));
	}

	function archive(support: ArchiveSupport = fixedSlots): Archive {
		return new Archive({ game: testGame(support), directory: saves }, join(root, 'archive'));
	}

	const byId = (list: Save[]) => new Map(list.map(save => [save.id, save]));

	test('keeps a copy of a save after the game saves over it', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive();
		first.add(first.live()[0]);
		writeSave('slot_1', { playthrough: 'a', playTime: 20 });

		const scanned = byId(first.scan());
		assert.equal(scanned.size, 2);
		const old = scanned.get('slot_1@a/10')!;
		assert.equal(old.inGame, false);
		assert.equal(old.slot, 'slot_1');
		assert.ok(old.archived && old.path.startsWith(old.archived));
		assert.equal(scanned.get('slot_1@a/20')!.inGame, true);
		assert.equal(scanned.get('slot_1@a/20')!.archived, undefined);
	});

	test('lists a save that is in the game and the archive once', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive();
		assert.equal(first.addAll().length, 1);
		assert.equal(first.addAll().length, 0);
		const [save, ...rest] = first.scan();
		assert.equal(rest.length, 0);
		assert.equal(save.inGame, true);
		assert.ok(save.archived);
	});

	test('puts saves from a fixed slot that holds a save in its playthrough, and others in their own', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		writeSave('slot_2', { playthrough: 'b', playTime: 10 });
		const first = archive();
		first.addAll();
		writeSave('slot_1', { playthrough: 'c', playTime: 5 });
		rmSync(join(saves, 'slot_2'), { recursive: true });

		const scanned = byId(first.scan());
		assert.equal(scanned.get('slot_1@a/10')!.playthrough, 'slot:slot_1');
		assert.equal(scanned.get('slot_1@c/5')!.playthrough, 'slot:slot_1');
		assert.equal(scanned.get('slot_2@b/10')!.playthrough, 'b');
	});

	test('putting a save in a fixed slot archives and replaces the save in it', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive();
		first.addAll();
		writeSave('slot_1', { playthrough: 'a', playTime: 20 });

		const old = byId(first.scan()).get('slot_1@a/10')!;
		const replaced = first.putInGame(old);
		assert.equal(replaced?.id, 'slot_1@a/20');

		const scanned = byId(first.scan());
		assert.equal(scanned.get('slot_1@a/10')!.inGame, true);
		assert.equal(scanned.get('slot_1@a/20')!.inGame, false);
		assert.deepEqual(readdirSync(saves), ['slot_1']);
	});

	test('putting a save back without fixed slots uses a free slot when its own is taken', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive(unlimitedSlots);
		first.addAll();
		writeSave('slot_1', { playthrough: 'b', playTime: 5 });

		const old = byId(first.scan()).get('slot_1@a/10')!;
		assert.equal(first.putInGame(old), undefined);
		assert.deepEqual(readdirSync(saves).sort(), ['slot_1', 'slot_2']);
		assert.equal(JSON.parse(readFileSync(join(saves, 'slot_2/info.json'), 'utf8')).playTime, 10);
	});

	test('removing a save from the game keeps it in the archive', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive(unlimitedSlots);
		first.removeFromGame(first.live()[0]);
		assert.ok(!existsSync(join(saves, 'slot_1')));

		const [save] = first.scan();
		assert.equal(save.inGame, false);
		first.putInGame(save);
		assert.ok(existsSync(join(saves, 'slot_1/info.json')));
	});

	test('does not put a save back over files it can not read', () => {
		writeSave('slot_1', { playthrough: 'a', playTime: 10 });
		const first = archive();
		first.removeFromGame(first.live()[0]);
		mkdirSync(join(saves, 'slot_1'));
		writeFileSync(join(saves, 'slot_1/other'), '');

		const [save] = first.scan();
		assert.throws(() => first.putInGame(save), /in the way/);
		assert.deepEqual(readdirSync(join(saves, 'slot_1')), ['other']);
	});
});
