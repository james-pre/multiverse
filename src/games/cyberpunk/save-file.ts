import { readFileSync, writeFileSync } from 'node:fs';
import { encodeUTF8 } from 'utilium';
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
	/** Where each node's offset and size are in the node table, by its index */
	protected readonly nodeFields: number[] = [];

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
			this.nodeFields.push(reader.offset);
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
		if (found) return found;
		const data = this.nodeData(node);
		const size = new DataView(data.buffer, data.byteOffset).getUint32(4, true);
		found = new Package(data.subarray(8, 8 + size));
		this.packages.set(node, found);
		return found;
	}

	/** The save's data with the packages that grew written into it, and each node's new offset and size */
	protected resized(): { data: Uint8Array; nodes: { offset: number; size: number }[] } {
		const data = this.data();
		const start = this.chunks[0]?.offset ?? 0;
		const nodes = this.nodes.map(({ offset, size }) => ({ offset, size }));
		const parts: Uint8Array[] = [];
		let position = 0;
		for (const [node, container] of [...this.packages].sort(([a], [b]) => a.offset - b.offset)) {
			if (!container.isResized) continue;
			const nodeStart = node.offset - start;
			const size = new DataView(data.buffer, data.byteOffset + nodeStart).getUint32(4, true);
			const written = container.write();
			const header = new Uint8Array(data.subarray(nodeStart, nodeStart + 8));
			new DataView(header.buffer).setUint32(4, written.length, true);
			parts.push(data.subarray(position, nodeStart), header, written);
			position = nodeStart + 8 + size;

			const growth = written.length - size;
			const end = node.offset + 8 + size;
			this.nodes.forEach((other, i) => {
				if (other.offset >= end) nodes[i].offset += growth;
				else if (other.offset <= node.offset && other.offset + other.size >= end) nodes[i].size += growth;
			});
		}
		if (!parts.length) return { data, nodes };
		parts.push(data.subarray(position));
		return { data: new Uint8Array(Buffer.concat(parts)), nodes };
	}

	/** Writes the save with its data as it is now, compressing only the chunks that changed. */
	public write(path: string): void {
		const first = this.chunks[0];
		if (!first) throw new Error('The save has no data');
		const { data, nodes } = this.resized();
		const chunkSize = Math.max(...this.chunks.map(chunk => chunk.size));
		const count = Math.ceil(data.length / chunkSize);
		if (this.chunkTableOffset + count * 12 > first.offset) throw new Error('The save has too much data for its chunk table');

		const prefix = new Uint8Array(this.file.subarray(0, first.offset));
		const prefixView = new DataView(prefix.buffer);
		prefixView.setUint32(this.chunkTableOffset - 4, count, true);
		const chunks: Uint8Array[] = [];
		let offset = first.offset;
		let position = 0;
		for (let i = 0; i < count; i++) {
			const current = data.subarray(position, position + chunkSize);
			const chunk = this.chunks[i];
			let written: Uint8Array;
			if (chunk && chunk.size == current.length && this.chunkPosition(i) == position) {
				const stored = this.file.subarray(chunk.offset, chunk.offset + chunk.compressedSize);
				const original = decompressLZ4(stored.subarray(8), chunk.size);
				written = original.every((byte, j) => byte == current[j]) ? stored : this.compressChunk(current);
			} else {
				written = this.compressChunk(current);
			}
			prefixView.setUint32(this.chunkTableOffset + i * 12, offset, true);
			prefixView.setUint32(this.chunkTableOffset + i * 12 + 4, written.length, true);
			prefixView.setUint32(this.chunkTableOffset + i * 12 + 8, current.length, true);
			chunks.push(written);
			offset += written.length;
			position += current.length;
		}

		const last = this.chunks.at(-1)!;
		const table = new Uint8Array(this.file.subarray(last.offset + last.compressedSize, -8));
		const tableView = new DataView(table.buffer);
		const tableStart = new DataView(this.file.buffer, this.file.byteOffset + this.file.length - 8).getUint32(0, true);
		const shift = tableStart - (last.offset + last.compressedSize);
		nodes.forEach(({ offset, size }, i) => {
			tableView.setUint32(this.nodeFields[i] + shift, offset, true);
			tableView.setUint32(this.nodeFields[i] + shift + 4, size, true);
		});
		const end = new Uint8Array(this.file.subarray(-8));
		new DataView(end.buffer).setUint32(0, offset + shift, true);
		writeFileSync(path, Buffer.concat([prefix, ...chunks, table, end]));
	}

	/** Where a chunk's data starts in the save's data */
	protected chunkPosition(index: number): number {
		return this.chunks.slice(0, index).reduce((total, chunk) => total + chunk.size, 0);
	}

	protected compressChunk(data: Uint8Array): Uint8Array {
		const header = new Uint8Array(8);
		header.set(encodeUTF8('4ZLX'));
		new DataView(header.buffer).setUint32(4, data.length, true);
		return Buffer.concat([header, compressLZ4(data)]);
	}

	/** Every quest fact, mapping the hash of its name to its value */
	public facts(): Map<number, number> {
		const tables = this.nodes.filter(node => node.name == 'FactsTable');
		return new Map(tables.flatMap(table => [...readFactsTable(this.nodeData(table))]));
	}
}
