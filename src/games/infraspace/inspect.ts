import { duration } from 'utilium/format';
import type { Inspector } from '../index.js';
import { isSave, readWhole, type Header } from './save-file.js';

const sections = {
	header: 'The header and the fields at the start of the save',
	city: 'The city level, goal, resources and story so far',
	research: 'Research and upgrade progress',
	contents: 'How many of each kind of thing the save has',
};

type Body = Record<string, unknown>;

function object(value: unknown): Body {
	return typeof value == 'object' && value !== null && !Array.isArray(value) ? (value as Body) : {};
}

function* fields(value: unknown, indent: string): Generator<string> {
	for (const [name, field] of Object.entries(object(value))) {
		if (typeof field != 'object' || field === null) yield `${indent}${name}: ${String(field)}`;
	}
}

function* header(header: Header, body: Body): Generator<string> {
	yield 'Header:';
	yield `\tversion: ${header.version}`;
	if (header.map) yield `\tmap: ${header.map}`;
	yield `\tsave date: ${header.time.toLocaleString()}`;
	yield `\tmap seed: ${String(body.mapSeed)}`;
	yield `\tplay time: ${duration(Number(body.totalPlayTime))}`;
	yield `\tgame time: ${duration(Number(body.totalGameTime))}`;
	yield `\tnext ID: ${String(body.nextID)}`;
	yield `\tsimulation frame: ${String(body.simulationFrame)}`;
	yield '\tworld settings:';
	yield* fields(body.worldSettings, '\t\t');
}

function* city(body: Body): Generator<string> {
	yield 'City:';
	yield* fields(body.populationManager, '\t');
	yield `\tgoal: ${String(object(body.goalManager).currentGoalIndex)}`;
	yield '\tresources:';
	yield* fields(body.resources, '\t\t');
	const story = object(body.storyMessagesModule).shownMessages;
	if (Array.isArray(story)) yield `\tstory messages: ${story.join(', ')}`;
}

function* research(body: Body): Generator<string> {
	const manager = object(body.researchManager);
	yield 'Research:';
	if (typeof manager.currentResearch == 'string') yield `\tcurrent: ${manager.currentResearch}`;
	if (Array.isArray(manager.researchQueue) && manager.researchQueue.length)
		yield `\tqueue: ${manager.researchQueue.join(', ')}`;
	yield* fields(manager.researchProgress, '\t');

	const upgrades = Object.entries(object(object(body.upgradeManager).upgradeCount)).filter(([, count]) => count);
	if (!upgrades.length) return;
	yield 'Upgrades:';
	for (const [name, count] of upgrades) yield `\t${name}: ${String(count)}`;
}

function* contents(body: Body): Generator<string> {
	yield 'Contents:';
	for (const [name, value] of Object.entries(body)) {
		if (Array.isArray(value)) yield `\t${name}: ${value.length}`;
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: isSave,
	*inspect(path, chosen) {
		const save = readWhole(path);
		if (chosen.has('header')) yield* header(save.header, save.body);
		if (chosen.has('city')) yield* city(save.body);
		if (chosen.has('research')) yield* research(save.body);
		if (chosen.has('contents')) yield* contents(save.body);
	},
};
