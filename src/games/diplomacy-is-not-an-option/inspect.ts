import { existsSync, readFileSync } from 'node:fs';
import { duration } from 'utilium/format';
import * as nrbf from '../../nrbf.js';
import type { Inspector } from '../index.js';
import { isSave, readContainer, savePath, type Resource, type SaveContainer } from './container.js';

const sections = {
	header: 'The header beside the save, with campaign progress',
	session: 'The map, mission, play time and resources',
	research: 'Completed buildings and research',
	entities: 'How many of each kind of thing the save has',
	members: 'Every member of the save, with long arrays shortened',
};

function* header(path: string): Generator<string> {
	const headerPath = `${path}.dat`;
	if (!existsSync(headerPath)) return yield 'Header: missing';
	yield* nrbf.dump('Header', nrbf.parse(readFileSync(headerPath)), { depth: 2, items: 8 });
}

function isResource(value: unknown): value is Resource {
	return nrbf.isInstance(value) && nrbf.isInstance(value.valueContainer);
}

function* session(container: SaveContainer): Generator<string> {
	const { sessionTime } = container;
	yield 'Session:';
	yield `\tsave version: ${container.saveVersion}`;
	yield `\tmap seed: ${container.mapSeed}`;
	yield `\tmission: ${container.missionIndex}${container.isSpecialMission ? ' (special)' : ''}`;
	yield `\tdifficulty: ${container.difficultyIndex}`;
	if (sessionTime.elapsedTimeUnscaled !== undefined)
		yield `\tplay time: ${duration(sessionTime.elapsedTimeUnscaled)}`;
	yield `\tgame time: ${duration(sessionTime.elapsedTime)}`;
	yield `\tenemies killed: ${container.deathCounter.value}`;
	yield '\tresources:';
	for (const [name, value] of Object.entries(container)) {
		if (!name.startsWith('current') || !isResource(value)) continue;
		const { value: amount, dailyIncrease, dailyDecrease } = value.valueContainer;
		yield `\t\t${name.slice('current'.length)}: ${amount} (+${dailyIncrease} / -${dailyDecrease} a day)`;
	}
}

function* research({ research }: SaveContainer): Generator<string> {
	yield 'Research:';
	if (research.currentResearchId != -1) {
		yield `\tcurrent: ${research.currentResearchId} (${research.progress} done)`;
	}
	yield `\tbuildings (${research.completeBuildings.length}): ${research.completeBuildings.join(', ')}`;
	yield `\tresearch (${research.completeResearches.length}): ${research.completeResearches.join(', ')}`;
}

function* entities(container: SaveContainer): Generator<string> {
	yield 'Entities:';
	for (const [name, value] of Object.entries(container)) {
		const items = nrbf.listItems(value) ?? (Array.isArray(value) ? value : undefined);
		if (items && !nrbf.isEnum(items[0])) yield `\t${name}: ${items.length}`;
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: isSave,
	*inspect(path, chosen) {
		path = savePath(path);
		const container = readContainer(path);
		if (chosen.has('header')) yield* header(path);
		if (chosen.has('session')) yield* session(container);
		if (chosen.has('research')) yield* research(container);
		if (chosen.has('entities')) yield* entities(container);
		if (chosen.has('members')) yield* nrbf.dump('Save', container, { depth: 2 });
	},
};
