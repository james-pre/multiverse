import * as io from 'ioium';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as z from 'zod';
import type { Save } from '../save.js';
import type { Game } from './index.js';

const savesPath = 'Saved Games/CD Projekt Red/Cyberpunk 2077';
const protonPath = join('steamapps/compatdata/1091500/pfx/drive_c/users/steamuser', savesPath);

const platformDirectories: Partial<Record<NodeJS.Platform, string[]>> = {
	linux: [
		join(homedir(), '.local/share/Steam', protonPath),
		join(homedir(), '.var/app/com.valvesoftware.Steam/.local/share/Steam', protonPath),
	],
	win32: [join(homedir(), savesPath)],
};

const Metadata = z.object({
	Data: z.object({
		metadata: z.object({
			name: z.string(),
			playthroughID: z.string(),
			playTime: z.number(),
			timestampString: z.string(),
			trackedQuestEntry: z.string(),
			finishedQuests: z.string(),
			lifePath: z.string(),
			level: z.number(),
			streetCred: z.number(),
			difficulty: z.string(),
			buildPatch: z.string(),
			isModded: z.boolean(),
		}),
	}),
});

const kinds: Record<string, string> = {
	ManualSave: 'manual',
	AutoSave: 'auto',
	QuickSave: 'quick',
	PointOfNoReturnSave: 'point of no return',
	EndGameSave: 'end game',
};

/** Parses the game's `hh:mm:ss, d.mm.yyyy` timestamps, which are in the system's time zone. */
export function parseTimestamp(timestamp: string): Temporal.ZonedDateTime {
	const match = /^(\d+):(\d+):(\d+), (\d+)\.(\d+)\.(\d+)$/.exec(timestamp);
	if (!match) throw new Error(`Invalid timestamp: ${timestamp}`);
	const [hour, minute, second, day, month, year] = match.slice(1).map(Number);
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }).toZonedDateTime(
		Temporal.Now.timeZoneId()
	);
}

/** Turns a quest entry path like `quests/meta/09_solo/404/01b_find_mikoshi` into `find mikoshi`. */
function describeObjective(entry: string): string {
	const objective = entry.split('/').at(-1)!;
	if (objective == '[nothing]') return '';
	return objective.replace(/^\d+\w?_/, '').replaceAll('_', ' ');
}

/** The newest metadata file in a save directory, since the game versions the file name. */
function findMetadata(directory: string): string | undefined {
	const versions = readdirSync(directory)
		.map(file => /^metadata\.(\d+)\.json$/.exec(file))
		.filter(match => !!match)
		.toSorted((a, b) => Number(b[1]) - Number(a[1]));
	return versions[0] && join(directory, versions[0][0]);
}

function readSave(directory: string): Save | undefined {
	const metadataPath = findMetadata(directory);
	if (!metadataPath) return;

	const { metadata } = Metadata.parse(JSON.parse(readFileSync(metadataPath, 'utf8'))).Data;
	const time = parseTimestamp(metadata.timestampString);
	const screenshot = join(directory, 'screenshot.png');

	return {
		id: `${metadata.name}@${time.toInstant().toString()}`,
		name: metadata.name,
		path: directory,
		game: cyberpunk.id,
		playthrough: metadata.playthroughID,
		playTime: metadata.playTime,
		time,
		kind: kinds[metadata.name.replace(/-\d+$/, '')] ?? 'other',
		label: describeObjective(metadata.trackedQuestEntry),
		screenshot: existsSync(screenshot) ? screenshot : undefined,
		progress: new Set(metadata.finishedQuests.split(/\s+/).filter(Boolean)),
		details: {
			level: metadata.level,
			'street cred': metadata.streetCred,
			lifepath: metadata.lifePath,
			difficulty: metadata.difficulty,
			patch: metadata.buildPatch,
			modded: metadata.isModded,
			objective: metadata.trackedQuestEntry,
		},
	};
}

export const cyberpunk: Game = {
	id: 'cyberpunk',
	name: 'Cyberpunk 2077',
	defaultDirectories: platformDirectories[process.platform] ?? [],
	scan(directory) {
		const saves: Save[] = [];
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			try {
				const save = readSave(join(directory, entry.name));
				if (save) saves.push(save);
			} catch (error) {
				io.warn(`Skipping ${entry.name}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
