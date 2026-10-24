import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeUTF8, encodeUTF8 } from 'utilium';
import { compressLzf, decompressLzf } from '../../compression.js';
import { checkEditValue, type Edit, type EditOptions } from '../../editing.js';

/** Fields by name, from text with a `name:value` line for each */
export type Fields = Record<string, string>;

export function parseFields(text: string): Fields {
	const fields: Fields = {};
	for (const line of text.split('\n')) {
		const separator = line.indexOf(':');
		if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 1);
	}
	return fields;
}

const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;

/** Text without control characters, other than line breaks and tabs, or invalid UTF-8 */
const textPattern = /^[^\p{Cc}�]*$/u;

/** Decodes a value the way `decodeValue` does, counting how many times it was encoded */
export function decodeLayers(value: string): { text: string; layers: number } {
	let layers = 0;
	while (value.length % 4 == 0 && base64Pattern.test(value)) {
		const decoded = decodeUTF8(Uint8Array.fromBase64(value));
		if (!textPattern.test(decoded.replace(/[\n\t]/g, ''))) break;
		value = decoded;
		layers++;
	}
	return { text: value, layers };
}

/** Decodes a value, which is stored as base64 any number of times, until it is no longer base64 of text. */
export function decodeValue(value: string): string {
	return decodeLayers(value).text;
}

function encodeLayers(text: string, layers: number): string {
	for (let i = 0; i < layers; i++) text = encodeUTF8(text).toBase64();
	return text;
}

/** The lines of a field in text made of fields, which can list a field more than once */
function fieldLines(lines: string[], name: string): number[] {
	const indices = lines
		.keys()
		.filter(i => lines[i].startsWith(name + ':'))
		.toArray();
	if (!indices.length) throw new Error(`The save has no field ${name}`);
	return indices;
}

/** The decoded value of a field, which can be inside fields that are themselves values, using its last line like `parseFields` */
export function readField(text: string, path: string[]): string {
	for (const name of path) {
		const lines = text.split('\n');
		text = decodeValue(lines[fieldLines(lines, name).at(-1)!].slice(name.length + 1));
	}
	return text;
}

/** Replaces every value of a field, which can be inside fields that are themselves values, encoding each as it was */
export function replaceField(text: string, path: string[], value: string): string {
	const [name, ...rest] = path;
	const lines = text.split('\n');
	for (const index of fieldLines(lines, name)) {
		const { text: decoded, layers } = decodeLayers(lines[index].slice(name.length + 1));
		lines[index] = `${name}:${encodeLayers(rest.length ? replaceField(decoded, rest, value) : value, layers)}`;
	}
	return lines.join('\n');
}

/** Whether a decoded value is itself made of fields */
export function isFields(value: string): boolean {
	return /^\w+:/.test(value) && value.includes('\n');
}

/** Fields of a field whose value is made of fields */
export function nested(fields: Fields, name: string): Fields {
	const value = fields[name];
	return value === undefined ? {} : parseFields(decodeValue(value));
}

const numberPattern = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** A save: base64 of LZF-compressed fields, whose values are base64 of more fields */
export class SaveFile {
	/** The decompressed fields, which changes are made in */
	public text: string;
	/** Whitespace after the base64, which is written back */
	protected readonly end: string;
	protected parsed?: { fields: Fields; world: Fields; disease: Fields };

	public constructor(path: string) {
		const file = readFileSync(path, 'latin1');
		const base64 = file.trimEnd();
		this.end = file.slice(base64.length);
		this.text = decodeUTF8(decompressLzf(Uint8Array.fromBase64(base64.trimStart())));
		if (!('world' in this.fields)) throw new Error('Not a Plague Inc save');
	}

	protected get all(): { fields: Fields; world: Fields; disease: Fields } {
		if (this.parsed) return this.parsed;
		const fields = parseFields(this.text);
		this.parsed = { fields, world: nested(fields, 'world'), disease: nested(fields, '0') };
		return this.parsed;
	}

	public get fields(): Fields {
		return this.all.fields;
	}

	public get world(): Fields {
		return this.all.world;
	}

	/** The player's disease, which is the first */
	public get disease(): Fields {
		return this.all.disease;
	}

	/**
	 * An edit of a field's value, which can be inside fields that are themselves values.
	 * Values are numbers, `True` and `False` as booleans, or text.
	 */
	public edit(path: string[], options: EditOptions = {}): Edit | undefined {
		let current: string;
		try {
			current = readField(this.text, path);
		} catch {
			return;
		}
		const isBoolean = current == 'True' || current == 'False';
		const isNumber = numberPattern.test(current);
		const read = () => {
			const text = readField(this.text, path);
			return isBoolean ? text == 'True' : isNumber ? Number(text) : text;
		};
		const edit: Edit = {
			...(isNumber && /^-?\d+$/.test(current) ? { integer: true } : {}),
			...options,
			get value() {
				return read();
			},
			set: value => {
				value = checkEditValue(edit, value);
				const text = typeof value == 'boolean' ? (value ? 'True' : 'False') : String(value);
				this.text = replaceField(this.text, path, text);
				this.parsed = undefined;
			},
		};
		return edit;
	}

	public write(path: string): void {
		writeFileSync(path, compressLzf(encodeUTF8(this.text)).toBase64() + this.end);
	}
}

export function readSaveFile(path: string): SaveFile {
	return new SaveFile(path);
}

/** What `meta.dat` says about a save slot, which the game shows in its list of saves */
export interface SlotInfo {
	slot: number;
	day: number;
	name: string;
	scenario: string;
	/** In the time zone the game was played in */
	time?: Temporal.PlainDateTime;
	diseaseType: string;
	/** Like `Classic`, or `Official` for official scenarios */
	mode: string;
	difficulty: number;
	/** The disease type's name, which only newer saves have */
	diseaseTypeName: string;
}

/** Dates like `10/11/2026 20:03:31`, month first */
const datePattern = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+)$/;

export function parseSlotDate(date: string): Temporal.PlainDateTime | undefined {
	const match = datePattern.exec(date);
	if (!match) return;
	const [month, day, year, hour, minute, second] = match.slice(1).map(Number);
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second });
}

/** Reads `meta.dat`, which has a colon-separated line for each save slot. */
export function readSlots(directory: string): Map<number, SlotInfo> {
	const path = join(directory, 'meta.dat');
	const slots = new Map<number, SlotInfo>();
	if (!existsSync(path)) return slots;

	for (const line of readFileSync(path, 'utf8').split('\n')) {
		const fields = line.split(':');
		if (fields.length < 12) continue;
		const slot = Number(fields[0]);
		slots.set(slot, {
			slot,
			day: Number(fields[1]),
			name: decodeValue(fields[6]),
			scenario: decodeValue(fields[7]),
			time: parseSlotDate(decodeValue(fields[8])),
			diseaseType: fields[9],
			mode: fields[10],
			difficulty: Number(fields[11]),
			diseaseTypeName: decodeValue(fields[15] ?? ''),
		});
	}
	return slots;
}
