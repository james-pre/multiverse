import { styleText } from 'node:util';
import { decodeUTF8 } from 'utilium';
import { wstring } from './strings.js';

export function formatNumber(value: number | bigint, base?: number): string {
	const prefix = base == 16 ? '0x' : base == 2 ? '0b' : '';
	return styleText('blueBright', prefix + value.toString(base));
}

export function formatString(value: string | Uint8Array | wstring): string {
	if (value instanceof wstring) value = value.data;
	if (ArrayBuffer.isView(value)) value = decodeUTF8(value);
	return styleText('yellow', `"${value}"`);
}
