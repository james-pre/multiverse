import { array, primitive, struct, types as t, type InstanceOf } from 'memium';

/**
 * Variable-sized value, the type of vsval depends on the first byte: the lowest 2 bits represents the type of the vsval:
 *
 *     0 = uint8
 *     1 = uint16
 *     2 = uint32
 *
 * The value is in the rest of the bits of the value type.
 *
 * * value <= 0x40 becomes uint8, (byte1 >> 2)
 * * value <= 0x4000 becomes uint16, (byte1 | (byte2 << 8)) >> 2
 * * value <= 0x40000000 becomes uint32, (byte1 | (byte2 << 8) | (byte3 << 16)) >> 2
 *
 * Note: bytes are stored in little-endian format. So, the least significant bytes will come first. (Bits are still most significant first)
 *
 * Example process for reading a uint16 vsval:
 *
 * 1. Read one byte. We will use 0xE1 for our example (or 11100001 in binary).
 * 2. The rightmost bits are least significant, so that is where our vsval type is stated. In this case, the rightmost bits are 01, so the type of this vsval is uint16 (so, we will have two bytes total).
 * 3. Read the next byte. We will use 0x13 for our example (or 00010011 in binary). Shift this byte to the left 8 bits and logical or it with the first byte such that uint16 = ((byte2 << 8) | byte1). So now we have 0x13E1 (or 00010011 11100001 in binary).
 * 4. Finally, shift the resulting uint16 to the right 2 bits to get the resulting value of 0x04F8 (or 00000100 11111000 in binary).
 *
 * Note: When reading a uint32 value, follow the same procedure except shift the third byte to the left 16 bits and logical or it with the uint16 before shifting the resulting uint32 to the right 2 bits.
 */
export const vsval = struct.packed(
	'vsval',
	{
		byte0: t.uint8,
		rest: array(primitive.types.uint8).countedBy(v => [0, 1, 3][v.byte0 & 0b11]),
	},
	{ isDynamic: true }
);

export function getVsval(val: InstanceOf<typeof vsval>): number {
	const value = [val.byte0, ...val.rest].reduce((acc, b, i) => acc | (b << (i * 8)), 0);
	return value >> 2;
}
