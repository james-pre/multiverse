import { Reader } from './reader.js';

/** The 32-bit FNV-1a hash of a fact's name, which is how facts are stored */
export function factHash(name: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < name.length; i++) {
		hash ^= name.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export interface Fact {
	/** The hash of the fact's name */
	hash: number;
	value: number;
	/** Where the value is in the node's data */
	offset: number;
}

/** Reads a `FactsTable` node, which lists the facts' hashes and then their values. */
export function readFacts(data: Uint8Array): Fact[] {
	const reader = new Reader(data);
	reader.offset = 4;
	const count = reader.packedInt();
	const hashes = Array.from({ length: count }, () => reader.u32());
	return hashes.map(hash => ({ hash, offset: reader.offset, value: reader.i32() }));
}

/** Reads a `FactsTable` node, mapping each fact's hash to its value. */
export function readFactsTable(data: Uint8Array): Map<number, number> {
	return new Map(readFacts(data).map(fact => [fact.hash, fact.value]));
}
