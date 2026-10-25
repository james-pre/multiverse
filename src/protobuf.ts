/* eslint-disable no-control-regex */
import { decodeUTF8 } from 'utilium';
import { binaryEdit, checkEditValue, type Edit, type EditOptions } from './editing.js';
import type { Entry } from './inspection.js';

/* Reads protocol buffers without their schema, as fields with numbers and wire types. */

export enum WireType {
	Varint = 0,
	Fixed64 = 1,
	Bytes = 2,
	Fixed32 = 5,
}

/** One field of a message, which can appear more than once */
export interface Field {
	number: number;
	wireType: WireType;
	/** The data the message is in */
	data: Uint8Array;
	/** Where the value starts in `data`, after its tag and any length */
	offset: number;
	/** How many bytes the value takes */
	length: number;
}

export function readVarint(data: Uint8Array, offset: number): { value: bigint; length: number } {
	let value = 0n;
	for (let i = 0; i < 10; i++) {
		if (offset + i >= data.length) throw new RangeError(`Varint at ${offset} runs past the end`);
		const byte = data[offset + i];
		value |= BigInt(byte & 0x7f) << BigInt(7 * i);
		if (!(byte & 0x80)) return { value, length: i + 1 };
	}
	throw new RangeError(`Varint at ${offset} is too long`);
}

/** The fields of a message that fills `data` from `start` to `end` */
export function readFields(data: Uint8Array, start = 0, end = data.length): Field[] {
	const fields: Field[] = [];
	let offset = start;
	while (offset < end) {
		const tag = readVarint(data, offset);
		offset += tag.length;
		const number = Number(tag.value >> 3n);
		const wireType: WireType = Number(tag.value & 7n);
		let length: number;
		switch (wireType) {
			case WireType.Varint:
				length = readVarint(data, offset).length;
				break;
			case WireType.Fixed64:
				length = 8;
				break;
			case WireType.Fixed32:
				length = 4;
				break;
			case WireType.Bytes: {
				const prefix = readVarint(data, offset);
				offset += prefix.length;
				length = Number(prefix.value);
				break;
			}
			default:
				throw new Error(`Unsupported wire type ${wireType as any} at ${offset}`);
		}
		if (!number || offset + length > end) throw new RangeError(`Field at ${offset} runs past its message`);
		fields.push({ number, wireType, data, offset, length });
		offset += length;
	}
	return fields;
}

/** A field's bytes, for fields that are strings, bytes or nested messages */
export function bytesOf(field: Field): Uint8Array {
	return field.data.subarray(field.offset, field.offset + field.length);
}

export function textOf(field: Field): string {
	return decodeUTF8(bytesOf(field));
}

/** A varint field's value, or a fixed field's value read as a float */
export function numberOf(field: Field): number {
	const view = new DataView(field.data.buffer, field.data.byteOffset + field.offset);
	switch (field.wireType) {
		case WireType.Varint:
			return Number(BigInt.asIntN(64, readVarint(field.data, field.offset).value));
		case WireType.Fixed32:
			return view.getFloat32(0, true);
		case WireType.Fixed64:
			return view.getFloat64(0, true);
		default:
			throw new TypeError(`Field ${field.number} is not a number`);
	}
}

/**
 * An edit of a field's value where it is.
 * Varints are written padded to the size they had, which decoders accept, so the value has to fit in that size.
 */
export function fieldEdit(field: Field, options: EditOptions & { boolean?: boolean } = {}): Edit | undefined {
	const { data, offset, length } = field;
	const { boolean, ...rest } = options;
	switch (field.wireType) {
		case WireType.Fixed32:
			return binaryEdit({ data, offset, type: 'f32' }, rest);
		case WireType.Fixed64:
			return binaryEdit({ data, offset, type: 'f64' }, rest);
		case WireType.Varint: {
			const edit: Edit = {
				integer: true,
				minimum: 0,
				maximum: 2 ** (7 * length) - 1,
				...rest,
				get value() {
					const value = Number(readVarint(data, offset).value);
					return boolean ? value != 0 : value;
				},
				set(value) {
					let remaining = BigInt(Number(checkEditValue(edit, value)));
					for (let i = 0; i < length; i++) {
						data[offset + i] = Number(remaining & 0x7fn) | (i < length - 1 ? 0x80 : 0);
						remaining >>= 7n;
					}
				},
			};
			return edit;
		}
	}
}

/** Whether bytes look like a string, rather than a nested message */
function isText(bytes: Uint8Array): boolean {
	if (!bytes.length) return true;
	const text = decodeUTF8(bytes);
	return !text.includes('�') && !/[\u0000-\u0008\u000E-\u001F]/.test(text);
}

/** Describes a message's fields, guessing which bytes are strings and which are nested messages */
export function messageEntries(
	data: Uint8Array,
	start = 0,
	end = data.length,
	names: Record<number, string> = {}
): Entry[] {
	return readFields(data, start, end).map(field => {
		const name = names[field.number] ?? String(field.number);
		if (field.wireType != WireType.Bytes) return { name, summary: String(numberOf(field)), edit: fieldEdit(field) };
		const bytes = bytesOf(field);
		if (isText(bytes)) return { name, summary: JSON.stringify(decodeUTF8(bytes)) };
		try {
			const nested = readFields(field.data, field.offset, field.offset + field.length);
			return {
				name,
				summary: `{${nested.length}}`,
				children: () => messageEntries(field.data, field.offset, field.offset + field.length),
			};
		} catch {
			return { name, summary: `${bytes.length} bytes` };
		}
	});
}
