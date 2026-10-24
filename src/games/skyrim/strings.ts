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
