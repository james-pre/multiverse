import { existsSync } from 'node:fs';
import type { Save } from '../save.js';
import * as steam from '../steam.js';
import type { Timeline } from '../timeline.js';
import { cyberpunk } from './cyberpunk/index.js';
import { diplomacyIsNotAnOption } from './diplomacy-is-not-an-option/index.js';
import { infraspace } from './infraspace/index.js';
import { skyrim } from './skyrim/index.js';

/** Something a game lets you do with a save, beyond deleting it. */
export interface SaveAction {
	id: string;
	label: string;
	canRun(save: Save): boolean;
	run(save: Save): void;
}

/** Describes save files in detail, by section. */
export interface Inspector {
	/** Descriptions of the sections it can show, by name */
	sections: Record<string, string>;
	/** Whether a file is a save this can read */
	recognizes(path: string): boolean;
	/** Lines describing the chosen sections of a save */
	inspect(path: string, sections: ReadonlySet<string>): Iterable<string>;
	/** The save's data without compression, for other tools */
	decompress?(path: string): Uint8Array;
}

export interface Game {
	id: string;
	name: string;
	/** Set for games sold on Steam, so their saves can be found */
	steam?: steam.Game;
	scan(directory: string): Save[];
	/** A short title for a playthrough, such as the character's background and level. */
	describe(timeline: Timeline): string;
	actions: SaveAction[];
	inspector?: Inspector;
}

export const games = new Map<string, Game>(
	[cyberpunk, skyrim, diplomacyIsNotAnOption, infraspace].map(game => [game.id, game])
);

export function getGame(id: string): Game {
	const game = games.get(id);
	if (!game) throw new Error(`Unknown game "${id}". Known: ${[...games.keys()].join(', ')}`);
	return game;
}

/** A game and the directory its saves are in */
export interface SaveLocation {
	game: Game;
	directory: string;
}

/** Existing directories with the game's saves on this machine, most likely first */
export function findSaveDirectories(game: Game): string[] {
	const candidates = game.steam ? steam.saveDirectories(game.steam) : [];
	return candidates.filter(path => existsSync(path));
}
