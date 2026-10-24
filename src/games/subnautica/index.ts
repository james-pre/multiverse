import * as io from 'ioium';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ticksToDateTime } from '../../dotnet.js';
import { shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';

const folderPattern = /^slot(\d+)$/;

/** A slot's `gameinfo.json` */
interface GameInfo {
	/** In seconds */
	gameTime: number;
	/** When the game was saved, in .NET ticks of local time, which are too big for numbers */
	dateTicks: string;
	/** When the playthrough started, in .NET ticks of local time, which are too big for numbers */
	startTicks: string;
	/** The game's build */
	changeSet: number;
	gameMode: number;
	cyclopsPresent?: boolean;
	seamothPresent?: boolean;
	exosuitPresent?: boolean;
	rocketPresent?: boolean;
	basePresent?: boolean;
}

/** Vehicles and bases the save says the player has, by their field in `gameinfo.json` */
const builds = ['basePresent', 'seamothPresent', 'cyclopsPresent', 'exosuitPresent', 'rocketPresent'] as const;

function readGameInfo(path: string): GameInfo {
	const json = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
	return JSON.parse(json, (key, value: unknown, context?: { source: string }) =>
		key.endsWith('Ticks') && context ? context.source : value
	) as GameInfo;
}

export function modeName(mode: number): string {
	return text(`subnautica.mode.${mode}`, { $default: text('subnautica.mode.unknown', { mode }) });
}

const startOf = new WeakMap<Save, Temporal.PlainDateTime>();

function readSave(directory: string, folderName: string): Save | undefined {
	const match = folderPattern.exec(folderName);
	const path = join(directory, folderName);
	const infoPath = join(path, 'gameinfo.json');
	if (!match || !existsSync(infoPath)) return;
	const info = readGameInfo(infoPath);
	const zone = Temporal.Now.timeZoneId();
	const time = ticksToDateTime(BigInt(info.dateTicks)).toZonedDateTime(zone);
	const screenshot = join(path, 'screenshot.jpg');
	const present = builds.filter(build => info[build]);

	const save: Save = {
		id: `${folderName}@${info.dateTicks}`,
		name: text('subnautica.slot', { number: Number(match[1]) }),
		path,
		game: subnautica.id,
		playthrough: info.startTicks,
		playTime: info.gameTime,
		time,
		kind: 'manual',
		label: modeName(info.gameMode),
		highlights: present.map(build => text(`subnautica.build.${build}`)),
		screenshot: existsSync(screenshot) ? screenshot : undefined,
		progress: new Set(),
		details: {
			[text('subnautica.detail.started')]: shortDate(ticksToDateTime(BigInt(info.startTicks))),
			[text('subnautica.detail.build')]: info.changeSet,
		},
	};
	startOf.set(save, ticksToDateTime(BigInt(info.startTicks)));
	return save;
}

export const subnautica: Game = {
	id: 'subnautica',
	name: 'Subnautica',
	steam: { id: 264710, saves: 'SNAppData/SavedGames', installed: true },
	archive: {
		freeSlot(directory) {
			const used = readdirSync(directory).map(name => Number(folderPattern.exec(name)?.[1] ?? -1));
			return `slot${String(Math.max(-1, ...used) + 1).padStart(4, '0')}`;
		},
	},
	describe(timeline) {
		const latest = timeline.nodes.at(-1)!.save;
		return text('subnautica.playthrough', { mode: latest.label, started: shortDate(startOf.get(latest)!) });
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
