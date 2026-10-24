import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import { scheduleI } from '../src/games/schedule-i/index.js';
import { inspector } from '../src/games/schedule-i/inspect.js';
import { rankName } from '../src/games/schedule-i/names.js';
import { Timeline } from '../src/timeline.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

const date = (day: number, hour: number) => ({ Year: 2026, Month: 10, Day: day, Hour: hour, Minute: 0, Second: 0 });

function writeSlot(slot: number, playTime: number, quests: number): void {
	const folder = join(directory, `SaveGame_${slot}`);
	mkdirSync(folder, { recursive: true });
	const parts = {
		Game: { OrganisationName: 'Benzies', Seed: 42, GameVersion: '0.4.7f12' },
		Metadata: { CreationDate: date(1, 12), LastPlayedDate: date(2, 10 + slot) },
		Time: { Playtime: playTime, ElapsedDays: playTime / 1000 },
		Money: { OnlineBalance: 1500, Networth: 25000, LifetimeEarnings: playTime * 10 },
		Rank: { Rank: 2, Tier: 3, TotalXP: playTime },
		Quests: {
			Quests: Array.from({ length: 3 }, (_, i) => ({ GUID: `quest-${i}`, State: i < quests ? 2 : 1 })),
		},
	};
	for (const [name, part] of Object.entries(parts)) {
		writeFileSync(join(folder, `${name}.json`), JSON.stringify(part));
	}
}

suite('Schedule I', () => {
	writeSlot(1, 3000, 1);
	writeSlot(2, 6000, 2);
	mkdirSync(join(directory, 'Backups'));

	test('reads slots', () => {
		const saves = scheduleI.scan(directory).toSorted((a, b) => a.playTime - b.playTime);
		assert.equal(saves.length, 2);
		const [first] = saves;
		assert.equal(first.name, 'Slot 1');
		assert.equal(first.label, 'Benzies');
		assert.equal(first.playTime, 3000);
		assert.equal(first.time.toPlainDateTime().toString(), '2026-10-02T11:00:00');
		assert.deepEqual([...first.progress], ['quest-0']);
		assert.equal(first.highlights[0], 'Peddler III');
	});

	test('saves from the same game are one playthrough', () => {
		const [timeline, ...rest] = Timeline.fromSaves(scheduleI.scan(directory));
		assert.equal(rest.length, 0);
		assert.equal(timeline.roots.length, 1);
		assert.equal(scheduleI.describe(timeline), 'Benzies · Slot 2');
	});

	test('rankName falls back to the number of ranks it does not know', () => {
		assert.equal(rankName(99, 1), 'Rank 99 I');
	});

	test('edits the bank balance and cash, writing them to a copy in a free slot', () => {
		const path = join(directory, 'SaveGame_1');
		mkdirSync(join(path, 'Players/Player_0'), { recursive: true });
		const cash = JSON.stringify({ DataType: 'CashData', ID: 'cash', CashBalance: 25.5 });
		writeFileSync(
			join(path, 'Players/Player_0/Inventory.json'),
			JSON.stringify({ Items: [JSON.stringify({ ID: 'machete' }), cash] }, null, 4)
		);

		const inspection = inspector.open(path);
		const money = inspection.section('money');
		const balance = money.find(row => row.label == 'Bank balance')!;
		const pocket = money.find(row => row.label == 'Cash')!;
		assert.ok(balance.edit?.safe && pocket.edit?.safe);
		assert.ok(!money.find(row => row.label == 'Net worth')?.edit?.safe);
		balance.edit.set(1000);
		pocket.edit.set(75);
		assert.throws(() => pocket.edit!.set(-1), /lowest/);

		const copy = inspector.copy!(path);
		inspection.write!(copy);
		assert.equal(copy, join(directory, 'SaveGame_3'));
		const copied = inspector.open(copy).section('money');
		assert.equal(copied.find(row => row.label == 'Bank balance')?.value, '$1,000');
		assert.equal(copied.find(row => row.label == 'Cash')?.value, '$75');
		assert.equal(
			inspector
				.open(path)
				.section('money')
				.find(row => row.label == 'Cash')?.value,
			'$26'
		);
	});

	test('copies need a free slot', () => {
		for (const slot of [4, 5]) writeSlot(slot, 100, 0);
		assert.throws(() => inspector.copy!(join(directory, 'SaveGame_1')), /Every save slot/);
	});
});
