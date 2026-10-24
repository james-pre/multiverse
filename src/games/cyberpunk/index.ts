import * as io from 'ioium';
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { inspector } from './inspect.js';
import { describeObjective, findMetadata, lifePathName, Metadata, parseTimestamp } from './metadata.js';
import * as slots from './slots.js';

const kinds: Record<string, string> = {
	ManualSave: 'manual',
	AutoSave: 'auto',
	QuickSave: 'quick',
	PointOfNoReturnSave: 'point of no return',
	EndGameSave: 'end game',
};

const metadataOf = new WeakMap<Save, Metadata>();

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
	const target = join(dirname(save.path), slots.nextManual(dirname(save.path)));
	renameSync(save.path, target);
	slots.rename(target, save.name);
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
	inspector,
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
