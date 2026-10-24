import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

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

export interface Header {
	version: string;
	/** Missing in saves from before the campaign was added */
	map?: string;
	time: Temporal.Instant;
	/** Where the JSON body starts in the text */
	bodyStart: number;
}

/** Parses the lines before the JSON body, like `InfraSpace`, the game version, the map and the date. */
export function parseHeader(text: string): Header {
	const lines = text.split(/\r?\n/, 5);
	if (lines[0] != 'InfraSpace') throw new Error('Not an InfraSpace save');
	const dateIndex = lines.findIndex(line => datePattern.test(line));
	if (dateIndex == -1) throw new Error('The save has no date');
	return {
		version: lines[1],
		map: dateIndex > 2 ? lines[2] : undefined,
		time: parseDate(lines[dateIndex]),
		bodyStart: text.indexOf('\n{') + 1,
	};
}

/** Reads text from a file, without the byte order mark the game writes */
function decode(buffer: Buffer): string {
	return buffer.toString('utf8').replace(/^\ufeff/, '');
}

export function isSave(path: string): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(path, 'r');
		return decode(read(fd, 0, 64)).startsWith('InfraSpace\r\n');
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

/** Reads the whole save, which is slow for large cities. */
export function readWhole(path: string): { header: Header; body: Record<string, unknown> } {
	const text = decode(readFileSync(path));
	const header = parseHeader(text);
	return { header, body: JSON.parse(text.slice(header.bodyStart)) as Record<string, unknown> };
}

export interface SaveFile extends Header {
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

export interface Managers {
	goalManager?: { currentGoalIndex?: number };
	researchManager?: { researchProgress?: Record<string, number>; currentResearch?: string | null };
	populationManager?: { cityLevel?: number };
	storyMessagesModule?: { shownMessages?: string[] };
}

/** Reads the header, the fields at the start of the save and the managers, without reading the whole file. */
export function readSaveFile(path: string): SaveFile {
	const fd = openSync(path, 'r');
	try {
		const head = decode(read(fd, 0, 1 << 16));
		const header = parseHeader(head);

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
			...header,
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
