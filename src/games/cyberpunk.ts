import * as io from 'ioium';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as z from 'zod';
import { text } from '../i18n.js';
import type { Save } from '../save.js';
import type { Game } from './index.js';

const Metadata = z.object({
	Data: z.object({
		metadata: z.object({
			name: z.string(),
			playthroughID: z.string(),
			playthroughTime: z.number(),
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

/** Turns a quest entry path like `quests/meta/09_solo/404/01b_find_mikoshi` into `Find mikoshi`. */
function describeObjective(entry: string): string {
	const objective = entry.split('/').at(-1)!;
	if (objective == '[nothing]') return '';
	const text = objective.replace(/^\d+\w?_/, '').replaceAll('_', ' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The newest metadata file in a save directory, since the game versions the file name. */
function findMetadata(directory: string): string | undefined {
	const versions = readdirSync(directory)
		.map(file => /^metadata\.(\d+)\.json$/.exec(file))
		.filter(match => !!match)
		.toSorted((a, b) => Number(b[1]) - Number(a[1]));
	return versions[0] && join(directory, versions[0][0]);
}

type Metadata = z.infer<typeof Metadata>['Data']['metadata'];

const metadataOf = new WeakMap<Save, Metadata>();

function lifePathName(lifePath: string): string {
	return text(`cyberpunk.life_path.${lifePath}`, { $default: lifePath });
}

function readSave(directory: string): Save | undefined {
	const metadataPath = findMetadata(directory);
	if (!metadataPath) return;

	const { metadata } = Metadata.parse(JSON.parse(readFileSync(metadataPath, 'utf8'))).Data;
	const time = parseTimestamp(metadata.timestampString);
	const screenshot = join(directory, 'screenshot.png');

	const save: Save = {
		id: `${metadata.name}@${time.toInstant().toString()}`,
		name: metadata.name,
		path: directory,
		game: cyberpunk.id,
		playthrough: metadata.playthroughID,
		playTime: metadata.playthroughTime,
		time,
		kind: kinds[metadata.name.replace(/-\d+$/, '')] ?? 'other',
		label: describeObjective(metadata.trackedQuestEntry),
		highlights: [lifePathName(metadata.lifePath), text('cyberpunk.level', { level: metadata.level })],
		screenshot: existsSync(screenshot) ? screenshot : undefined,
		progress: new Set(metadata.finishedQuests.split(/\s+/).filter(Boolean)),
		details: {
			[text('cyberpunk.detail.street_cred')]: metadata.streetCred,
			[text('cyberpunk.detail.difficulty')]: metadata.difficulty,
			[text('cyberpunk.detail.patch')]: metadata.buildPatch,
			[text('cyberpunk.detail.modded')]: metadata.isModded,
		},
	};
	metadataOf.set(save, metadata);
	return save;
}

/** Move a save into the next free manual slot, so the game can't overwrite it. */
export function convertToManual(save: Save): void {
	const directory = dirname(save.path);
	const slots = readdirSync(directory)
		.map(name => /^ManualSave-(\d+)$/.exec(name))
		.filter(match => !!match)
		.map(match => Number(match[1]));
	const name = `ManualSave-${Math.max(-1, ...slots) + 1}`;

	const metadataPath = findMetadata(save.path);
	if (!metadataPath) throw new Error(`${save.name} has no metadata`);
	const metadata = readFileSync(metadataPath, 'utf8');
	const nameField = `"name": "${save.name}"`;
	if (!metadata.includes(nameField)) throw new Error(`Could not find the slot name in ${metadataPath}`);

	const target = join(directory, name);
	renameSync(save.path, target);
	writeFileSync(join(target, basename(metadataPath)), metadata.replace(nameField, `"name": "${name}"`));
}

export const cyberpunk: Game = {
	id: 'cyberpunk',
	name: 'Cyberpunk 2077',
	steam: { id: 1091500, saves: 'Saved Games/CD Projekt Red/Cyberpunk 2077' },
	describe(timeline) {
		const metadata = timeline.nodes.map(node => metadataOf.get(node.save)!);
		const latest = metadata.at(-1)!;
		const level = Math.max(...metadata.map(entry => entry.level));
		return text('cyberpunk.playthrough', { life_path: lifePathName(latest.lifePath), level });
	},
	actions: [
		{
			id: 'convert-to-manual',
			label: text('cyberpunk.make_manual'),
			canRun: save => save.kind == 'auto' || save.kind == 'quick',
			run: convertToManual,
		},
	],
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
