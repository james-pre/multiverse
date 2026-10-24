import { readFileSync, writeFileSync } from 'node:fs';
import { compressLZ4, decompressLZ4 } from '../../compression.js';
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
	/** Where the chunk table's entries start in the file */
	protected readonly chunkTableOffset: number;
	protected readonly packages = new Map<SaveNode, Package>();

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
		this.chunkTableOffset = reader.offset;
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
			data.set(decompressLZ4(reader.bytes(reader.remaining), size), position);
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

	/** Reads a node whose data is a package, after its index and size, keeping it so changes to it are kept. */
	public package(node: SaveNode): Package {
		let found = this.packages.get(node);
		if (!found) this.packages.set(node, (found = new Package(this.nodeData(node).subarray(8))));
		return found;
	}

	/** Writes the save with its data as it is now, compressing only the chunks that changed. */
	public write(path: string): void {
		const data = this.data();
		const first = this.chunks[0];
		if (!first) throw new Error('The save has no data');
		const chunks: Uint8Array[] = [];
		const prefix = new Uint8Array(this.file.subarray(0, first.offset));
		const table = new DataView(prefix.buffer, this.chunkTableOffset);
		let offset = first.offset;
		let position = 0;

		for (const [i, chunk] of this.chunks.entries()) {
			const expected = i ? this.chunks[i - 1].offset + this.chunks[i - 1].compressedSize : first.offset;
			if (chunk.offset != expected) throw new Error('The save has data between its chunks');
			const stored = this.file.subarray(chunk.offset, chunk.offset + chunk.compressedSize);
			const current = data.subarray(position, position + chunk.size);
			position += chunk.size;
			const original = decompressLZ4(stored.subarray(8), chunk.size);
			const isChanged = original.length != current.length || original.some((byte, j) => byte != current[j]);
			const written = isChanged ? Buffer.concat([stored.subarray(0, 8), compressLZ4(current)]) : stored;
			table.setUint32(i * 12, offset, true);
			table.setUint32(i * 12 + 4, written.length, true);
			chunks.push(written);
			offset += written.length;
		}

		const last = this.chunks.at(-1)!;
		const tableOffset = new DataView(this.file.buffer, this.file.byteOffset + this.file.length - 8).getUint32(
			0,
			true
		);
		const nodes = this.file.subarray(last.offset + last.compressedSize, -8);
		const end = new Uint8Array(this.file.subarray(-8));
		new DataView(end.buffer).setUint32(0, tableOffset + offset - (last.offset + last.compressedSize), true);
		writeFileSync(path, Buffer.concat([prefix, ...chunks, nodes, end]));
	}

	/** Every quest fact, mapping the hash of its name to its value */
	public facts(): Map<number, number> {
		const tables = this.nodes.filter(node => node.name == 'FactsTable');
		return new Map(tables.flatMap(table => [...readFactsTable(this.nodeData(table))]));
	}
}
