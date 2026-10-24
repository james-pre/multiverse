import { decodeUTF8 } from 'utilium';

/** Reads the little-endian values of REDengine's binary formats in order. */
export class Reader {
	public offset = 0;
	protected readonly view: DataView;

	public constructor(public readonly data: Uint8Array) {
		this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	}

	public get remaining(): number {
		return this.data.length - this.offset;
	}

	public u8(): number {
		return this.view.getUint8(this.offset++);
	}

	public u16(): number {
		const value = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return value;
	}

	public u32(): number {
		const value = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return value;
	}

	public i32(): number {
		const value = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return value;
	}

	public u64(): bigint {
		const value = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return value;
	}

	public f32(): number {
		const value = this.view.getFloat32(this.offset, true);
		this.offset += 4;
		return value;
	}

	public bytes(length: number): Uint8Array {
		if (length > this.remaining) throw new RangeError(`Can not read ${length} bytes at ${this.offset}`);
		const bytes = this.data.subarray(this.offset, this.offset + length);
		this.offset += length;
		return bytes;
	}

	/** Four ASCII characters stored as a little-endian integer, so `CSAV` is stored as `VASC` */
	public magic(): string {
		return String.fromCharCode(...this.bytes(4).toReversed());
	}

	/**
	 * A variable-length integer.
	 * The first byte has the sign, a continuation bit and 6 bits of the value, and each later byte has a continuation bit and 7 more.
	 */
	public packedInt(): number {
		let byte = this.u8();
		const isNegative = (byte & 0x80) != 0;
		let value = byte & 0x3f;
		if (byte & 0x40) {
			for (let shift = 6; ; shift += 7) {
				byte = this.u8();
				value |= (byte & 0x7f) << shift;
				if (!(byte & 0x80)) break;
			}
		}
		return isNegative ? -value : value;
	}

	/** A string with a packed length, which is negative for single-byte text and otherwise counts UTF-16 code units */
	public string(): string {
		const length = this.packedInt();
		if (length <= 0) return decodeUTF8(this.bytes(-length));
		const units = this.bytes(length * 2);
		return String.fromCharCode(...new Uint16Array(new Uint8Array(units).buffer));
	}
}
