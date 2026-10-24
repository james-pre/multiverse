import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { decodeUTF8 } from 'utilium';
import { bytes } from 'utilium/format';
import { checkEditValue, copySave, namedChoices, propertyEdit, type Edit, type NumberType } from '../../editing.js';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import { rangeEntries, valueEntry, type Entry, type Inspection, type Row } from '../../inspection.js';
import { Splice } from '../../splice.js';
import type { Inspector } from '../index.js';
import { ChangeFormType } from './change-forms.js';
import { formatString } from './format.js';
import type { GlobalData } from './global-data.js';
import { GlobalDataType, getGlobal, tableEntries } from './global-data.js';
import { StatCategory } from './globals/misc-stats.js';
import { CrimeType } from './globals/process-lists.js';
import { PlayerForm, playerBaseId, races } from './player-form.js';
import { RefIDType } from './ref-id.js';
import { SaveFile } from './save-file.js';
import { fileTimeToInstant, parsePlayTime, raceName } from './strings.js';
import { CompressionType, PlayerSex, SaveBody } from './structs.js';

/** Header fields that can be changed, with their types */
const headerFields: Record<string, NumberType> = {
	saveNumber: 'u32',
	playerLevel: 'u32',
	playerCurExp: 'f32',
	playerLvlUpExp: 'f32',
};

/** How many offsets the file location table starts with, which are measured from the start of the file */
const locationTableOffsets = 6;

/** Save file names, which start with the kind of save and its number, like `Save38_` */
const fileNamePattern = /^([A-Za-z]+)(\d+)_(.*)$/;

const sections = {
	character: {
		title: text('skyrim.section.character.title'),
		description: text('skyrim.section.character.description'),
	},
	stats: { title: text('skyrim.section.stats.title'), description: text('skyrim.section.stats.description') },
	crimes: { title: text('skyrim.section.crimes.title'), description: text('skyrim.section.crimes.description') },
	plugins: { title: text('skyrim.section.plugins.title'), description: text('skyrim.section.plugins.description') },
	file: { title: text('skyrim.section.file.title'), description: text('skyrim.section.file.description') },
};

class SkyrimInspection implements Inspection {
	protected readonly file: SaveFile;
	protected parsed?: SaveBody;
	/** The player's change form, or null if the save has none this can read */
	protected playerForm?: PlayerForm | null;
	/** The decompressed body, which changes to it are made in */
	protected bodyData?: Uint8Array;

	public constructor(protected readonly path: string) {
		this.file = new SaveFile(path);
	}

	protected get body(): SaveBody {
		if (this.parsed) return this.parsed;
		this.bodyData = this.file.body();
		this.parsed = new SaveBody(this.bodyData.buffer, this.bodyData.byteOffset, this.bodyData.byteLength);
		return this.parsed;
	}

	protected headerEdit(field: string): Edit | undefined {
		const type = headerFields[field];
		return (
			type
			&& propertyEdit(() => this.file.header, field, { type, minimum: field == 'playerLevel' ? 1 : undefined })
		);
	}

	/** The player's change form, which has the name, race and sex the game uses */
	protected player(): PlayerForm | undefined {
		if (this.playerForm !== undefined) return this.playerForm ?? undefined;
		const { body } = this;
		const form = Array.from(body.changeForms).find(
			form =>
				form.formType == ChangeFormType.NPC_
				&& form.formID.type == RefIDType.Default
				&& form.formID.formID == playerBaseId
		);
		try {
			this.playerForm = form ? new PlayerForm(form, body.byteOffset) : null;
		} catch {
			this.playerForm = null;
		}
		return this.playerForm ?? undefined;
	}

	/** The player's name, changing it in the header and the player's change form */
	protected nameEdit(): Edit | undefined {
		const player = this.player();
		if (!player) return;
		const edit: Edit = {
			get value() {
				return player.name ?? '';
			},
			set: value => {
				const name = String(checkEditValue(edit, value)).trim();
				if (!name) throw new RangeError(text('skyrim.empty_name'));
				this.file.setHeaderString('playerName', name);
				player.name = name;
			},
		};
		return player.name === undefined ? undefined : edit;
	}

	/** The player's race, changing it in the header and the player's change form */
	protected raceEdit(): Edit | undefined {
		const player = this.player();
		if (!player) return;
		const edit: Edit = {
			choices: namedChoices(Object.keys(races), raceName),
			get value() {
				return Object.keys(races).find(race => races[race] == player.race) ?? '';
			},
			set: value => {
				const race = String(checkEditValue(edit, value));
				this.file.setHeaderString('playerRaceEditorId', race);
				player.race = races[race];
			},
		};
		return edit;
	}

	/** The player's sex, changing it in the header and the player's change form */
	protected sexEdit(): Edit | undefined {
		const player = this.player();
		if (!player) return;
		const edit: Edit = {
			choices: namedChoices(['Male', 'Female'], sex => text(`skyrim.sex.${sex}`)),
			get value() {
				return PlayerSex[player.gender ?? PlayerSex.Male];
			},
			set: value => {
				const sex = PlayerSex[String(checkEditValue(edit, value)) as keyof typeof PlayerSex];
				this.file.header.playerSex = sex;
				player.gender = sex;
			},
		};
		return edit;
	}

	protected character(): Row[] {
		const { header } = this.file;
		const sex = PlayerSex[header.playerSex];
		return [
			{ label: text('skyrim.row.name'), value: formatString(header.playerName), edit: this.nameEdit() },
			{
				label: text('skyrim.row.level'),
				value: formatValue(header.playerLevel),
				edit: this.headerEdit('playerLevel'),
				detail: text('skyrim.row.experience', {
					current: Math.round(header.playerCurExp),
					next: Math.round(header.playerLvlUpExp),
				}),
			},
			{
				label: text('skyrim.row.race'),
				value: raceName(formatString(header.playerRaceEditorId)),
				edit: this.raceEdit(),
			},
			{
				label: text('skyrim.row.sex'),
				value: text(`skyrim.sex.${sex}`, { $default: sex }),
				edit: this.sexEdit(),
			},
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
				rows: stats.map(stat => ({
					label: stat.name.toString(),
					value: formatValue(stat.value),
					edit: propertyEdit(stat, 'value', { type: 'i32' }),
				})),
			}));
	}

	protected crimes(): Row[] {
		const data = [...this.body.globalDataTable2].find(global => global.type == GlobalDataType.ProcessLists);
		const lists = data && getGlobal(data as GlobalData & { type: GlobalDataType.ProcessLists });
		if (!lists) return [];
		return Array.from(lists.allCrimes, ({ crimes }, type): Row | undefined => {
			if (!crimes.length) return;
			const name = CrimeType[type] ?? String(type);
			return {
				label: text(`skyrim.crime.${name}`, { $default: name }),
				value: formatValue(crimes.length),
				rows: Array.from(crimes, crime => ({
					label: crime.victimID.formID ? crime.victimID.pretty() : `#${crime.serialNum}`,
					value: text('skyrim.row.bounty_value', { bounty: crime.bounty }),
					detail: crime.isCleared ? text('skyrim.row.cleared') : undefined,
					rows: [
						{
							label: text('skyrim.row.bounty'),
							value: formatValue(crime.bounty),
							edit: propertyEdit(crime, 'bounty', { type: 'u32' }),
						},
						{
							label: text('skyrim.row.cleared'),
							value: formatValue(crime.isCleared != 0),
							edit: propertyEdit(crime, 'isCleared', { type: 'bool' }),
						},
						{
							label: text('skyrim.row.witnesses'),
							value: formatValue(crime.witnessNum),
							edit: propertyEdit(crime, 'witnessNum', { type: 'u32' }),
						},
					],
				})),
			};
		}).filter(row => row !== undefined);
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
			case 'crimes':
				return this.crimes();
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
		const header = this.header();
		return {
			name: basename(this.path),
			summary: '',
			children: () => [
				valueEntry('header', header, {
					edit: (container, key) => (container === header ? this.headerEdit(String(key)) : undefined),
				}),
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

	public write(path: string): void {
		const data = this.bodyData ?? this.file.body();
		const fileOffsets: number[] = [];
		if (this.parsed) {
			const table = this.parsed.fileLocationTable.byteOffset - this.parsed.byteOffset;
			for (let i = 0; i < locationTableOffsets; i++) fileOffsets.push(table + i * 4);
		}
		if (!this.playerForm?.isChanged) return this.file.write(path, data, fileOffsets);

		const splice = new Splice();
		splice.replace(this.playerForm.position, this.playerForm.size, this.playerForm.write());
		const origin = -this.file.bodyStart;
		this.file.write(
			path,
			splice.apply(
				data,
				fileOffsets.map(at => ({ at, origin }))
			),
			fileOffsets
		);
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

	copy(path) {
		const directory = dirname(path);
		const name = basename(path);
		const match = fileNamePattern.exec(name);
		if (!match) throw new Error(`Can not tell what to call a copy of ${name}`);
		const numbers = readdirSync(directory).map(file => Number(/^Save(\d+)_/.exec(file)?.[1] ?? 0));
		const target = join(directory, `Save${Math.max(0, ...numbers) + 1}_${match[3]}`);
		copySave(path, target, [path.replace(/\.ess$/i, '.skse')]);
		return target;
	},
};
