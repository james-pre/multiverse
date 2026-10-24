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
