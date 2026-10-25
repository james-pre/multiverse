import { readdirSync } from 'node:fs';
import { text } from '../../i18n.js';

/** Save slot folders, like `slot0002` */
export const folderPattern = /^slot(\d+)$/;

/** The slot after the highest one in use, which the game lists as another save */
export function freeSlot(directory: string): string {
	const used = readdirSync(directory).map(name => Number(folderPattern.exec(name)?.[1] ?? -1));
	return `slot${String(Math.max(-1, ...used) + 1).padStart(4, '0')}`;
}

/** The game modes, by their flags in `gameinfo.json` */
export const modes = { survival: 0, freedom: 2, hardcore: 257, creative: 1790 };

export function modeName(mode: number): string {
	return text(`subnautica.mode.${mode}`, { $default: text('subnautica.mode.unknown', { mode }) });
}
