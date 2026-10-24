/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { decodeUTF8 } from 'utilium';

/* Reads the .NET Remoting Binary Format (MS-NRBF), which `BinaryFormatter` writes. */

/** The .NET type name of a deserialized object, such as `UI.ProfileSaveHeader` */
export const className = Symbol('className');

export interface Instance {
	[className]: string;
	[member: string]: unknown;
}

export function isInstance(value: unknown): value is Instance {
	return typeof value == 'object' && value !== null && className in value;
}

enum RecordType {
	SerializedStreamHeader = 0,
	ClassWithId = 1,
	SystemClassWithMembers = 2,
	ClassWithMembers = 3,
	SystemClassWithMembersAndTypes = 4,
	ClassWithMembersAndTypes = 5,
	BinaryObjectString = 6,
	BinaryArray = 7,
	MemberPrimitiveTyped = 8,
	MemberReference = 9,
	ObjectNull = 10,
	MessageEnd = 11,
	BinaryLibrary = 12,
	ObjectNullMultiple256 = 13,
	ObjectNullMultiple = 14,
	ArraySinglePrimitive = 15,
	ArraySingleObject = 16,
	ArraySingleString = 17,
}

enum BinaryType {
	Primitive = 0,
	String = 1,
	Object = 2,
	SystemClass = 3,
	Class = 4,
	ObjectArray = 5,
	StringArray = 6,
	PrimitiveArray = 7,
}

enum PrimitiveType {
	Boolean = 1,
	Byte = 2,
	Char = 3,
	Decimal = 5,
	Double = 6,
	Int16 = 7,
	Int32 = 8,
	Int64 = 9,
	SByte = 10,
	Single = 11,
	TimeSpan = 12,
	DateTime = 13,
	UInt16 = 14,
	UInt32 = 15,
	UInt64 = 16,
	Null = 17,
	String = 18,
}

const typedArrays: Partial<Record<PrimitiveType, { BYTES_PER_ELEMENT: number; new (buffer: ArrayBuffer): unknown }>> = {
	[PrimitiveType.Byte]: Uint8Array,
	[PrimitiveType.SByte]: Int8Array,
	[PrimitiveType.Int16]: Int16Array,
	[PrimitiveType.UInt16]: Uint16Array,
	[PrimitiveType.Int32]: Int32Array,
	[PrimitiveType.UInt32]: Uint32Array,
	[PrimitiveType.Int64]: BigInt64Array,
	[PrimitiveType.UInt64]: BigUint64Array,
	[PrimitiveType.TimeSpan]: BigInt64Array,
	[PrimitiveType.Single]: Float32Array,
	[PrimitiveType.Double]: Float64Array,
};

interface MemberType {
	binaryType: BinaryType;
	primitiveType?: PrimitiveType;
}

interface ClassMetadata {
	name: string;
	memberNames: string[];
	/** Missing for classes serialized without member types, whose members are all records */
	memberTypes?: MemberType[];
}

/** Marks a run of null array elements */
class NullRun {
	public constructor(public readonly count: number) {}
}

class Reference {
	public constructor(public readonly id: number) {}
}

const end = Symbol('end');

class Reader {
	protected offset = 0;
	protected readonly view: DataView;
	protected readonly classes = new Map<number, ClassMetadata>();
	public readonly objects = new Map<number, unknown>();
	protected readonly fixups: { container: Record<number | string, unknown>; key: number | string; id: number }[] = [];

	public constructor(protected readonly data: Uint8Array) {
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}

	protected u8(): number {
		return this.view.getUint8(this.offset++);
	}

	protected i32(): number {
		const value = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return value;
	}

	protected bytes(length: number): Uint8Array {
		const bytes = this.data.subarray(this.offset, this.offset + length);
		this.offset += length;
		return bytes;
	}

	/** A string prefixed with its UTF-8 length as a 7-bit encoded integer */
	protected string(): string {
		let length = 0;
		for (let shift = 0; ; shift += 7) {
			const byte = this.u8();
			length |= (byte & 0x7f) << shift;
			if (!(byte & 0x80)) break;
		}
		return decodeUTF8(this.bytes(length));
	}

	protected primitive(type: PrimitiveType): unknown {
		const { view, offset } = this;
		switch (type) {
			case PrimitiveType.Boolean:
				return this.u8() != 0;
			case PrimitiveType.Byte:
				return this.u8();
			case PrimitiveType.SByte:
				this.offset += 1;
				return view.getInt8(offset);
			case PrimitiveType.Char: {
				const first = this.data[offset];
				const length = first < 0x80 ? 1 : first < 0xe0 ? 2 : first < 0xf0 ? 3 : 4;
				return decodeUTF8(this.bytes(length));
			}
			case PrimitiveType.Decimal:
			case PrimitiveType.String:
				return this.string();
			case PrimitiveType.Int16:
				this.offset += 2;
				return view.getInt16(offset, true);
			case PrimitiveType.UInt16:
				this.offset += 2;
				return view.getUint16(offset, true);
			case PrimitiveType.Int32:
				this.offset += 4;
				return view.getInt32(offset, true);
			case PrimitiveType.UInt32:
				this.offset += 4;
				return view.getUint32(offset, true);
			case PrimitiveType.Single:
				this.offset += 4;
				return view.getFloat32(offset, true);
			case PrimitiveType.Double:
				this.offset += 8;
				return view.getFloat64(offset, true);
			case PrimitiveType.Int64:
			case PrimitiveType.TimeSpan:
				this.offset += 8;
				return view.getBigInt64(offset, true);
			case PrimitiveType.UInt64:
			case PrimitiveType.DateTime:
				this.offset += 8;
				return view.getBigUint64(offset, true);
			case PrimitiveType.Null:
				return null;
			default:
				throw new Error(`Unknown primitive type ${type} at ${offset}`);
		}
	}

	protected primitiveArray(type: PrimitiveType, length: number): unknown {
		const TypedArray = typedArrays[type];
		if (!TypedArray) return Array.from({ length }, () => this.primitive(type));
		const bytes = this.bytes(length * TypedArray.BYTES_PER_ELEMENT);
		return new TypedArray(new Uint8Array(bytes).buffer);
	}

	protected memberTypes(count: number): MemberType[] {
		const types = Array.from({ length: count }, (): MemberType => ({ binaryType: this.u8() }));
		for (const type of types) {
			switch (type.binaryType) {
				case BinaryType.Primitive:
				case BinaryType.PrimitiveArray:
					type.primitiveType = this.u8();
					break;
				case BinaryType.SystemClass:
					this.string();
					break;
				case BinaryType.Class:
					this.string();
					this.i32();
					break;
			}
		}
		return types;
	}

	protected classInfo(): { id: number; metadata: ClassMetadata } {
		const id = this.i32();
		const name = this.string();
		const count = this.i32();
		const memberNames = Array.from({ length: count }, () => this.string());
		return { id, metadata: { name, memberNames } };
	}

	/** Stores a value, deferring references until every object has been read. */
	protected assign(container: Record<number | string, unknown>, key: number | string, value: unknown): void {
		if (value instanceof Reference) this.fixups.push({ container, key, id: value.id });
		container[key] = value instanceof Reference ? undefined : value;
	}

	protected instance(id: number, metadata: ClassMetadata): Instance {
		const object: Instance = { [className]: metadata.name };
		this.objects.set(id, object);
		metadata.memberNames.forEach((name, i) => {
			const type = metadata.memberTypes?.[i];
			const value = type?.binaryType == BinaryType.Primitive ? this.primitive(type.primitiveType!) : this.value();
			this.assign(object, name, value);
		});
		return object;
	}

	protected elements(id: number, length: number, read: () => unknown): unknown[] {
		const array: unknown[] = new Array(length);
		this.objects.set(id, array);
		for (let i = 0; i < length;) {
			const value = read();
			if (!(value instanceof NullRun)) {
				this.assign(array, i++, value);
				continue;
			}
			array.fill(null, i, i + value.count);
			i += value.count;
		}
		return array;
	}

	protected binaryArray(): unknown {
		const id = this.i32();
		const arrayType = this.u8();
		const rank = this.i32();
		const lengths = Array.from({ length: rank }, () => this.i32());
		if (arrayType >= 3) this.offset += rank * 4;
		const [type] = this.memberTypes(1);
		const length = lengths.reduce((product, length) => product * length, 1);
		if (type.binaryType != BinaryType.Primitive) return this.elements(id, length, () => this.value());
		const array = this.primitiveArray(type.primitiveType!, length);
		this.objects.set(id, array);
		return array;
	}

	/** Reads the next record, which is a value, a run of nulls or the end of the stream. */
	public record(): unknown {
		const type: RecordType = this.u8();
		switch (type) {
			case RecordType.SerializedStreamHeader: {
				const root = this.i32();
				this.offset += 12;
				return new Reference(root);
			}
			case RecordType.ClassWithId: {
				const id = this.i32();
				const metadata = this.classes.get(this.i32());
				if (!metadata) throw new Error(`Object ${id} uses metadata that hasn't been read`);
				return this.instance(id, metadata);
			}
			case RecordType.SystemClassWithMembers:
			case RecordType.ClassWithMembers:
			case RecordType.SystemClassWithMembersAndTypes:
			case RecordType.ClassWithMembersAndTypes: {
				const { id, metadata } = this.classInfo();
				const hasTypes =
					type == RecordType.SystemClassWithMembersAndTypes || type == RecordType.ClassWithMembersAndTypes;
				if (hasTypes) metadata.memberTypes = this.memberTypes(metadata.memberNames.length);
				if (type == RecordType.ClassWithMembers || type == RecordType.ClassWithMembersAndTypes) this.i32();
				this.classes.set(id, metadata);
				return this.instance(id, metadata);
			}
			case RecordType.BinaryObjectString: {
				const id = this.i32();
				const value = this.string();
				this.objects.set(id, value);
				return value;
			}
			case RecordType.BinaryArray:
				return this.binaryArray();
			case RecordType.MemberPrimitiveTyped:
				return this.primitive(this.u8());
			case RecordType.MemberReference:
				return new Reference(this.i32());
			case RecordType.ObjectNull:
				return null;
			case RecordType.MessageEnd:
				return end;
			case RecordType.BinaryLibrary:
				this.i32();
				this.string();
				return this.record();
			case RecordType.ObjectNullMultiple256:
				return new NullRun(this.u8());
			case RecordType.ObjectNullMultiple:
				return new NullRun(this.i32());
			case RecordType.ArraySinglePrimitive: {
				const id = this.i32();
				const length = this.i32();
				const array = this.primitiveArray(this.u8(), length);
				this.objects.set(id, array);
				return array;
			}
			case RecordType.ArraySingleObject:
			case RecordType.ArraySingleString: {
				const id = this.i32();
				return this.elements(id, this.i32(), () => this.value());
			}
			default:
				throw new Error(`Unknown record type ${type} at ${this.offset - 1}`);
		}
	}

	protected value(): unknown {
		const value = this.record();
		if (value === end) throw new Error('The stream ended inside an object');
		return value;
	}

	public resolve(): void {
		for (const { container, key, id } of this.fixups) container[key] = this.objects.get(id);
	}
}

/** Deserializes a `BinaryFormatter` stream, returning its root object. */
export function parse(data: Uint8Array): unknown {
	const reader = new Reader(data);
	const header = reader.record();
	if (!(header instanceof Reference)) throw new Error('Not a BinaryFormatter stream');
	while (reader.record() !== end);
	reader.resolve();
	return reader.objects.get(header.id);
}
