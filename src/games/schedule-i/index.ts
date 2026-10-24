import * as io from 'ioium';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { inspector } from './inspect.js';
import { money, rankName, slots } from './names.js';
import { readSaveFolder } from './save-file.js';

const folderPattern = /^SaveGame_(\d+)$/;

function readSave(directory: string, folderName: string): Save | undefined {
	const match = folderPattern.exec(folderName);
	if (!match) return;
	const path = join(directory, folderName);
	if (!statSync(path).isDirectory()) return;
	const folder = readSaveFolder(path);
	const zone = Temporal.Now.timeZoneId();
	const time =
		folder.lastPlayed?.toZonedDateTime(zone)
		?? Temporal.Instant.fromEpochMilliseconds(
			Math.floor(statSync(join(path, 'Game.json')).mtimeMs)
		).toZonedDateTimeISO(zone);

	const counters: Record<string, number> = { day: folder.day, experience: folder.experience };
	if (folder.earnings !== undefined) counters.earnings = folder.earnings;

	return {
		id: `${folderName}@${time.toPlainDateTime().toString()}/${folder.playTime}`,
		name: text('schedule.slot', { number: Number(match[1]) }),
		path,
		game: scheduleI.id,
		playthrough: `${folder.seed}@${folder.created?.toString() ?? ''}`,
		playTime: folder.playTime,
		time,
		kind: 'manual',
		label: folder.organisation,
		highlights: [
			rankName(folder.rank, folder.tier),
			text('schedule.day', { day: folder.day + 1 }),
			money(folder.networth),
		],
		progress: new Set(folder.completedQuests),
		counters,
		details: {
			[text('schedule.detail.balance')]: money(folder.balance),
			[text('schedule.detail.quests')]: folder.completedQuests.length,
			[text('schedule.detail.version')]: folder.version,
		},
	};
}

export const scheduleI: Game = {
	id: 'schedule-i',
	name: 'Schedule I',
	steam: { id: 3164500, saves: 'AppData/LocalLow/TVGS/Schedule I/Saves/*' },
	archive: { slots },
	inspector,
	describe(timeline) {
		const latest = timeline.nodes.at(-1)!.save;
		return text('schedule.playthrough', { organisation: latest.label, slot: latest.name });
	},
	actions: [],
	scan(directory) {
		const saves: Save[] = [];
		for (const folderName of readdirSync(directory)) {
			try {
				const save = readSave(directory, folderName);
				if (save) saves.push(save);
			} catch (error) {
				io.warn(`Skipping ${folderName}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
