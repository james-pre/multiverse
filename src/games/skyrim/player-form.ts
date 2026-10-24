import { deflateSync } from 'node:zlib';
import { decodeUTF8, encodeUTF8 } from 'utilium';
import { Splice } from '../../splice.js';
import { Change, ChangeFormType, type ChangeForm } from './change-forms.js';

/** The player's base form, whose change form has the player's name, race and sex */
export const playerBaseId = 0x7;

/** Playable races and their vampire forms in `Skyrim.esm`, by editor ID */
export const races: Record<string, number> = {
	ArgonianRace: 0x13740,
	BretonRace: 0x13741,
	DarkElfRace: 0x13742,
	HighElfRace: 0x13743,
	ImperialRace: 0x13744,
	KhajiitRace: 0x13745,
	NordRace: 0x13746,
	OrcRace: 0x13747,
	RedguardRace: 0x13748,
	WoodElfRace: 0x13749,
	ArgonianRaceVampire: 0x8883a,
	BretonRaceVampire: 0x8883c,
	DarkElfRaceVampire: 0x8883d,
	HighElfRaceVampire: 0x88840,
	ImperialRaceVampire: 0x88844,
	KhajiitRaceVampire: 0x88845,
	NordRaceVampire: 0x88794,
	OrcRaceVampire: 0xa82b9,
	RedguardRaceVampire: 0x88846,
	WoodElfRaceVampire: 0x88884,
};

const flags = { ...Change.Form, ...Change.Actor, ...Change.Npc };

/** Flags whose sections this can read past, in the order their sections are in */
const known =
	flags.Flags
	| flags.BaseData
	| flags.BaseFactions
	| flags.BaseSpellList
	| flags.BaseAiData
	| flags.BaseFullname
	| flags.Skills
	| flags.Class
	| flags.Race
	| flags.Face
	| flags.Gender
	| flags.DefaultOutfit
	| flags.SleepOutfit;

/** Reads a vsval, returning its value and size */
function vsval(data: Uint8Array, offset: number): { value: number; size: number } {
	const size = [1, 2, 4][data[offset] & 0b11];
	if (!size) throw new Error(`Invalid vsval at ${offset}`);
	let value = 0;
	for (let i = 0; i < size; i++) value |= data[offset + i] << (i * 8);
	return { value: value >>> 2, size };
}

/** A form ID from `Skyrim.esm`, stored as a ref ID */
function encodeRefId(formId: number): Uint8Array {
	if (formId >= 0x400000) throw new RangeError(`${formId.toString(16)} is not a Skyrim.esm form`);
	return new Uint8Array([0x40 | (formId >> 16), (formId >> 8) & 0xff, formId & 0xff]);
}

/** The form ID of a ref ID that points to a form in `Skyrim.esm`, rather than to the save's form ID array */
function decodeRefId(bytes: Uint8Array): number | undefined {
	if (bytes[0] >> 6 != 1) return;
	return ((bytes[0] & 0x3f) << 16) | (bytes[1] << 8) | bytes[2];
}

/**
 * The player's `NPC_` change form, which overrides the player's name, race and sex.
 * @see https://github.com/mdfairch/FallrimTools/blob/main/src/main/java/resaver/ess/ChangeFormNPC.java
 */
export class PlayerForm {
	/** Where the change form is in the save's body */
	public readonly position: number;
	/** The change form's size in the save's body */
	public readonly size: number;
	/** The change form's data, without compression */
	protected readonly data: Uint8Array;
	protected readonly isCompressed: boolean;
	protected flags: number;
	/** Where each section starts in the data, or would be added */
	protected readonly sections: { name: number; race: number; gender: number };
	protected changes: { name?: string; race?: number; gender?: number } = {};

	public constructor(
		protected readonly form: ChangeForm,
		/** Where the save's body starts in its buffer */
		bodyOffset: number
	) {
		if (form.formType != ChangeFormType.NPC_ || form.formID.formID != playerBaseId)
			throw new Error('Not the player change form');
		this.flags = form.flags >>> 0;
		const unknown = this.flags & ~known;
		if (unknown)
			throw new Error(`The player change form has sections that can not be read (${unknown.toString(16)})`);

		const lengthSize = 1 << (form.type >> 6);
		const view = new DataView(form.buffer, form.byteOffset + 9);
		const read = (offset: number) =>
			lengthSize == 1
				? view.getUint8(offset)
				: lengthSize == 2
					? view.getUint16(offset, true)
					: view.getUint32(offset, true);
		const stored = read(0);
		this.isCompressed = read(lengthSize) != 0;
		this.position = form.byteOffset - bodyOffset;
		this.size = 9 + lengthSize * 2 + stored;
		this.data = form.data;

		let offset = 0;
		const has = (flag: number) => (this.flags & flag) != 0;
		if (has(flags.Flags)) offset += 6;
		if (has(flags.BaseData)) offset += 24;
		if (has(flags.BaseFactions)) {
			const { value, size } = vsval(this.data, offset);
			offset += size + value * 4;
		}
		if (has(flags.BaseSpellList)) {
			for (let i = 0; i < 3; i++) {
				const { value, size } = vsval(this.data, offset);
				offset += size + value * 3;
			}
		}
		if (has(flags.BaseAiData)) offset += 20;
		const name = offset;
		if (has(flags.BaseFullname)) offset += 2 + this.data[offset] + (this.data[offset + 1] << 8);
		if (has(flags.Skills)) offset += 52;
		if (has(flags.Class)) offset += 3;
		const race = offset;
		const outfits = [flags.DefaultOutfit, flags.SleepOutfit].filter(has).length;
		const gender = this.data.length - outfits * 3 - (has(flags.Gender) ? 1 : 0);
		if (offset > gender) throw new Error('The player change form is shorter than its sections');
		this.sections = { name, race, gender };
	}

	protected has(flag: number): boolean {
		return (this.flags & flag) != 0;
	}

	public get name(): string | undefined {
		if (this.changes.name !== undefined) return this.changes.name;
		if (!this.has(flags.BaseFullname)) return;
		const length = this.data[this.sections.name] + (this.data[this.sections.name + 1] << 8);
		return decodeUTF8(this.data.subarray(this.sections.name + 2, this.sections.name + 2 + length));
	}

	public set name(name: string) {
		this.changes.name = name;
	}

	/** The player's race's form ID, if it is from `Skyrim.esm` */
	public get race(): number | undefined {
		if (this.changes.race !== undefined) return this.changes.race;
		if (!this.has(flags.Race)) return;
		return decodeRefId(this.data.subarray(this.sections.race, this.sections.race + 3));
	}

	public set race(formId: number) {
		this.changes.race = formId;
	}

	/** 0 for male and 1 for female, if the save changes it from the base form's */
	public get gender(): number | undefined {
		if (this.changes.gender !== undefined) return this.changes.gender;
		return this.has(flags.Gender) ? this.data[this.sections.gender] : undefined;
	}

	public set gender(gender: number) {
		this.changes.gender = gender;
	}

	public get isChanged(): boolean {
		return Object.keys(this.changes).length > 0;
	}

	/** The change form as it is stored in the save's body, with its changes */
	public write(): Uint8Array {
		const splice = new Splice();
		const { name, race, gender } = this.changes;
		let flagValue = this.flags;
		if (name !== undefined) {
			const text = encodeUTF8(name);
			const bytes = new Uint8Array(2 + text.length);
			new DataView(bytes.buffer).setUint16(0, text.length, true);
			bytes.set(text, 2);
			const old = this.has(flags.BaseFullname)
				? 2 + this.data[this.sections.name] + (this.data[this.sections.name + 1] << 8)
				: 0;
			splice.replace(this.sections.name, old, bytes);
			flagValue |= flags.BaseFullname;
		}
		if (race !== undefined) {
			const old = this.race ?? race;
			const previous = this.has(flags.Race)
				? this.data.subarray(this.sections.race + 3, this.sections.race + 6)
				: encodeRefId(old);
			const bytes = new Uint8Array([...encodeRefId(race), ...previous]);
			splice.replace(this.sections.race, this.has(flags.Race) ? 6 : 0, bytes);
			flagValue |= flags.Race;
		}
		if (gender !== undefined) {
			splice.replace(this.sections.gender, this.has(flags.Gender) ? 1 : 0, new Uint8Array([gender]));
			flagValue |= flags.Gender;
		}
		const data = splice.apply(this.data, []);
		const stored = this.isCompressed ? new Uint8Array(deflateSync(data)) : data;
		const largest = Math.max(stored.length, this.isCompressed ? data.length : 0);
		const lengthSize = largest <= 0xff ? 0 : largest <= 0xffff ? 1 : 2;

		const header = new Uint8Array(9 + (2 << lengthSize));
		const view = new DataView(header.buffer);
		header.set(new Uint8Array(this.form.buffer, this.form.byteOffset, 3));
		view.setUint32(3, flagValue >>> 0, true);
		view.setUint8(7, (this.form.type & 0b111111) | (lengthSize << 6));
		view.setUint8(8, this.form.version);
		const lengths = [stored.length, this.isCompressed ? data.length : 0];
		lengths.forEach((length, i) => {
			const at = 9 + i * (1 << lengthSize);
			if (lengthSize == 0) view.setUint8(at, length);
			else if (lengthSize == 1) view.setUint16(at, length, true);
			else view.setUint32(at, length, true);
		});
		const result = new Uint8Array(header.length + stored.length);
		result.set(header);
		result.set(stored, header.length);
		return result;
	}
}
