/* Inserting bytes into binary data whose offsets point past where they are inserted, so the offsets are moved with what they point to. */

/** A little-endian 32-bit offset in data, which points to `origin` plus its value */
export interface Offset {
	/** Where the offset is stored */
	at: number;
	origin: number;
	/** For offsets packed with something else in their upper bits, such as a length, how many bits are the offset */
	bits?: number;
}

export interface Insertion {
	/** Where the bytes go in the original data. Anything at or after it moves. */
	position: number;
	bytes: Uint8Array;
	/** Orders insertions at the same position, lowest first */
	order: number;
}

/** Bytes to insert into data, which are applied all at once */
export class Splice {
	protected readonly insertions: Insertion[] = [];

	public get isEmpty(): boolean {
		return !this.insertions.length;
	}

	public insert(position: number, bytes: Uint8Array, order = 0): Insertion {
		const insertion = { position, bytes, order };
		this.insertions.push(insertion);
		return insertion;
	}

	protected sorted(): Insertion[] {
		return this.insertions.toSorted((a, b) => a.position - b.position || a.order - b.order);
	}

	/** Where a position in the original data is once the insertions are made */
	public map(position: number): number {
		let moved = position;
		for (const insertion of this.insertions) if (insertion.position <= position) moved += insertion.bytes.length;
		return moved;
	}

	/** Where an insertion's bytes start once the insertions are made */
	public start(insertion: Insertion): number {
		let start = insertion.position;
		for (const other of this.sorted()) {
			if (other === insertion) return start;
			if (other.position <= insertion.position) start += other.bytes.length;
		}
		throw new Error('The insertion is not part of this splice');
	}

	/** The data with the insertions made and each of `offsets` moved to point where it did */
	public apply(data: Uint8Array, offsets: Offset[]): Uint8Array {
		const parts: Uint8Array[] = [];
		let position = 0;
		for (const insertion of this.sorted()) {
			parts.push(data.subarray(position, insertion.position), insertion.bytes);
			position = insertion.position;
		}
		parts.push(data.subarray(position));
		const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
		let offset = 0;
		for (const part of parts) {
			result.set(part, offset);
			offset += part.length;
		}

		const original = new DataView(data.buffer, data.byteOffset, data.byteLength);
		const view = new DataView(result.buffer);
		for (const { at, origin, bits = 32 } of offsets) {
			const stored = original.getUint32(at, true);
			const limit = 2 ** bits;
			const target = origin + (stored % limit);
			const moved = this.map(target) - this.map(origin);
			if (moved >= limit) throw new RangeError(`An offset at ${at} no longer fits in ${bits} bits`);
			view.setUint32(this.map(at), stored - (stored % limit) + moved, true);
		}
		return result;
	}
}
