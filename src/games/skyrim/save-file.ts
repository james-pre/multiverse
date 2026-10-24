import type { InstanceOf } from 'memium';
import { closeSync, openSync, readSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decompressBlock } from '../../lz4.js';
import type { Pixels } from '../../save.js';
import { CompressionType, SaveBody, SaveHeader } from './structs.js';
import { decodeUTF8 } from 'utilium';

const magic = 'TESV_SAVEGAME';

/** Read part of a file without reading all of it. */
function readRange(path: string, position: number, length: number): Uint8Array {
	const fd = openSync(path, 'r');
	try {
		const buffer = new Uint8Array(length);
		const read = readSync(fd, buffer, 0, length, position);
		if (read < length) throw new Error(`Unexpected end of ${path}`);
		return buffer;
	} finally {
		closeSync(fd);
	}
}

/**
 * A Skyrim Special Edition save (`.ess`), read in parts as they are needed.
 * @see https://en.uesp.net/wiki/Skyrim_Mod:Save_File_Format
 */
export class SaveFile {
	public readonly header: InstanceOf<typeof SaveHeader>;
	/** In bytes */
	public readonly bodySize: number;

	/** Where the screenshot starts, in bytes */
	protected readonly screenshotOffset: number;
	/** Where the possibly compressed body starts, in bytes */
	protected readonly bodyOffset: number;
	/** In bytes */
	protected readonly storedBodySize: number;

	public constructor(public readonly path: string) {
		const start = readRange(path, 0, magic.length + 4);
		if (decodeUTF8(start.subarray(0, magic.length)) != magic) throw new Error(`Not a Skyrim save: ${path}`);
		const headerSize = new DataView(start.buffer).getUint32(magic.length, true);

		const header = readRange(path, start.length, headerSize);
		this.header = new SaveHeader(header.buffer, 0, header.length);
		this.screenshotOffset = start.length + headerSize;

		const afterScreenshot = this.screenshotOffset + this.header.shotWidth * this.header.shotHeight * 4;
		if (this.header.compressionType == CompressionType.None) {
			this.bodyOffset = afterScreenshot;
			this.storedBodySize = this.bodySize = Infinity;
			return;
		}

		const sizes = new DataView(readRange(path, afterScreenshot, 8).buffer);
		this.bodySize = sizes.getUint32(0, true);
		this.storedBodySize = sizes.getUint32(4, true);
		this.bodyOffset = afterScreenshot + 8;
	}

	public screenshot(): Pixels {
		const { shotWidth: width, shotHeight: height } = this.header;
		return { width, height, data: readRange(this.path, this.screenshotOffset, width * height * 4) };
	}

	/**
	 * The decompressed body.
	 * @param limit Read only this many bytes from the start
	 */
	public body(limit: number = this.bodySize): Uint8Array {
		switch (this.header.compressionType) {
			case CompressionType.None:
				return readRange(this.path, this.bodyOffset, limit);
			case CompressionType.zLib:
				return inflateSync(readRange(this.path, this.bodyOffset, this.storedBodySize)).subarray(0, limit);
			case CompressionType.LZ4: {
				// LZ4 expands incompressible data by under 1%, so this much input always covers the limit.
				const stored = Math.min(this.storedBodySize, Math.ceil(limit * 1.01) + 16);
				return decompressBlock(readRange(this.path, this.bodyOffset, stored), this.bodySize, limit);
			}
			default:
				throw new Error(`Unknown compression: ${String(this.header.compressionType)}`);
		}
	}

	public parseBody(): SaveBody {
		const body = this.body();
		return new SaveBody(body.buffer, body.byteOffset, body.byteLength);
	}
}
