import { basename } from 'node:path';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import { valueEntry, type Entry, type Inspection, type Row } from '../../inspection.js';
import type { Inspector } from '../index.js';
import { isSave, readWhole, type Header } from './save-file.js';

const sections = {
	city: { title: text('infraspace.section.city.title'), description: text('infraspace.section.city.description') },
	resources: {
		title: text('infraspace.section.resources.title'),
		description: text('infraspace.section.resources.description'),
	},
	research: {
		title: text('infraspace.section.research.title'),
		description: text('infraspace.section.research.description'),
	},
	contents: {
		title: text('infraspace.section.contents.title'),
		description: text('infraspace.section.contents.description'),
	},
};

type Body = Record<string, unknown>;

function object(value: unknown): Body {
	return typeof value == 'object' && value !== null && !Array.isArray(value) ? (value as Body) : {};
}

/** Turns names like `fourLaneRoads` into names like `Four lane roads` */
function humanize(name: string): string {
	const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/-(\d+)$/, ' $1');
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

function primitive(value: unknown): string {
	return typeof value == 'number' || typeof value == 'boolean' || typeof value == 'string' ? formatValue(value) : '';
}

class InfraSpaceInspection implements Inspection {
	protected readonly header: Header;
	protected readonly body: Body;

	public constructor(protected readonly path: string) {
		({ header: this.header, body: this.body } = readWhole(path));
	}

	protected city(): Row[] {
		const { header, body } = this;
		const population = object(body.populationManager);
		const story = object(body.storyMessagesModule).shownMessages;
		const rows: Row[] = [
			{ label: text('infraspace.row.name'), value: basename(this.path, '.sav') },
			{ label: text('infraspace.row.version'), value: header.version },
		];
		if (header.map) rows.push({ label: text('infraspace.row.map'), value: header.map });
		rows.push(
			{
				label: text('infraspace.row.saved'),
				value: shortDate(header.time.toZonedDateTimeISO(Temporal.Now.timeZoneId())),
			},
			{ label: text('infraspace.row.play_time'), value: hoursAndMinutes(Number(body.totalPlayTime)) },
			{ label: text('infraspace.row.game_time'), value: hoursAndMinutes(Number(body.totalGameTime)) },
			{ label: text('infraspace.row.city_level'), value: primitive(population.cityLevel) },
			{ label: text('infraspace.row.habitat_level'), value: primitive(population.avgHabitatLevel) },
			{
				label: text('infraspace.row.immigrants'),
				value: primitive(Math.floor(Number(population.waitingImmigrants))),
			},
			{ label: text('infraspace.row.goal'), value: primitive(object(body.goalManager).currentGoalIndex) }
		);
		if (Array.isArray(story) && story.length) {
			rows.push({
				label: text('infraspace.row.story'),
				value: formatValue(story.length),
				rows: story.map(message => ({ label: humanize(String(message)) })),
			});
		}
		return rows;
	}

	protected resources(): Row[] {
		return Object.entries(object(this.body.resources)).map(([name, amount]) => ({
			label: humanize(name),
			value: primitive(amount),
		}));
	}

	protected research(): Row[] {
		const manager = object(this.body.researchManager);
		const progress = Object.entries(object(manager.researchProgress));
		const rows: Row[] = [];
		if (typeof manager.currentResearch == 'string') {
			rows.push({ label: text('infraspace.row.current_research'), value: humanize(manager.currentResearch) });
		}
		const done = progress.filter(([name, value]) => Number(value) > 0 && name != manager.currentResearch);
		rows.push({
			label: text('infraspace.row.researched'),
			value: formatValue(done.length),
			rows: done.map(([name]) => ({ label: humanize(name) })),
		});
		const upgrades = Object.entries(object(object(this.body.upgradeManager).upgradeCount)).filter(([, count]) =>
			Number(count)
		);
		if (upgrades.length) {
			rows.push({
				label: text('infraspace.row.upgrades'),
				value: formatValue(upgrades.length),
				rows: upgrades.map(([name, count]) => ({ label: humanize(name), value: primitive(count) })),
			});
		}
		return rows;
	}

	protected contentRows(): Row[] {
		return Object.entries(this.body)
			.filter(([, value]) => Array.isArray(value) && value.length)
			.map(([name, value]) => ({ label: humanize(name), value: formatValue((value as unknown[]).length) }));
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'city':
				return this.city();
			case 'resources':
				return this.resources();
			case 'research':
				return this.research();
			case 'contents':
				return this.contentRows();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	public contents(): Entry {
		const header = { ...this.header, time: this.header.time.toString() };
		return {
			name: basename(this.path),
			summary: '',
			children: () => [valueEntry('header', header), valueEntry('save', this.body)],
		};
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: isSave,
	open: path => new InfraSpaceInspection(path),
};
