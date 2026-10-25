import { cpSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

/* Changing values in saves. Inspections attach an `Edit` to each value that can be changed, and write the save once it has been. */

export type EditValue = number | bigint | string | boolean;

/** How a value in a save can be changed */
export interface Edit {
	/** The current value, whose type is the type of value the edit takes */
	readonly value: EditValue;
	/** Whether a number has to be whole */
	integer?: boolean;
	minimum?: number | bigint;
	maximum?: number | bigint;
	/** Whether changing the value is unlikely to break the save, so it can be changed outside of expert mode */
	safe?: boolean;
	/** The only values the edit takes, for values like a difficulty that the game has a list of */
	choices?: Choice[];
	/** Change the value in the open save, which is written separately */
	set(value: EditValue): void;
}

export interface Choice {
	value: EditValue;
	/** What the game calls the value */
	label: string;
}

/** Limits and safety that an edit can be given when it is made */
export type EditOptions = Partial<Pick<Edit, 'integer' | 'minimum' | 'maximum' | 'safe' | 'choices'>>;

/** Choices whose values are also their labels */
export function namedChoices(values: string[], label: (value: string) => string = value => value): Choice[] {
	return values.map(value => ({ value, label: label(value) }));
}

/** The label of an edit's current value, if the edit has choices */
export function choiceLabel(edit: Edit, value: EditValue = edit.value): string | undefined {
	return edit.choices?.find(choice => choice.value === value)?.label;
}

const booleans: Record<string, boolean> = { true: true, yes: true, 1: true, false: false, no: false, 0: false };

function checkRange(edit: Edit, value: number | bigint): void {
	if (edit.minimum !== undefined && value < edit.minimum) throw new RangeError(`The lowest value is ${edit.minimum}`);
	if (edit.maximum !== undefined && value > edit.maximum)
		throw new RangeError(`The highest value is ${edit.maximum}`);
}

/** A value as text to edit, with floats as the shortest text that reads back as the same 32-bit float */
export function editText(value: EditValue): string {
	if (typeof value != 'number' || Number.isInteger(value) || Math.fround(value) !== value) return String(value);
	for (let precision = 1; precision < 9; precision++) {
		const text = String(Number(value.toPrecision(precision)));
		if (Math.fround(Number(text)) === value) return text;
	}
	return String(value);
}

/** Parses text as a value for `edit`, throwing if it isn't one the edit takes */
export function parseEditValue(edit: Edit, input: string): EditValue {
	const text = input.trim();
	if (edit.choices) {
		const choice = edit.choices.find(
			choice => choice.label.toLowerCase() == text.toLowerCase() || String(choice.value) == text
		);
		if (!choice)
			throw new TypeError(`${input} is not one of ${edit.choices.map(choice => choice.label).join(', ')}`);
		return choice.value;
	}
	switch (typeof edit.value) {
		case 'string':
			return input;
		case 'boolean': {
			const value = booleans[text.toLowerCase()];
			if (value === undefined) throw new TypeError(`${input} is not true or false`);
			return value;
		}
		case 'bigint': {
			if (!/^-?\d+$/.test(text)) throw new TypeError(`${input} is not a whole number`);
			const value = BigInt(text);
			checkRange(edit, value);
			return value;
		}
		default: {
			const value = Number(text);
			if (!text || !Number.isFinite(value)) throw new TypeError(`${input} is not a number`);
			if (edit.integer && !Number.isInteger(value)) throw new TypeError(`${input} is not a whole number`);
			checkRange(edit, value);
			return value;
		}
	}
}

/** Checks that a value is one `edit` takes, converting numbers between `number` and `bigint` */
export function checkEditValue(edit: Edit, value: EditValue): EditValue {
	const type = typeof edit.value;
	if (type == 'bigint' && typeof value == 'number' && Number.isInteger(value)) value = BigInt(value);
	if (type == 'number' && typeof value == 'bigint') value = Number(value);
	if (typeof value != type) throw new TypeError(`Expected a ${type}, not a ${typeof value}`);
	if (edit.choices && !edit.choices.some(choice => choice.value === value))
		throw new RangeError(`${String(value)} is not one of ${edit.choices.map(choice => choice.label).join(', ')}`);
	if (typeof value == 'number' || typeof value == 'bigint') {
		if (typeof value == 'number' && !Number.isFinite(value)) throw new TypeError(`${value} is not a number`);
		if (edit.integer && typeof value == 'number' && !Number.isInteger(value))
			throw new TypeError(`${value} is not a whole number`);
		checkRange(edit, value);
	}
	return value;
}

/** Types of fixed-size values in binary data, which are little-endian */
export type NumberType = 'bool' | 'u8' | 'i8' | 'u16' | 'i16' | 'u32' | 'i32' | 'u64' | 'i64' | 'f32' | 'f64';

interface NumberTypeInfo extends EditOptions {
	size: number;
	read(view: DataView, offset: number): EditValue;
	write(view: DataView, offset: number, value: EditValue): void;
}

function integerType(
	size: number,
	minimum: number,
	maximum: number,
	read: (view: DataView, offset: number) => number,
	write: (view: DataView, offset: number, value: number) => void
): NumberTypeInfo {
	return {
		size,
		integer: true,
		minimum,
		maximum,
		read,
		write: (view, offset, value) => write(view, offset, Number(value)),
	};
}

const numberTypes: Record<NumberType, NumberTypeInfo> = {
	bool: {
		size: 1,
		read: (view, offset) => view.getUint8(offset) != 0,
		write: (view, offset, value) => view.setUint8(offset, value ? 1 : 0),
	},
	u8: integerType(
		1,
		0,
		0xff,
		(view, offset) => view.getUint8(offset),
		(view, offset, value) => view.setUint8(offset, value)
	),
	i8: integerType(
		1,
		-0x80,
		0x7f,
		(view, offset) => view.getInt8(offset),
		(view, offset, value) => view.setInt8(offset, value)
	),
	u16: integerType(
		2,
		0,
		0xffff,
		(view, offset) => view.getUint16(offset, true),
		(view, offset, value) => view.setUint16(offset, value, true)
	),
	i16: integerType(
		2,
		-0x8000,
		0x7fff,
		(view, offset) => view.getInt16(offset, true),
		(view, offset, value) => view.setInt16(offset, value, true)
	),
	u32: integerType(
		4,
		0,
		0xffffffff,
		(view, offset) => view.getUint32(offset, true),
		(view, offset, value) => view.setUint32(offset, value, true)
	),
	i32: integerType(
		4,
		-0x80000000,
		0x7fffffff,
		(view, offset) => view.getInt32(offset, true),
		(view, offset, value) => view.setInt32(offset, value, true)
	),
	u64: {
		size: 8,
		integer: true,
		minimum: 0n,
		maximum: 0xffffffffffffffffn,
		read: (view, offset) => view.getBigUint64(offset, true),
		write: (view, offset, value) => view.setBigUint64(offset, BigInt(value), true),
	},
	i64: {
		size: 8,
		integer: true,
		minimum: -0x8000000000000000n,
		maximum: 0x7fffffffffffffffn,
		read: (view, offset) => view.getBigInt64(offset, true),
		write: (view, offset, value) => view.setBigInt64(offset, BigInt(value), true),
	},
	f32: {
		size: 4,
		minimum: -3.4028234663852886e38,
		maximum: 3.4028234663852886e38,
		read: (view, offset) => view.getFloat32(offset, true),
		write: (view, offset, value) => view.setFloat32(offset, Number(value), true),
	},
	f64: {
		size: 8,
		read: (view, offset) => view.getFloat64(offset, true),
		write: (view, offset, value) => view.setFloat64(offset, Number(value), true),
	},
};

/** The size of a type of value, in bytes */
export function sizeOf(type: NumberType): number {
	return numberTypes[type].size;
}

/** A value as it is stored as a type */
export function encodeNumber(type: NumberType, value: EditValue): Uint8Array {
	const info = numberTypes[type];
	const data = new Uint8Array(info.size);
	info.write(new DataView(data.buffer), 0, value);
	return data;
}

/** The value a type has when it is all zeros, which formats that leave out default values mean */
export function zeroOf(type: NumberType): EditValue {
	return numberTypes[type].read(new DataView(new ArrayBuffer(8)), 0);
}

/** A fixed-size value in binary data, which can be changed where it is */
export interface Location {
	data: Uint8Array;
	offset: number;
	type: NumberType;
}

/** The limits of a type of value, for edits of values stored as it */
export function limitsOf(type: NumberType): EditOptions {
	const { integer, minimum, maximum } = numberTypes[type];
	return { integer, minimum, maximum };
}

/**
 * An edit that changes a value in binary data.
 * @param changed Called with the value as stored, to update the objects inspections show
 */
export function binaryEdit(location: Location, options: EditOptions = {}, changed?: (value: EditValue) => void): Edit {
	const { data, offset, type } = location;
	const info = numberTypes[type];
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const edit: Edit = {
		...limitsOf(type),
		...options,
		get value() {
			return info.read(view, offset);
		},
		set(value) {
			value = checkEditValue(edit, value);
			info.write(view, offset, value);
			changed?.(info.read(view, offset));
		},
	};
	return edit;
}

/** Where the values of deserialized objects are in the binary data they were read from */
export class Locations {
	protected readonly members = new WeakMap<object, Map<string | number, Location>>();
	/** Where the elements of arrays copied from the data start */
	protected readonly arrays = new WeakMap<object, Location>();
	/** The containers that copies of them were made from */
	protected readonly originals = new WeakMap<object, object>();

	public set(container: object, key: string | number, location: Location): void {
		let members = this.members.get(container);
		if (!members) this.members.set(container, (members = new Map()));
		members.set(key, location);
	}

	/** Records where the elements of an array start, which are of a fixed-size type */
	public setArray(array: object, location: Location): void {
		this.arrays.set(array, location);
	}

	/** Records that a container is a copy of one whose locations are known, such as a list's elements */
	public alias(copy: object, original: object): void {
		this.originals.set(copy, original);
	}

	public get(container: object, key: string | number): Location | undefined {
		container = this.originals.get(container) ?? container;
		const member = this.members.get(container)?.get(key);
		if (member) return member;
		const array = this.arrays.get(container);
		if (!array || typeof key != 'number') return;
		return { ...array, offset: array.offset + key * sizeOf(array.type) };
	}

	/** An edit of a value whose location is known */
	public edit(container: object, key: string | number, options?: EditOptions): Edit | undefined {
		const location = this.get(container, key);
		const original = this.originals.get(container);
		return (
			location
			&& binaryEdit(location, options, value => {
				Reflect.set(container, key, value);
				if (original) Reflect.set(original, key, value);
			})
		);
	}
}

/**
 * An edit of an object's property, for objects that store their values themselves, such as views of binary data.
 * @param object The object, or a function returning it for objects that are replaced when they change size
 * @param options.type How the value is stored, where `bool` is stored as a number
 */
export function propertyEdit(
	object: object | (() => object),
	key: string | number,
	options: EditOptions & { type?: NumberType } = {}
): Edit {
	const { type, ...rest } = options;
	const target = typeof object == 'function' ? (object as () => object) : () => object;
	const edit: Edit = {
		...(type ? limitsOf(type) : {}),
		...rest,
		get value() {
			const value = Reflect.get(target(), key) as EditValue;
			return type == 'bool' ? Boolean(value) : value;
		},
		set(value) {
			value = checkEditValue(edit, value);
			Reflect.set(target(), key, type == 'bool' ? Number(value) : value);
		},
	};
	return edit;
}

/** The name of a save's file without its extension, or of its folder */
function stem(path: string): string {
	return existsSync(path) && statSync(path).isDirectory() ? basename(path) : basename(path, extname(path));
}

/**
 * Copies a save's file or folder to `target`, and each of its companions beside it,
 * with the start of their names that matches the save's name changed to the target's.
 */
export function copySave(path: string, target: string, companions: string[] = []): void {
	if (existsSync(target)) throw new Error(`${target} already exists`);
	const isWhole = companions.every(companion => basename(companion).startsWith(basename(path)));
	const from = isWhole ? basename(path) : stem(path);
	const to = isWhole ? basename(target) : stem(target);
	const companionTargets = companions.map(companion => {
		const name = basename(companion);
		if (!name.startsWith(from)) throw new Error(`Can not tell what to call the copy of ${name}`);
		return join(dirname(target), to + name.slice(from.length));
	});
	cpSync(path, target, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
	companions.forEach((companion, i) => {
		if (existsSync(companion))
			cpSync(companion, companionTargets[i], { recursive: true, errorOnExist: true, force: false });
	});
}

/** An edit that also changes other copies of the value, such as one in a summary the game shows before loading */
export function linkedEdit(main: Edit, others: (Edit | undefined)[]): Edit {
	return {
		...main,
		get value() {
			return main.value;
		},
		set(value) {
			main.set(value);
			for (const other of others) other?.set(main.value);
		},
	};
}
