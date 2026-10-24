import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { findMetadata } from './metadata.js';

/** The next manual save slot in a directory of saves */
export function nextManual(directory: string): string {
	const slots = readdirSync(directory)
		.map(name => /^ManualSave-(\d+)$/.exec(name))
		.filter(match => !!match)
		.map(match => Number(match[1]));
	return `ManualSave-${Math.max(-1, ...slots) + 1}`;
}

/** Changes the slot name in a save's metadata to match its folder's name, which is how the game finds it */
export function rename(folder: string, previous: string): void {
	const metadataPath = findMetadata(folder);
	if (!metadataPath) throw new Error(`${previous} has no metadata`);
	const metadata = readFileSync(metadataPath, 'utf8');
	const nameField = `"name": "${previous}"`;
	if (!metadata.includes(nameField)) throw new Error(`Could not find the slot name in ${metadataPath}`);
	writeFileSync(metadataPath, metadata.replace(nameField, `"name": "${basename(folder)}"`));
}
