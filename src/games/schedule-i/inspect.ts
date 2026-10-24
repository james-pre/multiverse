import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { Edit, EditOptions } from '../../editing.js';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import type { Entry, Inspection, Row } from '../../inspection.js';
import { JsonDocument } from '../../json.js';
import type { Inspector } from '../index.js';
import { money, rankName } from './names.js';
import { readSaveFolder } from './save-file.js';

const sections = {
	organisation: {
		title: text('schedule.section.organisation.title'),
		description: text('schedule.section.organisation.description'),
	},
	money: { title: text('schedule.section.money.title'), description: text('schedule.section.money.description') },
	rank: { title: text('schedule.section.rank.title'), description: text('schedule.section.rank.description') },
};

/** Every JSON file in a save's folder, by its path in the folder */
function jsonFiles(folder: string, directory = folder): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return jsonFiles(folder, path);
		return entry.name.endsWith('.json') ? [relative(folder, path)] : [];
	});
}

class ScheduleInspection implements Inspection {
	/** The save's files, read as they are needed */
	protected readonly documents = new Map<string, JsonDocument>();

	public constructor(protected readonly folder: string) {
		if (!existsSync(join(folder, 'Game.json'))) throw new Error('Not a Schedule I save');
	}

	protected document(name: string): JsonDocument | undefined {
		const existing = this.documents.get(name);
		if (existing) return existing;
		const path = join(this.folder, name);
		if (!existsSync(path)) return;
		const document = new JsonDocument(readFileSync(path, 'utf8'));
		this.documents.set(name, document);
		return document;
	}

	/** A member of a file's top-level object, with an edit for it */
	protected field(file: string, key: string, options?: EditOptions): { value: unknown; edit?: Edit } {
		const document = this.document(file);
		const object = document?.value as Record<string, unknown> | undefined;
		if (!document || !object || !(key in object)) return { value: undefined };
		return { value: object[key], edit: document.edit(object, key, options) };
	}

	/** The cash the player carries, which is an item whose data is JSON in a string */
	protected cash(): Row | undefined {
		const document = this.document('Players/Player_0/Inventory.json');
		const items = (document?.value as { Items?: string[] } | undefined)?.Items;
		if (!document || !items) return;
		for (const i of items.keys()) {
			const item = document.nested(items, i);
			const data = item?.value as { DataType?: string; CashBalance?: number } | undefined;
			if (!item || data?.DataType != 'CashData') continue;
			return {
				label: text('schedule.row.cash'),
				value: money(Number(data.CashBalance)),
				edit: item.edit(data, 'CashBalance', { safe: true, minimum: 0 }),
			};
		}
	}

	protected organisation(): Row[] {
		const save = readSaveFolder(this.folder);
		const name = this.field('Game.json', 'OrganisationName', { safe: true });
		const day = this.field('Time.json', 'ElapsedDays', { minimum: 0 });
		const rows: Row[] = [
			{ label: text('schedule.row.name'), value: save.organisation, edit: name.edit },
			{ label: text('schedule.row.version'), value: save.version },
			{ label: text('schedule.row.seed'), value: String(save.seed) },
		];
		if (save.created) rows.push({ label: text('schedule.row.created'), value: shortDate(save.created) });
		if (save.lastPlayed) rows.push({ label: text('schedule.row.last_played'), value: shortDate(save.lastPlayed) });
		rows.push(
			{ label: text('schedule.row.play_time'), value: hoursAndMinutes(save.playTime) },
			{ label: text('schedule.row.days'), value: formatValue(save.day), edit: day.edit },
			{
				label: text('schedule.row.quests'),
				value: formatValue(save.completedQuests.length),
			}
		);
		return rows;
	}

	protected money(): Row[] {
		const rows: Row[] = [];
		const fields = [
			['OnlineBalance', text('schedule.row.balance'), true],
			['Networth', text('schedule.row.networth'), false],
			['LifetimeEarnings', text('schedule.row.earnings'), false],
		] as const;
		for (const [key, label, safe] of fields) {
			const { value, edit } = this.field('Money.json', key, { safe, minimum: 0 });
			if (value !== undefined) rows.push({ label, value: money(Number(value)), edit });
		}
		const cash = this.cash();
		if (cash) rows.splice(1, 0, cash);
		return rows;
	}

	protected rank(): Row[] {
		const save = readSaveFolder(this.folder);
		const rank = this.field('Rank.json', 'Rank', { minimum: 0, maximum: 10 });
		const tier = this.field('Rank.json', 'Tier', { minimum: 1, maximum: 5 });
		const experience = this.field('Rank.json', 'XP', { minimum: 0 });
		const total = this.field('Rank.json', 'TotalXP', { minimum: 0 });
		if (rank.value === undefined) return [];
		return [
			{ label: text('schedule.row.rank'), value: rankName(save.rank, save.tier), edit: rank.edit },
			{ label: text('schedule.row.tier'), value: formatValue(save.tier), edit: tier.edit },
			{
				label: text('schedule.row.experience'),
				value: formatValue(Number(experience.value)),
				edit: experience.edit,
			},
			{ label: text('schedule.row.total_experience'), value: formatValue(save.experience), edit: total.edit },
		];
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'organisation':
				return this.organisation();
			case 'money':
				return this.money();
			case 'rank':
				return this.rank();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	public contents(): Entry {
		const files = jsonFiles(this.folder).sort();
		return {
			name: basename(this.folder),
			summary: '',
			children: () =>
				files.map(file => {
					try {
						return this.document(file)!.entry(file);
					} catch (error) {
						return { name: file, summary: String(error) };
					}
				}),
		};
	}

	/** Marks the save as last played now, as the game does when it saves, so the archive tells it apart from the save before the changes */
	protected touch(): void {
		const document = this.document('Metadata.json');
		const date = (document?.value as { LastPlayedDate?: Record<string, number> } | undefined)?.LastPlayedDate;
		if (!document || !date) return;
		const now = Temporal.Now.plainDateTimeISO();
		const fields = {
			Year: now.year,
			Month: now.month,
			Day: now.day,
			Hour: now.hour,
			Minute: now.minute,
			Second: now.second,
		};
		for (const [key, value] of Object.entries(fields)) document.edit(date, key)?.set(value);
	}

	public write(path: string): void {
		if (this.documents.values().some(document => document.changed)) this.touch();
		for (const [name, document] of this.documents) {
			if (document.changed) writeFileSync(join(path, name), document.toString());
		}
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: path => /^SaveGame_\d+$/.test(basename(path)) && existsSync(join(path, 'Game.json')),
	open: path => new ScheduleInspection(path),
};
