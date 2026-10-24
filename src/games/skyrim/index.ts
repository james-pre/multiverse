import * as io from 'ioium';
import { sizeof } from 'memium';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { GlobalData, GlobalDataType } from './global-data.js';
import { MiscStats } from './globals/index.js';
import { inspector } from './inspect.js';
import { SaveFile } from './save-file.js';
import { fileTimeToInstant, parsePlayTime, raceName } from './strings.js';
import { FileLocationTable } from './structs.js';

/** Save file names, e.g. `Save38_7C72702B_0_576F7A696D_Mzulft01_040819_20260321020854_54_1.ess` */
const fileNamePattern = /^(?<slot>[A-Za-z]+)(?<number>\d+)_(?<character>[0-9A-F]{8})_.*\.ess$/i;

const kinds: Record<string, string> = {
	Save: 'manual',
	Autosave: 'auto',
	Quicksave: 'quick',
	Exitsave: 'exit',
};

/** Misc stats that can go down, so they can't show which save came first. Faction quest counts are recounted for repeatable quests. */
const unorderedStats = /Bounty$|^Favorite |^Horses Owned$|^(?!Quests Completed$).+ Quests Completed$/;

/** Reads the misc stats, which are at the start of the first global data table. */
export function parseMiscStats(body: Uint8Array): Map<string, number> {
	const { buffer, byteOffset } = body;
	const pluginInfoSize = new DataView(buffer, byteOffset).getUint32(1, true);
	let offset = 5 + pluginInfoSize;

	const table = new FileLocationTable(buffer, byteOffset + offset);
	offset += sizeof(FileLocationTable);

	for (let i = 0; i < table.globalDataTable1Count; i++) {
		const global = new GlobalData(buffer, byteOffset + offset);
		offset += sizeof(global);
		if (global.type != GlobalDataType.MiscStats) continue;
		const { stats } = new MiscStats(global.data.buffer, global.data.byteOffset, global.data.byteLength);
		return new Map(Array.from(stats, stat => [stat.name.toString(), stat.value]));
	}

	throw new Error('The save has no misc stats');
}

/** Decompresses only as much of the body as reading the misc stats needs. */
function readMiscStats(file: SaveFile): Map<string, number> {
	for (let limit = 1 << 16; ; limit *= 4) {
		const body = file.body(limit);
		try {
			return parseMiscStats(body);
		} catch (error) {
			if (body.length >= file.bodySize) throw error;
		}
	}
}

interface SaveInfo {
	playerName: string;
	race: string;
	level: number;
}

const infoOf = new WeakMap<Save, SaveInfo>();

function readSave(path: string, fileName: string): Save | undefined {
	const match = fileNamePattern.exec(fileName);
	if (!match?.groups) return;
	const { slot, number, character } = match.groups;

	const file = new SaveFile(path);
	const { header } = file;
	const stats = readMiscStats(file);
	const time = fileTimeToInstant(header.filetime).toZonedDateTimeISO(Temporal.Now.timeZoneId());
	const race = raceName(header.playerRaceEditorId.toString());
	const level = header.playerLevel;
	const coSave = path.replace(/\.ess$/i, '.skse');

	const save: Save = {
		id: `${fileName}@${time.toInstant().toString()}`,
		name: `${slot} ${number}`,
		path,
		companions: existsSync(coSave) ? [coSave] : [],
		game: skyrim.id,
		playthrough: character.toUpperCase(),
		playTime: parsePlayTime(header.gameDate.toString()),
		time,
		kind: kinds[slot] ?? 'other',
		label: header.playerLocation.toString(),
		highlights: [race, text('skyrim.level', { level })],
		screenshot: () => file.screenshot(),
		progress: new Set(),
		counters: {
			level,
			...Object.fromEntries([...stats].filter(([name]) => !unorderedStats.test(name))),
		},
		details: {
			[text('skyrim.detail.days_passed')]: stats.get('Days Passed') ?? 0,
			[text('skyrim.detail.quests_completed')]: stats.get('Quests Completed') ?? 0,
			[text('skyrim.detail.locations_discovered')]: stats.get('Locations Discovered') ?? 0,
			[text('skyrim.detail.dragon_souls')]: stats.get('Dragon Souls Collected') ?? 0,
		},
	};
	infoOf.set(save, { playerName: header.playerName.toString(), race, level });
	return save;
}

export const skyrim: Game = {
	id: 'skyrim',
	name: 'The Elder Scrolls V: Skyrim Special Edition',
	steam: { id: 489830, saves: 'Documents/My Games/Skyrim Special Edition/Saves' },
	describe(timeline) {
		const info = timeline.nodes.map(node => infoOf.get(node.save)!);
		const { playerName, race } = info.at(-1)!;
		const level = Math.max(...info.map(entry => entry.level));
		return text('skyrim.playthrough', { name: playerName, race, level });
	},
	actions: [],
	inspector,
	scan(directory) {
		const saves: Save[] = [];
		for (const fileName of readdirSync(directory)) {
			if (!fileName.toLowerCase().endsWith('.ess')) continue;
			try {
				const save = readSave(join(directory, fileName), fileName);
				if (save) saves.push(save);
			} catch (error) {
				io.warn(`Skipping ${fileName}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
