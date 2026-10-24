import { closeSync, openSync, readFileSync, readSync } from 'node:fs';
import { decodeUTF8 } from 'utilium';
import * as nrbf from '../../nrbf.js';

export interface SessionTime extends nrbf.Instance {
	/** Scaled by the game speed, in seconds */
	elapsedTime: number;
	/** In seconds. Missing in early saves. */
	elapsedTimeUnscaled?: number;
}

export interface Research extends nrbf.Instance {
	currentResearchId: number;
	progress: number;
	completeBuildings: Int32Array;
	completeResearches: Int32Array;
}

/** A resource's amount, as in members like `currentWood` */
export interface Resource extends nrbf.Instance {
	valueContainer: { value: number; dailyIncrease: number; dailyDecrease: number };
}

/** The members of `Utility.SaveContainer`, the root of a save, that save-timeline uses */
export interface SaveContainer extends nrbf.Instance {
	saveVersion: number;
	mapSeed: number;
	missionIndex: number;
	difficultyIndex: number;
	isSpecialMission?: boolean;
	sessionTime: SessionTime;
	research: Research;
	buildings: unknown[];
	citizens: unknown[];
	deathCounter: { value: number };
}

/** Every save has a header with the same name plus `.dat`, so this takes either and returns the save itself. */
export function savePath(path: string): string {
	return path.endsWith('.dat') ? path.slice(0, -4) : path;
}

export function readContainer(path: string): SaveContainer {
	const container = nrbf.parse(readFileSync(path));
	if (!nrbf.isInstance(container) || container[nrbf.className] != 'Utility.SaveContainer')
		throw new Error('Not a save');
	return container as SaveContainer;
}

/** Whether a file starts like a save, without reading all of it */
export function isSave(path: string): boolean {
	let fd: number | undefined;
	try {
		fd = openSync(savePath(path), 'r');
		const start = new Uint8Array(1024);
		const length = readSync(fd, start);
		return start[0] == 0 && decodeUTF8(start.subarray(0, length)).includes('Utility.SaveContainer');
	} catch {
		return false;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
