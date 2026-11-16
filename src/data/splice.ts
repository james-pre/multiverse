/* Changing the size of parts of binary data whose offsets point past them, so the offsets are moved with what they point to. */

/** A little-endian 32-bit offset in data, which points to `origin` plus its value */
export interface Offset {
	/** Where the offset is stored */
	at: number;
	origin: number;
	/** For offsets packed with something else in their upper bits, such as a length, how many bits are the offset */
	bits?: number;
}

/** Bytes that replace part of the data, or are inserted into it when they replace nothing */
export interface Insertion {
	/** Where the bytes go in the original data. Anything after it moves, and so does anything at it when nothing is replaced. */
	position: number;
	/** How many bytes of the original data they replace */
	replaced: number;
	bytes: Uint8Array;
	/** Orders insertions at the same position, lowest first */
	order: number;
}

/** Changes to the size of parts of data, which are applied all at once */
export class Splice {
	protected readonly insertions: Insertion[] = [];

	public get isEmpty(): boolean {
		return !this.insertions.length;
	}

	public insert(position: number, bytes: Uint8Array, order = 0): Insertion {
		return this.replace(position, 0, bytes, order);
	}

	public replace(position: number, replaced: number, bytes: Uint8Array, order = 0): Insertion {
		const insertion = { position, replaced, bytes, order };
		const overlap = this.insertions.find(
			other =>
				other.replaced
				&& replaced
				&& position < other.position + other.replaced
				&& other.position < position + replaced
		);
		if (overlap) throw new Error(`Bytes ${position} to ${position + replaced} are already being replaced`);
		this.insertions.push(insertion);
		return insertion;
	}

	protected sorted(): Insertion[] {
		return this.insertions.toSorted((a, b) => a.position - b.position || a.order - b.order);
	}

	/** Where a position in the original data is once the changes are made, which is the start of the bytes replacing it if it is replaced */
	public map(position: number): number {
		let moved = position;
		for (const { position: start, replaced, bytes } of this.insertions) {
			if (start + replaced <= position && (replaced || start <= position)) moved += bytes.length - replaced;
			else if (start < position && position < start + replaced) moved -= position - start;
		}
		return moved;
	}

	/** Where an insertion's bytes start once the changes are made */
	public start(insertion: Insertion): number {
		let start = insertion.position;
		for (const other of this.sorted()) {
			if (other === insertion) return start;
			start += other.bytes.length - other.replaced;
		}
		throw new Error('The insertion is not part of this splice');
	}

	/** The data with the changes made and each of `offsets` moved to point where it did */
	public apply(data: Uint8Array, offsets: Offset[]): Uint8Array {
		const parts: Uint8Array[] = [];
		let position = 0;
		for (const insertion of this.sorted()) {
			parts.push(data.subarray(position, insertion.position), insertion.bytes);
			position = insertion.position + insertion.replaced;
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
