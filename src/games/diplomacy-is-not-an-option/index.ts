import * as io from 'ioium';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { readContainer, type SaveContainer } from './container.js';
import { inspector } from './inspect.js';

/** Saves the game names after the mission and the moment, like `Wake-up call, mission start` */
const checkpointPattern = /^(?<mission>.+), (?:mission start|faction choice)$/;

const containerOf = new WeakMap<Save, SaveContainer>();

function readSave(path: string, profile: string): Save {
	const container = readContainer(path);
	const name = basename(path);
	const { mtime } = statSync(path);
	const time = Temporal.Instant.fromEpochMilliseconds(mtime.getTime()).toZonedDateTimeISO(Temporal.Now.timeZoneId());
	const { research, sessionTime } = container;
	const kills = container.deathCounter.value;

	const save: Save = {
		id: `${profile}/${name}@${time.toInstant().toString()}`,
		name,
		path,
		companions: [`${path}.dat`],
		game: diplomacyIsNotAnOption.id,
		playthrough: `${profile}/${container.missionIndex}/${container.mapSeed}`,
		playTime: sessionTime.elapsedTimeUnscaled ?? sessionTime.elapsedTime,
		time,
		kind:
			/^AutoSave_/.test(name) || checkpointPattern.test(name) ? 'auto' : name == 'QuickSave' ? 'quick' : 'manual',
		label: checkpointPattern.exec(name)?.groups?.mission ?? '',
		highlights: [
			text('dinao.citizens', { count: container.citizens.length }),
			text('dinao.kills', { count: kills }),
		],
		progress: new Set([
			...Array.from(research.completeBuildings, id => `building.${id}`),
			...Array.from(research.completeResearches, id => `research.${id}`),
		]),
		counters: { kills, gameTime: sessionTime.elapsedTime },
		details: {
			[text('dinao.detail.buildings')]: container.buildings.length,
			[text('dinao.detail.difficulty')]: container.difficultyIndex,
			[text('dinao.detail.save_version')]: container.saveVersion,
		},
	};
	containerOf.set(save, container);
	return save;
}

/** Each profile has a directory of saves, where every save has a `.dat` header beside it. */
function* saveFiles(directory: string): Generator<[path: string, profile: string]> {
	for (const profile of readdirSync(directory, { withFileTypes: true })) {
		if (!profile.isDirectory()) continue;
		const profileDirectory = join(directory, profile.name);
		for (const file of readdirSync(profileDirectory)) {
			if (!file.endsWith('.dat')) continue;
			const path = join(profileDirectory, file.slice(0, -4));
			if (existsSync(path)) yield [path, profile.name];
		}
	}
}

export const diplomacyIsNotAnOption: Game = {
	id: 'dinao',
	name: 'Diplomacy is Not an Option',
	steam: { id: 1272320, saves: 'AppData/LocalLow/Door 407/Diplomacy is Not an Option/DNOPersistentData' },
	describe(timeline) {
		const saves = timeline.nodes.map(node => node.save);
		const mission = saves.findLast(save => save.label)?.label;
		const named = saves.findLast(save => save.kind == 'manual')?.name;
		const citizens = Math.max(...saves.map(save => containerOf.get(save)!.citizens.length));
		return text('dinao.playthrough', {
			name: named ?? mission ?? saves.at(-1)!.name,
			citizens: text('dinao.citizens', { count: citizens }),
		});
	},
	actions: [],
	inspector,
	scan(directory) {
		const saves: Save[] = [];
		for (const [path, profile] of saveFiles(directory)) {
			try {
				saves.push(readSave(path, profile));
			} catch (error) {
				io.warn(`Skipping ${path}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
