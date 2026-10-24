import * as io from 'ioium';
import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { inspector } from './inspect.js';
import { readSaveFile, type SaveFile } from './save-file.js';

const fileOf = new WeakMap<Save, SaveFile>();

function readSave(path: string): Save {
	const file = readSaveFile(path);
	const name = basename(path, '.sav');
	const isAutosave = /^Autosave \d+$/.test(name);
	const completed = file.researched.length;
	const time = file.time.toZonedDateTimeISO(Temporal.Now.timeZoneId());

	const counters: Record<string, number> = { nextId: file.nextId, simulationFrame: file.simulationFrame };
	if (file.goal !== undefined) counters.goal = file.goal;
	// Research that a later game version removed is ignored.
	for (const [research, progress] of Object.entries(file.research))
		counters[`research.${research}`] = +(progress > 0);

	const save: Save = {
		id: `${basename(dirname(path))}/${name}@${file.time.toString()}`,
		name,
		path,
		game: infraspace.id,
		playthrough: String(file.mapSeed),
		playTime: file.playTime,
		time,
		kind: isAutosave ? 'auto' : 'manual',
		label: file.version,
		highlights: [
			...(file.cityLevel === undefined ? [] : [text('infraspace.city_level', { level: file.cityLevel })]),
			text('infraspace.research', { count: completed }),
		],
		progress: new Set(file.storyMessages),
		counters,
		details: {
			[text('infraspace.detail.version')]: file.version,
			[text('infraspace.detail.map')]: file.map ?? '',
			[text('infraspace.detail.research')]: completed,
		},
	};
	fileOf.set(save, file);
	return save;
}

function* saveFiles(directory: string): Generator<string> {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) yield* saveFiles(path);
		else if (entry.name.endsWith('.sav')) yield path;
	}
}

export const infraspace: Game = {
	id: 'infraspace',
	name: 'InfraSpace',
	steam: { id: 1511460, saves: 'AppData/LocalLow/Dionic Software/InfraSpace/saves' },
	describe(timeline) {
		const named = timeline.nodes.filter(node => node.save.kind == 'manual');
		const latest = (named.at(-1) ?? timeline.nodes.at(-1)!).save;
		const level = Math.max(0, ...timeline.nodes.map(node => fileOf.get(node.save)!.cityLevel ?? 0));
		return text('infraspace.playthrough', { name: latest.name, level });
	},
	actions: [],
	inspector,
	scan(directory) {
		const saves: Save[] = [];
		for (const path of saveFiles(directory)) {
			try {
				saves.push(readSave(path));
			} catch (error) {
				io.warn(`Skipping ${path}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
