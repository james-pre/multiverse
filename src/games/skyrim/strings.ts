import { text } from '../../i18n.js';
import { array, primitive, struct, types as t, type InstanceOf } from 'memium';
import { decodeUTF8 } from 'utilium';

export class wstring extends struct(
	'wstring',
	{
		length: t.uint16,
		data: array(primitive.types.uint8).countedBy('length'),
	},
	{ isDynamic: true, isPacked: true }
) {
	toString() {
		return decodeUTF8(this.data);
	}
}

export const FileTime = struct.packed('FileTime', {
	low: t.uint32,
	high: t.uint32,
});

/** Windows file times count 100 nanosecond intervals since 1601. */
export function fileTimeToInstant(fileTime: InstanceOf<typeof FileTime>): Temporal.Instant {
	const intervals = (BigInt(fileTime.high) << 32n) | BigInt(fileTime.low);
	return Temporal.Instant.fromEpochNanoseconds(intervals * 100n - 11_644_473_600_000_000_000n);
}

/** Parses play time like `104.19.59` (hours, minutes and seconds), in seconds. */
export function parsePlayTime(playTime: string): number {
	const [hours = 0, minutes = 0, seconds = 0] = playTime.split('.').map(Number);
	return hours * 3600 + minutes * 60 + seconds;
}

/** Turns a race's editor ID like `DarkElfRace` into a name like `Dark Elf`. */
export function raceName(editorId: string): string {
	const name = editorId
		.replace('Race', ' ')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.trim();
	return text(`skyrim.race.${editorId}`, { $default: name });
}
