import { closeSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import { decodeUTF8 } from 'utilium';
import { bytes } from 'utilium/format';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import { rangeEntries, valueEntry, type Entry, type Inspection, type Row } from '../../inspection.js';
import type { Inspector } from '../index.js';
import { formatString } from './format.js';
import type { GlobalData } from './global-data.js';
import { GlobalDataType, getGlobal, tableEntries } from './global-data.js';
import { StatCategory } from './globals/misc-stats.js';
import { SaveFile } from './save-file.js';
import { fileTimeToInstant, parsePlayTime, raceName } from './strings.js';
import { CompressionType, PlayerSex, type SaveBody } from './structs.js';

const sections = {
	character: {
		title: text('skyrim.section.character.title'),
		description: text('skyrim.section.character.description'),
	},
	stats: { title: text('skyrim.section.stats.title'), description: text('skyrim.section.stats.description') },
	plugins: { title: text('skyrim.section.plugins.title'), description: text('skyrim.section.plugins.description') },
	file: { title: text('skyrim.section.file.title'), description: text('skyrim.section.file.description') },
};

class SkyrimInspection implements Inspection {
	protected readonly file: SaveFile;
	protected parsed?: SaveBody;

	public constructor(protected readonly path: string) {
		this.file = new SaveFile(path);
	}

	protected get body(): SaveBody {
		this.parsed ??= this.file.parseBody();
		return this.parsed;
	}

	protected character(): Row[] {
		const { header } = this.file;
		const sex = PlayerSex[header.playerSex];
		return [
			{ label: text('skyrim.row.name'), value: formatString(header.playerName) },
			{
				label: text('skyrim.row.level'),
				value: formatValue(header.playerLevel),
				detail: text('skyrim.row.experience', {
					current: Math.round(header.playerCurExp),
					next: Math.round(header.playerLvlUpExp),
				}),
			},
			{ label: text('skyrim.row.race'), value: raceName(formatString(header.playerRaceEditorId)) },
			{ label: text('skyrim.row.sex'), value: text(`skyrim.sex.${sex}`, { $default: sex }) },
			{ label: text('skyrim.row.location'), value: formatString(header.playerLocation) },
			{
				label: text('skyrim.row.play_time'),
				value: hoursAndMinutes(parsePlayTime(formatString(header.gameDate))),
			},
			{
				label: text('skyrim.row.saved'),
				value: shortDate(fileTimeToInstant(header.filetime).toZonedDateTimeISO(Temporal.Now.timeZoneId())),
			},
			{ label: text('skyrim.row.save_number'), value: formatValue(header.saveNumber) },
		];
	}

	protected stats(): Row[] {
		const data = Array.from(this.body.globalDataTable1).find(global => global.type == GlobalDataType.MiscStats);
		const stats = data && getGlobal(data as GlobalData & { type: GlobalDataType.MiscStats });
		if (!stats) return [];
		const groups = Map.groupBy(Array.from(stats.stats), stat => stat.category);
		return [...groups]
			.sort(([a], [b]) => a - b)
			.map(([category, stats]) => ({
				label: text(`skyrim.stat_category.${StatCategory[category]}`, {
					$default: StatCategory[category] ?? String(category),
				}),
				rows: stats.map(stat => ({ label: stat.name.toString(), value: formatValue(stat.value) })),
			}));
	}

	protected plugins(): Row[] {
		const { pluginInfo, lightPluginInfo } = this.body;
		const rows: Row[] = Array.from(pluginInfo.plugins, (plugin, i) => ({
			label: formatString(plugin),
			detail: i.toString(16).toUpperCase().padStart(2, '0'),
		}));
		if (lightPluginInfo.pluginCount) {
			rows.push({
				label: text('skyrim.row.light_plugins'),
				value: formatValue(lightPluginInfo.pluginCount),
				rows: Array.from(lightPluginInfo.plugins, (plugin, i) => ({
					label: formatString(plugin),
					detail: `FE:${i.toString(16).toUpperCase().padStart(3, '0')}`,
				})),
			});
		}
		return rows;
	}

	protected fileRows(): Row[] {
		const { header, bodySize } = this.file;
		const { body } = this;
		const types = Object.groupBy(body.changeForms, form => form.summary(body.formVersion));
		return [
			{ label: text('skyrim.row.version'), value: String(header.version) },
			{ label: text('skyrim.row.form_version'), value: String(body.formVersion) },
			{ label: text('skyrim.row.compression'), value: CompressionType[header.compressionType] },
			{ label: text('skyrim.row.data_size'), value: bytes(bodySize) },
			{ label: text('skyrim.row.screenshot'), value: `${header.shotWidth} × ${header.shotHeight}` },
			{
				label: text('skyrim.row.change_forms'),
				value: formatValue(body.changeForms.length),
				rows: Object.entries(types)
					.map(([type, forms = []]) => ({ label: type, value: formatValue(forms.length) }))
					.sort((a, b) => a.label.localeCompare(b.label)),
			},
		];
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'character':
				return this.character();
			case 'stats':
				return this.stats();
			case 'plugins':
				return this.plugins();
			case 'file':
				return this.fileRows();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	protected header(): Record<string, unknown> {
		const { header } = this.file;
		return {
			version: header.version,
			saveNumber: header.saveNumber,
			playerName: formatString(header.playerName),
			playerLevel: header.playerLevel,
			playerLocation: formatString(header.playerLocation),
			gameDate: formatString(header.gameDate),
			playerRaceEditorId: formatString(header.playerRaceEditorId),
			playerSex: PlayerSex[header.playerSex],
			playerCurExp: header.playerCurExp,
			playerLvlUpExp: header.playerLvlUpExp,
			filetime: fileTimeToInstant(header.filetime).toString(),
			shotWidth: header.shotWidth,
			shotHeight: header.shotHeight,
			compressionType: CompressionType[header.compressionType],
		};
	}

	public contents(): Entry {
		const { body } = this;
		const table = body.fileLocationTable;
		const locations = Object.fromEntries(
			Object.keys(table)
				.filter(key => key != 'unused')
				.map(key => [key, table[key as keyof typeof table]])
		);
		const forms = Array.from(body.changeForms);
		const globals = [body.globalDataTable1, body.globalDataTable2, body.globalDataTable3];
		return {
			name: basename(this.path),
			summary: '',
			children: () => [
				valueEntry('header', this.header()),
				valueEntry('plugins', Array.from(body.pluginInfo.plugins, formatString)),
				valueEntry('light plugins', Array.from(body.lightPluginInfo.plugins, formatString)),
				valueEntry('file location table', locations),
				...globals.map((table, i) => ({
					name: `global data table ${i + 1}`,
					summary: formatValue(table.length),
					children: () => tableEntries(table),
				})),
				{
					name: 'change forms',
					summary: formatValue(forms.length),
					children: () =>
						rangeEntries(forms.length, i => ({ name: String(i), summary: forms[i].toString() })),
				},
			],
		};
	}
}

export const inspector: Inspector = {
	sections,

	recognizes(path) {
		let fd: number | undefined;
		try {
			fd = openSync(path, 'r');
			const start = new Uint8Array(13);
			readSync(fd, start, 0, start.length, 0);
			return decodeUTF8(start) == 'TESV_SAVEGAME';
		} catch {
			return false;
		} finally {
			if (fd !== undefined) closeSync(fd);
		}
	},

	open: path => new SkyrimInspection(path),

	decompress(path) {
		return new SaveFile(path).body();
	},
};
