import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeUTF8 } from 'utilium';
import { decompressLzf } from '../../compression.js';

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

/** Decodes a value, which is stored as base64 any number of times, until it is no longer base64 of text. */
export function decodeValue(value: string): string {
	while (value.length % 4 == 0 && base64Pattern.test(value)) {
		const decoded = decodeUTF8(Uint8Array.fromBase64(value));
		if (!textPattern.test(decoded.replace(/[\n\t]/g, ''))) break;
		value = decoded;
	}
	return value;
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

/** .NET counts time in 100 nanosecond ticks since the start of year 1 */
const ticksAtUnixEpoch = 621_355_968_000_000_000n;

/** Converts ticks of local time, which the game saves its start time in */
export function ticksToDateTime(ticks: bigint): Temporal.PlainDateTime {
	return Temporal.Instant.fromEpochNanoseconds((ticks - ticksAtUnixEpoch) * 100n)
		.toZonedDateTimeISO('UTC')
		.toPlainDateTime();
}

/** A save: base64 of LZF-compressed fields, whose values are base64 of more fields */
export interface SaveFile {
	fields: Fields;
	world: Fields;
	/** The player's disease, which is the first */
	disease: Fields;
}

export function readSaveFile(path: string): SaveFile {
	const data = decompressLzf(Uint8Array.fromBase64(readFileSync(path, 'latin1').trim()));
	const fields = parseFields(decodeUTF8(data));
	if (!('world' in fields)) throw new Error('Not a Plague Inc save');
	return { fields, world: nested(fields, 'world'), disease: nested(fields, '0') };
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
