/**
 * Decompress an LZ4 block.
 * @param size The decompressed size
 * @param limit Stop after this many bytes, to read only the start of the data
 */
export function decompressLZ4(input: Uint8Array, size: number, limit: number = size): Uint8Array {
	const output = new Uint8Array(Math.min(size, limit));
	let inputPosition = 0;
	let outputPosition = 0;

	const readLength = (length: number): number => {
		if (length != 15) return length;
		let byte;
		do {
			byte = input[inputPosition++];
			length += byte;
		} while (byte == 255);
		return length;
	};

	while (inputPosition < input.length && outputPosition < output.length) {
		const token = input[inputPosition++];

		const literalLength = readLength(token >> 4);
		const literals = input.subarray(inputPosition, inputPosition + literalLength);
		output.set(literals.subarray(0, output.length - outputPosition), outputPosition);
		outputPosition += Math.min(literals.length, output.length - outputPosition);
		inputPosition += literalLength;

		// The last sequence only has literals.
		if (inputPosition >= input.length || outputPosition >= output.length) break;

		const offset = input[inputPosition] | (input[inputPosition + 1] << 8);
		inputPosition += 2;
		if (!offset || offset > outputPosition) throw new Error('Invalid LZ4 match offset: ' + offset);

		const matchEnd = Math.min(outputPosition + readLength(token & 15) + 4, output.length);
		let source = outputPosition - offset;
		if (offset >= matchEnd - outputPosition) {
			output.copyWithin(outputPosition, source, source + matchEnd - outputPosition);
			outputPosition = matchEnd;
		} else {
			while (outputPosition < matchEnd) output[outputPosition++] = output[source++];
		}
	}

	return output.subarray(0, outputPosition);
}

/** Hashes the 4 bytes at `position` for finding earlier matches */
function hashAt(view: DataView, position: number, bits: number): number {
	return Math.imul(view.getUint32(position, true), 2654435761) >>> (32 - bits);
}

/** Writes an LZ4 length beyond what fits in a token's 4 bits, returning the position after it */
function writeLength(output: Uint8Array, position: number, length: number): number {
	for (length -= 15; length >= 255; length -= 255) output[position++] = 255;
	output[position++] = length;
	return position;
}

/** Compress data into an LZ4 block, which `decompressLZ4` reads. */
export function compressLZ4(input: Uint8Array): Uint8Array {
	const output = new Uint8Array(input.length + Math.ceil(input.length / 255) + 16);
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	const table = new Int32Array(1 << 16).fill(-1);
	// The last match starts at least 12 bytes before the end, and the last 5 bytes are literals.
	const matchLimit = input.length - 12;
	let position = 0;
	let anchor = 0;
	let outputPosition = 0;

	const writeSequence = (matchLength: number, offset: number): void => {
		const literalLength = position - anchor;
		const token = outputPosition++;
		output[token] = (Math.min(literalLength, 15) << 4) | Math.min(Math.max(matchLength - 4, 0), 15);
		if (literalLength >= 15) outputPosition = writeLength(output, outputPosition, literalLength);
		output.set(input.subarray(anchor, position), outputPosition);
		outputPosition += literalLength;
		if (!matchLength) return;
		output[outputPosition++] = offset & 0xff;
		output[outputPosition++] = offset >> 8;
		if (matchLength - 4 >= 15) outputPosition = writeLength(output, outputPosition, matchLength - 4);
	};

	while (position < matchLimit) {
		const hash = hashAt(view, position, 16);
		const candidate = table[hash];
		table[hash] = position;
		if (
			candidate < 0
			|| position - candidate > 0xffff
			|| view.getUint32(candidate, true) != view.getUint32(position, true)
		) {
			position++;
			continue;
		}

		const longest = input.length - 5 - position;
		let matchLength = 4;
		while (matchLength < longest && input[candidate + matchLength] == input[position + matchLength]) matchLength++;
		writeSequence(matchLength, position - candidate);
		position += matchLength;
		anchor = position;
	}

	position = input.length;
	writeSequence(0, 0);
	return output.subarray(0, outputPosition);
}

/** Compress data with LZF, which `decompressLzf` reads. */
export function compressLzf(input: Uint8Array): Uint8Array {
	const output = new Uint8Array(input.length + Math.ceil(input.length / 32) + 16);
	const table = new Int32Array(1 << 14).fill(-1);
	let position = 0;
	let anchor = 0;
	let outputPosition = 0;

	const flushLiterals = (): void => {
		while (anchor < position) {
			const length = Math.min(position - anchor, 32);
			output[outputPosition++] = length - 1;
			output.set(input.subarray(anchor, anchor + length), outputPosition);
			outputPosition += length;
			anchor += length;
		}
	};

	while (position + 2 < input.length) {
		const hash =
			(Math.imul((input[position] << 16) | (input[position + 1] << 8) | input[position + 2], 2654435761) >>> 18)
			& 0x3fff;
		const candidate = table[hash];
		table[hash] = position;
		const distance = position - candidate - 1;
		if (
			candidate < 0
			|| distance > 0x1fff
			|| input[candidate] != input[position]
			|| input[candidate + 1] != input[position + 1]
			|| input[candidate + 2] != input[position + 2]
		) {
			position++;
			continue;
		}

		const longest = Math.min(264, input.length - position);
		let matchLength = 3;
		while (matchLength < longest && input[candidate + matchLength] == input[position + matchLength]) matchLength++;
		flushLiterals();
		const length = matchLength - 2;
		if (length < 7) {
			output[outputPosition++] = (length << 5) | (distance >> 8);
		} else {
			output[outputPosition++] = (7 << 5) | (distance >> 8);
			output[outputPosition++] = length - 7;
		}
		output[outputPosition++] = distance & 0xff;
		position += matchLength;
		anchor = position;
	}

	position = input.length;
	flushLiterals();
	return output.subarray(0, outputPosition);
}

/**
 * Decompress LZF data.
 * Each control byte below 32 starts a run of that many literal bytes plus one, and any other starts a copy of earlier output.
 */
export function decompressLzf(input: Uint8Array): Uint8Array {
	let output = new Uint8Array(Math.max(input.length * 2, 64));
	let outputPosition = 0;
	let inputPosition = 0;

	const reserve = (length: number): void => {
		if (outputPosition + length <= output.length) return;
		const grown = new Uint8Array(Math.max(output.length * 2, outputPosition + length));
		grown.set(output.subarray(0, outputPosition));
		output = grown;
	};

	while (inputPosition < input.length) {
		const control = input[inputPosition++];

		if (control < 32) {
			const length = control + 1;
			if (inputPosition + length > input.length)
				throw new RangeError('LZF literal run is past the end of the input');
			reserve(length);
			output.set(input.subarray(inputPosition, inputPosition + length), outputPosition);
			inputPosition += length;
			outputPosition += length;
			continue;
		}

		let length = control >> 5;
		if (length == 7) length += input[inputPosition++];
		length += 2;
		let reference = outputPosition - ((control & 0x1f) << 8) - input[inputPosition++] - 1;
		if (reference < 0) throw new RangeError(`LZF reference before the start of the output at ${inputPosition}`);

		reserve(length);
		for (let i = 0; i < length; i++) output[outputPosition++] = output[reference++];
	}

	return output.subarray(0, outputPosition);
}
