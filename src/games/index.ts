import type { Save } from '../save.js';
import { cyberpunk } from './cyberpunk.js';

export interface Game {
	id: string;
	name: string;
	/** Directories where the game usually keeps its saves, most likely first */
	defaultDirectories: string[];
	scan(directory: string): Save[];
}

export const games = new Map<string, Game>([[cyberpunk.id, cyberpunk]]);

export function getGame(id: string): Game {
	const game = games.get(id);
	if (!game) throw new Error(`Unknown game "${id}". Known: ${[...games.keys()].join(', ')}`);
	return game;
}
