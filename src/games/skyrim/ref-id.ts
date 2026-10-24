import { struct, types as t } from 'memium';
import refs from './refs.json' with { type: 'json' };

export class RefID extends struct.packed('RefID', {
	byte0: t.uint8,
	byte1: t.uint8,
	byte2: t.uint8,
}) {
	toString(): string {
		return this.formID.toString(16).padStart(8, '0');
	}

	pretty(): string {
		const hex = this.toString();
		if (hex.toUpperCase() in refs) return refs[hex.toUpperCase() as keyof typeof refs];
		if (hex.toLowerCase() in refs) return refs[hex.toLowerCase() as keyof typeof refs];
		return hex;
	}

	get type(): RefIDType {
		return this.byte0 >> 6;
	}

	get formID(): number {
		return ((this.byte0 & 0b00111111) << 16) | (this.byte1 << 8) | this.byte2;
	}
}

enum RefIDType {
	/** An index into the File.formIDArray. If the index value of 0 is given, the formID is 0x00000000, else, index into the array using value - 1. */
	Index = 0,
	/** came from Skyrim.esm */
	Default = 1,
	/** plugin index of 0xFF */
	Created = 2,
	/** ??? */
	Unknown = 3,
}
