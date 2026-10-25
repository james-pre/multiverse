import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { copySave, type Edit, type EditOptions } from '../../editing.js';
import { dateTimeToTicks, ticksToDateTime } from '../../dotnet.js';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import { rangeEntries, type Entry, type Inspection, type Row } from '../../inspection.js';
import { JsonDocument } from '../../json.js';
import { fieldEdit, messageEntries, numberOf } from '../../protobuf.js';
import type { Inspector } from '../index.js';
import { ObjectFile, SceneFile, type Component, type GameObject } from './objects.js';
import { freeSlot, modeName, modes } from './slots.js';

const sections = {
	game: { title: text('subnautica.section.game.title'), description: text('subnautica.section.game.description') },
	player: {
		title: text('subnautica.section.player.title'),
		description: text('subnautica.section.player.description'),
	},
	world: { title: text('subnautica.section.world.title'), description: text('subnautica.section.world.description') },
};

/** Names of the fields of components, from their `ProtoMember` attributes */
const fieldNames: Record<string, Record<number, string>> = {
	Survival: { 1: 'version', 2: 'food', 3: 'water', 4: 'stomach' },
	LiveMixin: { 1: 'health', 3: 'tempDamage' },
	Oxygen: { 1: 'oxygenAvailable' },
	NitrogenLevel: { 1: 'nitrogenLevel' },
	InfectedMixin: { 1: 'infectedAmount', 2: 'version' },
	DayNightCycle: { 1: 'version', 2: 'timePassedDeprecated', 3: 'timePassedAsDouble' },
	Inventory: {
		1: 'version',
		2: 'serializedStorage',
		3: 'serializedQuickSlots',
		4: 'serializedEquipment',
		5: 'serializedEquipmentSlots',
		6: 'serializedPendingItems',
	},
	Player: {
		1: 'version',
		2: 'serializedIsUnderwater',
		3: 'serializedDepthClass',
		4: 'serializedEscapePod',
		5: 'knownTech',
		6: 'currentSubUID',
		7: 'journal',
		8: 'encyclopedia',
		9: 'scanner',
		10: 'currentWaterParkUID',
		11: 'usedTools',
		12: 'precursorOutOfWater',
		13: 'analyzedTech',
		14: 'isSick',
		15: 'notifications',
		16: '_displaySurfaceWater',
		17: 'timeLastSleep',
		18: 'infectionRevealed',
		19: 'timeCapsules',
		20: 'hasUsedConsole',
		21: 'rotationX',
		22: 'rotationY',
		23: 'suffocationState',
		24: 'suffocationProgress',
		25: 'lastValidSubUID',
		26: 'pins',
	},
};

/** In-game seconds in a day */
const dayLength = 1200;

/** Components whose count shows what has been built, by the name the overview gives them */
const builtComponents: Record<string, string> = {
	BaseRoot: 'bases',
	Constructable: 'constructed',
	Beacon: 'beacons',
	StorageContainer: 'storage',
	PowerSource: 'power',
	WaterParkCreature: 'creatures',
	GrownPlant: 'plants',
};

/** A slot's `gameinfo.json` */
interface GameInfo {
	gameTime: number;
	dateTicks: bigint;
	startTicks: bigint;
	changeSet: number;
	gameMode: number;
}

class SubnauticaInspection implements Inspection {
	protected readonly info: JsonDocument;
	/** The byte order mark `gameinfo.json` starts with, which is written back */
	protected readonly bom: string;
	protected sceneFile?: SceneFile;
	protected globalFile?: ObjectFile;

	public constructor(protected readonly folder: string) {
		const path = join(folder, 'gameinfo.json');
		if (!existsSync(path)) throw new Error('Not a Subnautica save');
		const json = readFileSync(path, 'utf8');
		this.bom = json.startsWith('\uFEFF') ? '\uFEFF' : '';
		this.info = new JsonDocument(json.slice(this.bom.length));
	}

	protected get gameInfo(): GameInfo {
		return this.info.value as GameInfo;
	}

	protected get scene(): SceneFile {
		this.sceneFile ??= new SceneFile(join(this.folder, 'scene-objects.bin'));
		return this.sceneFile;
	}

	protected get global(): ObjectFile {
		this.globalFile ??= new ObjectFile(join(this.folder, 'global-objects.bin'));
		return this.globalFile;
	}

	/** A field of a component, with an edit for it */
	protected field(
		file: ObjectFile,
		component: Component | undefined,
		name: string,
		options?: EditOptions
	): { value?: number; edit?: Edit } {
		if (!component) return {};
		const number = Number(Object.entries(fieldNames[component.type]).find(([, field]) => field == name)?.[0]);
		const field = file.fields(component).findLast(field => field.number == number);
		return field ? { value: numberOf(field), edit: fieldEdit(field, options) } : {};
	}

	protected game(): Row[] {
		const info = this.gameInfo;
		const rows: Row[] = [
			{
				label: text('subnautica.row.mode'),
				value: modeName(info.gameMode),
				edit: this.info.edit(this.gameInfo, 'gameMode', {
					safe: true,
					choices: Object.values(modes).map(mode => ({ value: mode, label: modeName(mode) })),
				}),
			},
			{ label: text('subnautica.row.play_time'), value: hoursAndMinutes(info.gameTime) },
			{ label: text('subnautica.row.started'), value: shortDate(ticksToDateTime(BigInt(info.startTicks))) },
			{ label: text('subnautica.row.saved'), value: shortDate(ticksToDateTime(BigInt(info.dateTicks))) },
		];
		const cycle = this.scene.find('DayNightCycle');
		const time = this.field(this.scene, cycle?.component, 'timePassedAsDouble', { minimum: 0 });
		if (time.value !== undefined) {
			rows.push({
				label: text('subnautica.row.day'),
				value: formatValue(Math.floor(time.value / dayLength) + 1),
				detail: text('subnautica.row.seconds', { seconds: Math.round(time.value) }),
				edit: time.edit,
			});
		}
		rows.push({ label: text('subnautica.row.build'), value: String(info.changeSet) });
		return rows;
	}

	protected player(): Row[] {
		const found = this.scene.find('Player');
		if (!found) return [];
		const { object } = found;
		const component = (type: string) => this.scene.component(object, type);
		const rows: Row[] = [];
		const add = (
			label: string,
			type: string,
			name: string,
			options: EditOptions,
			format: (value: number) => string = value => formatValue(Math.round(value))
		) => {
			const { value, edit } = this.field(this.scene, component(type), name, options);
			if (value !== undefined) rows.push({ label, value: format(value), edit });
		};
		add(text('subnautica.row.health'), 'LiveMixin', 'health', { safe: true, minimum: 0, maximum: 100 });
		add(text('subnautica.row.food'), 'Survival', 'food', { safe: true, minimum: 0, maximum: 200 });
		add(text('subnautica.row.water'), 'Survival', 'water', { safe: true, minimum: 0, maximum: 100 });
		add(text('subnautica.row.oxygen'), 'Oxygen', 'oxygenAvailable', { minimum: 0 });
		add(text('subnautica.row.infection'), 'InfectedMixin', 'infectedAmount', { minimum: 0, maximum: 1 }, value =>
			value.toLocaleString(undefined, { style: 'percent' })
		);

		const player = component('Player');
		if (player) {
			const fields = this.scene.fields(player);
			const count = (name: string) => {
				const number = Number(Object.entries(fieldNames.Player).find(([, field]) => field == name)?.[0]);
				return fields.filter(field => field.number == number).length;
			};
			rows.push(
				{ label: text('subnautica.row.blueprints'), value: formatValue(count('knownTech')) },
				{ label: text('subnautica.row.scanned'), value: formatValue(count('analyzedTech')) },
				{ label: text('subnautica.row.journal'), value: formatValue(count('journal')) },
				{ label: text('subnautica.row.encyclopedia'), value: formatValue(count('encyclopedia')) }
			);
		}
		return rows;
	}

	protected world(): Row[] {
		const counts = new Map<string, number>();
		for (const object of this.global.objects) {
			for (const { type } of object.components) counts.set(type, (counts.get(type) ?? 0) + 1);
		}
		const rows: Row[] = [{ label: text('subnautica.row.objects'), value: formatValue(this.global.objects.length) }];
		for (const [type, name] of Object.entries(builtComponents)) {
			const count = counts.get(type);
			if (count) rows.push({ label: text(`subnautica.built.${name}`), value: formatValue(count) });
		}
		return rows;
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'game':
				return this.game();
			case 'player':
				return this.player();
			case 'world':
				return this.world();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	protected objectEntry(file: ObjectFile, object: GameObject): Entry {
		return {
			name: object.sceneName ?? object.id,
			summary: object.components
				.map(component => component.type)
				.filter(type => type != 'UnityEngine.Transform')
				.join(', '),
			children: () => [
				{ name: 'id', summary: object.id },
				...(object.classId ? [{ name: 'classId', summary: object.classId }] : []),
				...(object.parent ? [{ name: 'parent', summary: object.parent }] : []),
				...object.components.map(component => ({
					name: component.type,
					summary: component.isEnabled ? '' : 'disabled',
					children: () => messageEntries(file.data, component.start, component.end, fieldNames[component.type]),
				})),
			],
		};
	}

	protected fileEntry(name: string, file: () => ObjectFile): Entry {
		return {
			name,
			summary: '',
			children: () => {
				const { objects } = file();
				return rangeEntries(objects.length, i => this.objectEntry(file(), objects[i]));
			},
		};
	}

	public contents(): Entry {
		return {
			name: basename(this.folder),
			summary: '',
			children: () => [
				this.info.entry('gameinfo.json'),
				this.fileEntry('scene-objects.bin', () => this.scene),
				this.fileEntry('global-objects.bin', () => this.global),
			],
		};
	}

	/** Marks the save as saved now, as the game does, so the archive tells it apart from the save before the changes */
	protected touch(): void {
		const now = dateTimeToTicks(Temporal.Now.plainDateTimeISO());
		this.info.edit(this.gameInfo, 'dateTicks')?.set(now);
	}

	public write(path: string): void {
		this.touch();
		writeFileSync(join(path, 'gameinfo.json'), this.bom + this.info.toString());
		if (this.sceneFile) writeFileSync(join(path, 'scene-objects.bin'), this.sceneFile.data);
		if (this.globalFile) writeFileSync(join(path, 'global-objects.bin'), this.globalFile.data);
	}
}

export const inspector: Inspector = {
	sections,
	recognizes: path =>
		existsSync(path) && statSync(path).isDirectory() && existsSync(join(path, 'scene-objects.bin')),
	open: path => new SubnauticaInspection(path),
	copy(path) {
		const target = join(dirname(path), freeSlot(dirname(path)));
		copySave(path, target);
		return target;
	},
};
