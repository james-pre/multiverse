import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { copySave, linkedEdit, type Edit } from '../../editing.js';
import { formatValue, hoursAndMinutes } from '../../format.js';
import { text } from '../../i18n.js';
import type { Entry, Inspection, Row } from '../../inspection.js';
import * as nrbf from '../../nrbf.js';
import type { Inspector } from '../index.js';
import { isSave, openContainer, savePath, type Resource, type SaveContainer } from './container.js';

const sections = {
	session: { title: text('dinao.section.session.title'), description: text('dinao.section.session.description') },
	resources: {
		title: text('dinao.section.resources.title'),
		description: text('dinao.section.resources.description'),
	},
	research: { title: text('dinao.section.research.title'), description: text('dinao.section.research.description') },
	entities: { title: text('dinao.section.entities.title'), description: text('dinao.section.entities.description') },
};

function isResource(value: unknown): value is Resource {
	return nrbf.isInstance(value) && nrbf.isInstance(value.valueContainer);
}

/** Turns member names like `treeSaveData` into names like `Tree` */
function memberName(name: string): string {
	const words = name.replace(/(SaveData)+$|Data$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

class DinoInspection implements Inspection {
	protected readonly path: string;
	protected readonly container: SaveContainer;
	protected readonly document: nrbf.Document;
	/** The header the game lists the save with, which has some of the save's values */
	protected readonly header?: nrbf.Document;

	public constructor(path: string) {
		this.path = savePath(path);
		({ container: this.container, document: this.document } = openContainer(this.path));
		const headerPath = `${this.path}.dat`;
		if (existsSync(headerPath)) this.header = nrbf.read(readFileSync(headerPath));
	}

	/** The difficulty's index in the mission's difficulties, changing it in the header too */
	protected difficultyEdit(): Edit | undefined {
		// The game falls back to a valid difficulty when the index is out of range.
		const main = this.document.locations.edit(this.container, 'difficultyIndex', { safe: true, minimum: 0 });
		const root = this.header?.root;
		return main && linkedEdit(main, [nrbf.isInstance(root) ? this.header!.locations.edit(root, 'difficultyId') : undefined]);
	}

	protected session(): Row[] {
		const { container } = this;
		const { sessionTime } = container;
		const rows: Row[] = [
			{ label: text('dinao.row.mission'), value: String(container.missionIndex) },
			{ label: text('dinao.row.map_seed'), value: String(container.mapSeed) },
			{
				label: text('dinao.row.difficulty'),
				value: formatValue(container.difficultyIndex),
				edit: this.difficultyEdit(),
			},
		];
		if (sessionTime.elapsedTimeUnscaled !== undefined) {
			rows.push({ label: text('dinao.row.play_time'), value: hoursAndMinutes(sessionTime.elapsedTimeUnscaled) });
		}
		rows.push(
			{ label: text('dinao.row.game_time'), value: hoursAndMinutes(sessionTime.elapsedTime) },
			{
				label: text('dinao.row.kills'),
				value: formatValue(container.deathCounter.value),
				edit: this.document.locations.edit(container.deathCounter, 'value', { minimum: 0 }),
			},
			{ label: text('dinao.row.save_version'), value: String(container.saveVersion) }
		);
		return rows;
	}

	protected resources(): Row[] {
		const rows: Row[] = [];
		for (const [name, value] of Object.entries(this.container)) {
			if (!name.startsWith('current') || !isResource(value)) continue;
			const { value: amount, dailyIncrease, dailyDecrease } = value.valueContainer;
			const resource = name.slice('current'.length);
			rows.push({
				label: text(`dinao.resource.${resource}`, { $default: resource }),
				value: formatValue(amount),
				detail: text('dinao.row.daily', { increase: dailyIncrease, decrease: dailyDecrease }),
				edit: this.document.locations.edit(value.valueContainer, 'value', { safe: true, minimum: 0 }),
			});
		}
		return rows;
	}

	protected research(): Row[] {
		const { research } = this.container;
		const rows: Row[] = [];
		if ((research.currentResearchId ?? -1) != -1) {
			rows.push({
				label: text('dinao.row.current_research'),
				value: String(research.currentResearchId),
				detail: text('dinao.row.progress', { progress: research.progress }),
			});
		}
		const completed = [
			[text('dinao.row.buildings'), research.completeBuildings],
			[text('dinao.row.research'), research.completeResearches],
		] as const;
		for (const [label, ids] of completed) {
			rows.push({ label, value: formatValue(ids.length), rows: Array.from(ids, id => ({ label: String(id) })) });
		}
		return rows;
	}

	protected entities(): Row[] {
		const rows: Row[] = [];
		for (const [name, value] of Object.entries(this.container)) {
			const items = nrbf.listItems(value) ?? (Array.isArray(value) ? value : undefined);
			if (!items?.length || nrbf.isEnum(items[0])) continue;
			rows.push({ label: memberName(name), value: formatValue(items.length) });
		}
		return rows;
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'session':
				return this.session();
			case 'resources':
				return this.resources();
			case 'research':
				return this.research();
			case 'entities':
				return this.entities();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	public contents(): Entry {
		const { header } = this;
		return {
			name: basename(this.path),
			summary: '',
			children: () => [
				...(header ? [nrbf.entry('header', header.root, header.locations)] : []),
				nrbf.entry('save', this.container, this.document.locations),
			],
		};
	}

	public write(path: string): void {
		writeFileSync(savePath(path), this.document.data);
		if (this.header) writeFileSync(`${savePath(path)}.dat`, this.header.data);
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: isSave,
	open: path => new DinoInspection(path),
	copy(path) {
		const save = savePath(path);
		let target = `${save} copy`;
		for (let i = 2; existsSync(target); i++) target = `${save} copy ${i}`;
		copySave(save, target, [`${save}.dat`]);
		return target;
	},
};
