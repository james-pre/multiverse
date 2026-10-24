import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { copySave } from '../../editing.js';
import { decodeUTF8 } from 'utilium';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { ticksToDateTime } from '../../dotnet.js';
import { text } from '../../i18n.js';
import type { Entry, Inspection, Row } from '../../inspection.js';
import type { Inspector } from '../index.js';
import { difficultyName, diseaseName, diseaseTypeName, humanize, percent } from './names.js';
import {
	decodeValue,
	isFields,
	nested,
	parseFields,
	readSaveFile,
	readSlots,
	type Fields,
	type SaveFile,
	type SlotInfo,
} from './save-file.js';

const sections = {
	disease: { title: text('plague.section.disease.title'), description: text('plague.section.disease.description') },
	world: { title: text('plague.section.world.title'), description: text('plague.section.world.description') },
	countries: {
		title: text('plague.section.countries.title'),
		description: text('plague.section.countries.description'),
	},
};

/** The longest summary of a value in the contents, in characters */
const summaryLength = 200;

const fileNamePattern = /^save_(\d+)\.dat$/;

class PlagueInspection implements Inspection {
	protected readonly file: SaveFile;
	protected readonly slot?: SlotInfo;

	public constructor(protected readonly path: string) {
		this.file = readSaveFile(path);
		const number = Number(fileNamePattern.exec(basename(path))?.[1]);
		this.slot = readSlots(dirname(path)).get(number);
	}

	protected value(fields: Fields, name: string): string {
		return decodeValue(fields[name] ?? '');
	}

	protected number(fields: Fields, name: string): number {
		return Number(this.value(fields, name) || 0);
	}

	protected disease(): Row[] {
		const { disease, world, fields } = this.file;
		const rows: Row[] = [
			{ label: text('plague.row.name'), value: diseaseName(disease, this.slot) },
			{ label: text('plague.row.type'), value: diseaseTypeName(disease, this.slot) },
			{
				label: text('plague.row.difficulty'),
				value: difficultyName(this.number(disease, 'difficulty')),
				edit: this.file.edit(['0', 'difficulty'], { minimum: 0, maximum: 3 }),
			},
			{ label: text('plague.row.mode'), value: this.value(world, 'gameType') || this.slot?.mode || '' },
		];
		if (this.slot?.scenario) rows.push({ label: text('plague.row.scenario'), value: humanize(this.slot.scenario) });
		const start = this.value(world, 'startDate');
		if (/^\d+$/.test(start)) {
			rows.push({
				label: text('plague.row.started'),
				value: shortDate(ticksToDateTime(BigInt(start))),
			});
		}
		const traits = this.value(disease, 'tech').split(',').filter(Boolean);
		rows.push(
			{
				label: text('plague.row.day'),
				value: formatValue(this.number(disease, 'turnNumber')),
				edit: this.file.edit(['0', 'turnNumber'], { minimum: 0 }),
			},
			{ label: text('plague.row.play_time'), value: hoursAndMinutes(Number(fields.gameTime ?? 0)) },
			{
				label: text('plague.row.dna'),
				value: formatValue(this.number(disease, 'evoPoints')),
				edit: this.file.edit(['0', 'evoPoints'], { safe: true, minimum: 0 }),
			},
			{
				label: text('plague.row.traits'),
				value: formatValue(traits.length),
				rows: traits.map(trait => ({ label: humanize(trait) })),
			}
		);
		if (this.number(disease, 'numCheats')) {
			rows.push({ label: text('plague.row.cheats'), value: formatValue(this.number(disease, 'numCheats')) });
		}
		return rows;
	}

	protected world(): Row[] {
		const { disease, world } = this.file;
		const infected = this.number(disease, 'infectedCountryCount');
		const countries = infected + this.number(disease, 'uninfectedCountryCount');
		return [
			{ label: text('plague.row.population'), value: formatValue(this.number(world, 'totalPopulation')) },
			{
				label: text('plague.row.infected'),
				value: formatValue(this.number(disease, 'totalInfected')),
				detail: percent(this.number(disease, 'globalInfectedPercent')),
			},
			{
				label: text('plague.row.dead'),
				value: formatValue(this.number(disease, 'totalDead')),
				detail: percent(this.number(disease, 'globalDeadPercent')),
			},
			{ label: text('plague.row.healthy'), value: formatValue(this.number(disease, 'totalHealthy')) },
			{
				label: text('plague.row.cure'),
				value: percent(this.number(disease, 'cureCompletePercent')),
				edit: this.file.edit(['0', 'cureCompletePercent'], { minimum: 0, maximum: 1 }),
			},
			{
				label: text('plague.row.infected_countries'),
				value: text('plague.row.of', { count: infected, total: countries }),
			},
			{ label: text('plague.row.won'), value: formatValue(this.value(world, 'gameWon') == 'True') },
		];
	}

	protected countries(): Row[] {
		const { fields } = this.file;
		const rows = Object.keys(fields)
			.filter(key => key.startsWith('0/'))
			.map(key => {
				const state = nested(fields, key);
				const country = nested(fields, key.slice(2));
				return {
					infected: this.number(state, 'infectedPercent'),
					row: {
						label: this.value(country, 'name') || humanize(key.slice(2)),
						value: percent(this.number(state, 'infectedPercent')),
						detail: text('plague.row.country_dead', {
							dead: percent(this.number(state, 'deadPercent')),
							population: formatValue(this.number(state, 'originalPopulation')),
						}),
					},
				};
			});
		return rows.sort((a, b) => b.infected - a.infected).map(({ row }) => row);
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'disease':
				return this.disease();
			case 'world':
				return this.world();
			case 'countries':
				return this.countries();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	public contents(): Entry {
		const fields = Object.entries(this.file.fields);
		return {
			name: basename(this.path),
			summary: '',
			children: () => fields.map(([name, value]) => this.fieldEntry(name, value, [name])),
		};
	}

	/** Describes a field, with its fields as children if its value is made of them */
	protected fieldEntry(name: string, value: string, path: string[]): Entry {
		const decoded = decodeValue(value);
		if (!isFields(decoded)) {
			const summary = decoded.length > summaryLength ? decoded.slice(0, summaryLength) + '…' : decoded;
			return { name, summary, edit: this.file.edit(path) };
		}
		const fields = Object.entries(parseFields(decoded));
		return {
			name,
			summary: formatValue(fields.length),
			children: () => fields.map(([field, value]) => this.fieldEntry(field, value, [...path, field])),
		};
	}

	public write(path: string): void {
		this.file.write(path);
	}
}

/** Adds a line to `meta.dat` for a copy of a slot, which is how the game lists it */
function copySlotInfo(directory: string, from: number, to: number): void {
	const path = join(directory, 'meta.dat');
	if (!existsSync(path)) return;
	const lines = readFileSync(path, 'utf8').split('\n');
	const line = lines.find(line => line.startsWith(`${from}:`));
	if (!line) return;
	const last = lines.findLastIndex(line => line.trim());
	lines.splice(last + 1, 0, `${to}:${line.slice(`${from}:`.length)}`);
	writeFileSync(path, lines.join('\n'));
}

export const inspector: Inspector = {
	sections,
	recognizes(path) {
		if (!/^save_\d+\.dat$/.test(basename(path))) return false;
		let fd: number | undefined;
		try {
			fd = openSync(path, 'r');
			const start = new Uint8Array(64);
			readSync(fd, start);
			// Saves start with a run of literal text, which is their version.
			const text = decodeUTF8(Uint8Array.fromBase64(decodeUTF8(start)));
			return text.charCodeAt(0) < 32 && text.slice(1).startsWith('version:');
		} catch {
			return false;
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	},
	open: path => new PlagueInspection(path),
	copy(path) {
		const directory = dirname(path);
		const from = Number(fileNamePattern.exec(basename(path))?.[1]);
		const numbers = readdirSync(directory).map(name => Number(fileNamePattern.exec(name)?.[1] ?? 0));
		const to = Math.max(0, ...numbers) + 1;
		const target = join(directory, `save_${to}.dat`);
		copySave(path, target, [join(directory, `save_${from}.png`)]);
		copySlotInfo(directory, from, to);
		return target;
	},
};
