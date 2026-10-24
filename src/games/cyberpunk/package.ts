import { decodeUTF8 } from 'utilium';
import { Locations, type NumberType } from '../../editing.js';
import { Reader } from './reader.js';

/* Reads REDengine packages, which serialize objects along with the names of their types and fields. */

/** The REDengine type of a deserialized object, such as `PlayerDevelopmentData` */
export const typeName = Symbol('typeName');

export interface Instance {
	[typeName]: string;
	[field: string]: unknown;
}

export function isInstance(value: unknown): value is Instance {
	return typeof value == 'object' && value !== null && typeName in value;
}

const fixedSizes: Record<string, number> = {
	Bool: 1,
	Int8: 1,
	Uint8: 1,
	Int16: 2,
	Uint16: 2,
	Int32: 4,
	Uint32: 4,
	Float: 4,
	Int64: 8,
	Uint64: 8,
	Double: 8,
	CName: 2,
	TweakDBID: 8,
	CRUID: 8,
};

/** How values of fixed-size types are stored, for changing them where they are */
const numberTypes: Record<string, NumberType> = {
	Bool: 'bool',
	Int8: 'i8',
	Uint8: 'u8',
	Int16: 'i16',
	Uint16: 'u16',
	Int32: 'i32',
	Uint32: 'u32',
	Int64: 'i64',
	Uint64: 'u64',
	Float: 'f32',
	Double: 'f64',
	TweakDBID: 'u64',
	CRUID: 'u64',
};

interface Field {
	name: string;
	type: string;
	offset: number;
}

/** Points to another object in the package, which is resolved once every object has been read */
class Handle {
	public constructor(public readonly index: number) {}
}

export class Package {
	public readonly names: string[] = [];
	/** The objects in the package, the first of which is usually the root */
	public readonly objects: Instance[] = [];
	/** Where the values of fixed-size types are in the package's data */
	public readonly locations = new Locations();
	protected readonly fixups: { container: object; key: string | number; index: number }[] = [];

	public constructor(data: Uint8Array) {
		const header = new Reader(data);
		const version = header.u16();
		if (version != 4) throw new Error(`Unsupported package version ${version}`);
		const sections = header.u16();
		header.u32();
		if (sections == 7) header.offset += 8;
		const namesStart = header.u32();
		const namesEnd = header.u32();
		const chunksStart = header.u32();
		const chunksEnd = header.u32();
		// Some packages list the IDs of their components here, which the name descriptors would otherwise start with.
		const firstName = new DataView(data.buffer, data.byteOffset + header.offset + namesStart).getUint32(0, true);
		if ((firstName & 0xffffff) != namesEnd) {
			const count = header.u32();
			header.offset += count * 8;
		}

		const base = data.subarray(header.offset);
		const reader = new Reader(base);

		reader.offset = namesStart;
		while (reader.offset < namesEnd) {
			const descriptor = reader.u32();
			const offset = descriptor & 0xffffff;
			const length = descriptor >>> 24;
			this.names.push(decodeUTF8(base.subarray(offset, offset + length - 1)));
		}

		reader.offset = chunksStart;
		const chunks: { type: string; offset: number }[] = [];
		while (reader.offset < chunksEnd) chunks.push({ type: this.names[reader.u32()], offset: reader.u32() });

		for (const [i, chunk] of chunks.entries()) {
			const end = chunks[i + 1]?.offset ?? base.length;
			this.objects.push(this.readClass(new Reader(base.subarray(chunk.offset, end)), chunk.type));
		}

		for (const { container, key, index } of this.fixups) Reflect.set(container, key, this.objects[index]);
	}

	protected name(index: number): string {
		const name = this.names[index];
		if (name === undefined) throw new RangeError(`Name ${index} is not in the package`);
		return name;
	}

	protected fields(reader: Reader): Field[] {
		const count = reader.u16();
		return Array.from({ length: count }, () => ({
			name: this.name(reader.u16()),
			type: this.name(reader.u16()),
			offset: reader.u32(),
		}));
	}

	/** Whether the data at the reader looks like an object, rather than an enum's value */
	protected isClass(reader: Reader, length: number): boolean {
		if (length < 2) return false;
		const start = reader.offset;
		try {
			const count = reader.u16();
			if (2 + count * 8 > length) return false;
			let previous = 2 + count * 8;
			for (let i = 0; i < count; i++) {
				const name = reader.u16();
				const type = reader.u16();
				const offset = reader.u32();
				if (name >= this.names.length || type >= this.names.length) return false;
				if (offset < previous || offset > length) return false;
				previous = offset;
			}
			return true;
		} catch {
			return false;
		} finally {
			reader.offset = start;
		}
	}

	/** Reads an object whose data fills the reader from its current position */
	protected readClass(reader: Reader, type: string, end = reader.data.length): Instance {
		const start = reader.offset;
		const object: Instance = { [typeName]: type };
		const fields = this.fields(reader).sort((a, b) => a.offset - b.offset);
		for (const [i, field] of fields.entries()) {
			reader.offset = start + field.offset;
			const fieldEnd = i + 1 < fields.length ? start + fields[i + 1].offset : end;
			this.locate(object, field.name, reader, field.type);
			this.assign(object, field.name, this.readValue(reader, field.type, fieldEnd));
		}
		reader.offset = end;
		return object;
	}

	/** Records where a value of a fixed-size type starts, which is at the reader's position */
	protected locate(container: object, key: string | number, reader: Reader, type: string): void {
		const numberType = numberTypes[type];
		if (numberType)
			this.locations.set(container, key, { data: reader.data, offset: reader.offset, type: numberType });
	}

	protected assign(container: object, key: string | number, value: unknown): void {
		if (value instanceof Handle) {
			this.fixups.push({ container, key, index: value.index });
			value = undefined;
		}
		Reflect.set(container, key, value);
	}

	/** Reads a value of a type that ends by `end`, leaving the reader after it */
	protected readValue(reader: Reader, type: string, end: number): unknown {
		switch (type) {
			case 'Bool':
				return reader.u8() != 0;
			case 'Int8':
				return (reader.u8() << 24) >> 24;
			case 'Uint8':
				return reader.u8();
			case 'Int16':
				return (reader.u16() << 16) >> 16;
			case 'Uint16':
				return reader.u16();
			case 'Int32':
				return reader.i32();
			case 'Uint32':
				return reader.u32();
			case 'Int64':
				return BigInt.asIntN(64, reader.u64());
			case 'Uint64':
			case 'CRUID':
				return reader.u64();
			case 'Float':
				return reader.f32();
			case 'Double':
				return new DataView(new Uint8Array(reader.bytes(8)).buffer).getFloat64(0, true);
			case 'CName':
				return this.name(reader.u16());
			case 'TweakDBID':
				return reader.u64();
			case 'String':
				return reader.string();
			case 'NodeRef':
				return decodeUTF8(reader.bytes(reader.u16()));
			case 'DataBuffer':
			case 'serializationDeferredDataBuffer':
				return reader.bytes(reader.u32());
		}

		const [kind, ...rest] = type.split(':');
		const inner = rest.join(':');
		if (kind == 'handle' || kind == 'whandle') {
			const index = reader.i32();
			return index < 0 ? null : new Handle(index);
		}
		if (kind == 'array' || kind == 'static') {
			const elementType = kind == 'static' ? inner.slice(inner.indexOf(',') + 1) : inner;
			return this.readArray(reader, elementType, end);
		}

		const length = end - reader.offset;
		if (this.isClass(reader, length)) return this.readClass(reader, type, end);
		if (length >= 2) return this.name(reader.u16());
		return reader.bytes(length);
	}

	protected readArray(reader: Reader, type: string, end: number): unknown[] {
		const count = reader.u32();
		const array: unknown[] = [];
		for (let i = 0; i < count; i++) {
			const elementEnd = this.valueEnd(reader, type, end);
			this.locate(array, i, reader, type);
			this.assign(array, i, this.readValue(reader, type, elementEnd));
			reader.offset = elementEnd;
		}
		return array;
	}

	/** Where a value that starts at the reader's position ends, without moving the reader */
	protected valueEnd(reader: Reader, type: string, limit: number): number {
		const start = reader.offset;
		const size = fixedSizes[type];
		if (size !== undefined) return start + size;

		const probe = new Reader(reader.data);
		probe.offset = start;
		const [kind] = type.split(':');
		if (
			type == 'String'
			|| type == 'NodeRef'
			|| type.endsWith('DataBuffer')
			|| kind == 'handle'
			|| kind == 'whandle'
			|| kind == 'array'
			|| kind == 'static'
		) {
			this.readValue(probe, type, limit);
			return probe.offset;
		}
		if (!this.isClass(probe, limit - start)) return start + 2;

		const fields = this.fields(probe).sort((a, b) => a.offset - b.offset);
		const last = fields.at(-1);
		if (!last) return probe.offset;
		probe.offset = start + last.offset;
		return this.valueEnd(probe, last.type, limit);
	}
}
