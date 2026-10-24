/**
 * Decompress an LZ4 block.
 * @param size The decompressed size
 * @param limit Stop after this many bytes, to read only the start of the data
 */
export function decompressBlock(input: Uint8Array, size: number, limit: number = size): Uint8Array {
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
