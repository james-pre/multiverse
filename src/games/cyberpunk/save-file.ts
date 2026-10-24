import { readFileSync } from 'node:fs';
import { decompressBlock } from '../../lz4.js';
import { readFactsTable } from './facts.js';
import { Package } from './package.js';
import { Reader } from './reader.js';

export interface Header {
	saveVersion: number;
	gameVersion: number;
	gameDefinition: string;
	/** When the save was made, in the time zone the game was played in */
	time: Temporal.PlainDateTime;
	archiveVersion: number;
}

export interface Chunk {
	offset: number;
	compressedSize: number;
	size: number;
}

/** One of the save's named sections of data, such as `inventory` or `FactsDB`, which can contain others */
export interface SaveNode {
	index: number;
	name: string;
	/** Where the node is in the save's data, which starts at the first chunk's offset */
	offset: number;
	size: number;
	parent?: SaveNode;
	children: SaveNode[];
}

/** Unpacks REDengine's `CDateTime`, which packs the date into the upper 32 bits and the time into the lower ones. */
export function unpackDateTime(packed: bigint): Temporal.PlainDateTime {
	const date = Number(packed >> 32n);
	const time = Number(packed & 0xffffffffn);
	return Temporal.PlainDateTime.from({
		year: date >>> 20,
		month: ((date >>> 15) & 0x1f) + 1,
		day: ((date >>> 10) & 0x1f) + 1,
		hour: (time >>> 22) & 0x1f,
		minute: (time >>> 16) & 0x3f,
		second: (time >>> 10) & 0x3f,
		millisecond: time & 0x3ff,
	});
}

/** A `sav.dat` file: a header, a table of LZ4-compressed chunks of data, and a table of the nodes in that data */
export class SaveFile {
	public readonly header: Header;
	public readonly chunks: Chunk[] = [];
	/** Every node, in the order they are listed */
	public readonly nodes: SaveNode[] = [];
	public readonly roots: SaveNode[] = [];
	protected readonly file: Uint8Array;
	protected decompressed?: Uint8Array;

	public constructor(path: string) {
		this.file = readFileSync(path);
		const reader = new Reader(this.file);
		if (reader.magic() != 'CSAV') throw new Error('Not a Cyberpunk 2077 save');

		this.header = {
			saveVersion: reader.u32(),
			gameVersion: reader.u32(),
			gameDefinition: reader.string(),
			time: unpackDateTime(reader.u64()),
			archiveVersion: reader.u32(),
		};

		if (reader.magic() != 'CLZF') throw new Error('The save has no chunk table');
		const count = reader.u32();
		for (let i = 0; i < count; i++) {
			this.chunks.push({ offset: reader.u32(), compressedSize: reader.u32(), size: reader.u32() });
		}

		this.readNodes();
	}

	/** The total size of the save's data, without compression */
	public get size(): number {
		return this.chunks.reduce((total, chunk) => total + chunk.size, 0);
	}

	protected readNodes(): void {
		const end = new Reader(this.file.subarray(-8));
		const tableOffset = end.u32();
		if (end.magic() != 'DONE') throw new Error('The save has no node table');

		const reader = new Reader(this.file.subarray(tableOffset, -8));
		if (reader.magic() != 'NODE') throw new Error('The node table is invalid');
		const count = reader.packedInt();

		const links: { next: number; child: number }[] = [];
		for (let index = 0; index < count; index++) {
			const name = reader.string();
			const next = reader.i32();
			const child = reader.i32();
			const offset = reader.u32();
			const size = reader.u32();
			this.nodes.push({ index, name, offset, size, children: [] });
			links.push({ next, child });
		}

		const siblings = (first: number, parent?: SaveNode): SaveNode[] => {
			const result: SaveNode[] = [];
			for (let index = first; index != -1; index = links[index].next) {
				const node = this.nodes[index];
				node.parent = parent;
				result.push(node);
			}
			return result;
		};

		this.roots.push(...siblings(0));
		for (const node of this.nodes) {
			const { child } = links[node.index];
			if (child != -1) node.children = siblings(child, node);
		}
	}

	/** The save's data, without compression */
	public data(): Uint8Array {
		if (this.decompressed) return this.decompressed;
		const data = new Uint8Array(this.size);
		let position = 0;
		for (const chunk of this.chunks) {
			const reader = new Reader(this.file.subarray(chunk.offset, chunk.offset + chunk.compressedSize));
			if (reader.magic() != 'XLZ4') throw new Error(`Chunk at ${chunk.offset} is not LZ4`);
			const size = reader.u32();
			data.set(decompressBlock(reader.bytes(reader.remaining), size), position);
			position += size;
		}
		this.decompressed = data;
		return data;
	}

	/** A node's data, which starts with its index and includes its children */
	public nodeData(node: SaveNode): Uint8Array {
		const start = node.offset - (this.chunks[0]?.offset ?? 0);
		return this.data().subarray(start, start + node.size);
	}

	public find(name: string): SaveNode | undefined {
		return this.nodes.find(node => node.name == name);
	}

	/** Whether a node's data is a package, which can be read with `package` */
	public isPackage(node: SaveNode): boolean {
		const data = this.nodeData(node);
		if (data.length < 12) return false;
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		return view.getUint16(8, true) == 4 && [6, 7].includes(view.getUint16(10, true));
	}

	/** Reads a node whose data is a package, after its index and size. */
	public package(node: SaveNode): Package {
		return new Package(this.nodeData(node).subarray(8));
	}

	/** Every quest fact, mapping the hash of its name to its value */
	public facts(): Map<number, number> {
		const tables = this.nodes.filter(node => node.name == 'FactsTable');
		return new Map(tables.flatMap(table => [...readFactsTable(this.nodeData(table))]));
	}
}
