import type { Save } from '../save.js';
import type { Timeline } from '../timeline.js';
import { cyberpunk } from './cyberpunk.js';

/** Something a game lets you do with a save, beyond deleting it. */
export interface SaveAction {
	id: string;
	label: string;
	canRun(save: Save): boolean;
	run(save: Save): void;
}

export interface Game {
	id: string;
	name: string;
	/** Directories where the game usually keeps its saves, most likely first */
	defaultDirectories: string[];
	scan(directory: string): Save[];
	/** A short title for a playthrough, such as the character's background and level. */
	describe(timeline: Timeline): string;
	actions: SaveAction[];
}

export const games = new Map<string, Game>([[cyberpunk.id, cyberpunk]]);

export function getGame(id: string): Game {
	const game = games.get(id);
	if (!game) throw new Error(`Unknown game "${id}". Known: ${[...games.keys()].join(', ')}`);
	return game;
}
