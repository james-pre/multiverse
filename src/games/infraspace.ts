import * as io from 'ioium';
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { text } from '../i18n.js';
import type { Save } from '../save.js';
import type { Game } from './index.js';

/** Header dates like `10/11/2026 21:58:04`, in UTC */
const datePattern = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)$/;

export function parseDate(date: string): Temporal.Instant {
	const match = datePattern.exec(date);
	if (!match) throw new Error(`Invalid date: ${date}`);
	const [month, day, year, hour, minute, second] = match.slice(1).map(Number);
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }).toZonedDateTime('UTC').toInstant();
}

function read(fd: number, position: number, length: number): Buffer {
	const buffer = Buffer.alloc(length);
	const bytesRead = readSync(fd, buffer, 0, length, position);
	return buffer.subarray(0, bytesRead);
}

/** The position of the first occurrence of `marker` in a file */
function find(fd: number, marker: string): number | undefined {
	const needle = Buffer.from(marker);
	const chunkSize = 1 << 22;
	for (let position = 0; ; position += chunkSize - needle.length) {
		const chunk = read(fd, position, chunkSize);
		const index = chunk.indexOf(needle);
		if (index != -1) return position + index;
		if (chunk.length < chunkSize) return;
	}
}

/** Parses the JSON object that is the value of the first `key` in `json`. */
export function objectAfter(json: string, key: string): unknown {
	const keyIndex = json.indexOf(`"${key}":`);
	if (keyIndex == -1) return;
	const start = json.indexOf('{', keyIndex);
	let depth = 0;
	let isString = false;
	for (let i = start; i < json.length; i++) {
		const char = json[i];
		if (isString) {
			if (char == '\\') i++;
			else if (char == '"') isString = false;
			continue;
		}
		if (char == '"') isString = true;
		else if (char == '{') depth++;
		else if (char == '}' && !--depth) return JSON.parse(json.slice(start, i + 1));
	}
}

function numberAfter(json: string, key: string): number | undefined {
	const match = new RegExp(`"${key}": (-?[\\d.eE+-]+)`).exec(json);
	return match ? Number(match[1]) : undefined;
}

interface SaveFile {
	version: string;
	/** Missing in saves from before the campaign was added */
	map?: string;
	time: Temporal.Instant;
	mapSeed: number;
	/** In seconds */
	playTime: number;
	nextId: number;
	simulationFrame: number;
	goal?: number;
	/** Research that is finished, which doesn't include the research in progress */
	researched: string[];
	/** Progress on each research in the save's game version, whose scale differs between versions */
	research: Record<string, number>;
	cityLevel?: number;
	storyMessages: string[];
}

interface Managers {
	goalManager?: { currentGoalIndex?: number };
	researchManager?: { researchProgress?: Record<string, number>; currentResearch?: string | null };
	populationManager?: { cityLevel?: number };
	storyMessagesModule?: { shownMessages?: string[] };
}

/** Reads the header, the fields at the start of the save and the managers, without reading the whole file. */
export function readSaveFile(path: string): SaveFile {
	const fd = openSync(path, 'r');
	try {
		const head = read(fd, 0, 1 << 16)
			.toString('utf8')
			// eslint-disable-next-line no-irregular-whitespace
			.replace(/^﻿/, '');
		const lines = head.split(/\r?\n/, 5);
		if (lines[0] != 'InfraSpace') throw new Error('Not an InfraSpace save');
		const dateIndex = lines.findIndex(line => datePattern.test(line));
		if (dateIndex == -1) throw new Error('The save has no date');

		const managersStart = find(fd, '"goalManager":') ?? find(fd, '"researchManager":');
		const managers = managersStart === undefined ? '' : read(fd, managersStart, 1 << 16).toString('utf8');
		const { size } = statSync(path);
		const tail = read(fd, Math.max(0, size - (1 << 16)), 1 << 16).toString('utf8');
		const story = objectAfter(tail, 'storyMessagesModule') as Managers['storyMessagesModule'];
		const goal = objectAfter(managers, 'goalManager') as Managers['goalManager'];
		const research = objectAfter(managers, 'researchManager') as Managers['researchManager'];
		const population = objectAfter(managers, 'populationManager') as Managers['populationManager'];
		const progress = research?.researchProgress ?? {};

		return {
			version: lines[1],
			map: dateIndex > 2 ? lines[2] : undefined,
			time: parseDate(lines[dateIndex]),
			mapSeed: numberAfter(head, 'mapSeed') ?? 0,
			playTime: numberAfter(head, 'totalPlayTime') ?? 0,
			nextId: numberAfter(head, 'nextID') ?? 0,
			simulationFrame: numberAfter(head, 'simulationFrame') ?? 0,
			goal: goal?.currentGoalIndex,
			researched: Object.keys(progress).filter(name => progress[name] > 0 && name != research?.currentResearch),
			research: progress,
			cityLevel: population?.cityLevel,
			storyMessages: story?.shownMessages ?? [],
		};
	} finally {
		closeSync(fd);
	}
}

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
