import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { bytes } from 'utilium/format';
import { binaryEdit, copySave, linkedEdit, namedChoices, type Edit } from '../../editing.js';
import { formatValue, hoursAndMinutes, shortDate } from '../../format.js';
import { text } from '../../i18n.js';
import { rangeEntries, valueEntry, type Entry, type Inspection, type Row } from '../../inspection.js';
import { JsonDocument } from '../../json.js';
import type { Inspector } from '../index.js';
import * as slots from './slots.js';
import { factHash, readFacts } from './facts.js';
import { describeObjective, findMetadata, lifePathName, Metadata, parseTimestamp } from './metadata.js';
import { isInstance, typeName, type Instance, type Package } from './package.js';
import { SaveFile, type SaveNode } from './save-file.js';

const sections = {
	character: {
		title: text('cyberpunk.section.character.title'),
		description: text('cyberpunk.section.character.description'),
	},
	perks: { title: text('cyberpunk.section.perks.title'), description: text('cyberpunk.section.perks.description') },
	story: { title: text('cyberpunk.section.story.title'), description: text('cyberpunk.section.story.description') },
	save: { title: text('cyberpunk.section.save.title'), description: text('cyberpunk.section.save.description') },
};

/** The attributes in the metadata, by the names the game shows */
const attributes = ['strength', 'reflexes', 'technicalAbility', 'intelligence', 'cool'];

interface Attribute extends Instance {
	attributeName?: string;
	value?: number;
}

interface Proficiency extends Instance {
	type?: string;
	currentLevel?: number;
	currentExp?: number;
}

interface DevelopmentPoints extends Instance {
	type?: string;
	unspent?: number;
}

interface AttributeData extends Instance {
	type?: string;
	unlockedPerks?: { type?: string; currLevel?: number }[];
}

/** The parts of `PlayerDevelopmentData` the inspector shows */
interface Development extends Instance {
	attributes?: Attribute[];
	proficiencies?: Proficiency[];
	devPoints?: DevelopmentPoints[];
	attributesData?: AttributeData[];
}

const difficulties = ['Story', 'Easy', 'Hard', 'VeryHard'];

const skills = ['StrengthSkill','ReflexesSkill', 'TechnicalAbilitySkill', 'IntelligenceSkill', 'CoolSkill'];

/** A name from the game's data, localized when there is a translation */
function gameName(group: string, name: string): string {
	return text(`cyberpunk.${group}.${name}`, { $default: name.replaceAll('_', ' ') });
}

function packageEntry(name: string, value: unknown, container: Package): Entry {
	return valueEntry(name, value, {
		typeOf: value => (isInstance(value) ? value[typeName] : undefined),
		edit: (object, key) => container.locations.edit(object, key),
	});
}

/** The development data's names for the attributes in the metadata */
const attributeNames: Record<string, string> = {
	strength: 'Strength',
	reflexes: 'Reflexes',
	technicalAbility: 'TechnicalAbility',
	intelligence: 'Intelligence',
	cool: 'Cool',
};

class CyberpunkInspection implements Inspection {
	protected readonly directory: string;
	protected readonly path: string;
	/** The newest metadata file, which the game shows before loading the save */
	protected readonly metadataPath?: string;
	protected readonly document?: JsonDocument;
	protected file?: SaveFile;
	protected development?: { data: Development; package: Package } | null;

	public constructor(path: string) {
		this.directory = statSync(path).isDirectory() ? path : dirname(path);
		this.path = join(this.directory, 'sav.dat');
		this.metadataPath = findMetadata(this.directory);
		if (this.metadataPath) this.document = new JsonDocument(readFileSync(this.metadataPath, 'utf8'));
	}

	protected get metadata(): { metadata: Metadata } | undefined {
		return this.document && { metadata: Metadata.parse(this.document.value).Data.metadata };
	}

	protected get save(): SaveFile {
		this.file ??= new SaveFile(this.path);
		return this.file;
	}

	protected get raw(): Record<string, unknown> {
		return (this.document?.value as { Data?: { metadata?: Record<string, unknown> } })?.Data?.metadata ?? {};
	}

	/** The player's level, attributes, skills and perks, from the scriptable systems */
	protected playerDevelopment(): { data: Development; package: Package } | undefined {
		if (this.development !== undefined) return this.development ?? undefined;
		const node = this.save.find('ScriptableSystemsContainer');
		const found = node && this.save.package(node);
		const data = found?.objects.find(object => object[typeName] == 'PlayerDevelopmentData') as Development;
		this.development = found && data ? { data, package: found } : null;
		return this.development ?? undefined;
	}

	/** An attribute's level, changing it in the save and in the metadata */
	protected attributeEdit(attribute: string): Edit | undefined {
		const development = this.playerDevelopment();
		const data = development?.data.attributes?.find(data => data.attributeName == attributeNames[attribute]);
		const main = data && development!.package.locations.edit(data, 'value', { minimum: 1, maximum: 20 });
		return main && linkedEdit(main, [this.document?.edit(this.raw, attribute)]);
	}

	protected character(): Row[] {
		const { metadata } = this.metadata ?? {};
		const development = this.playerDevelopment();
		const rows: Row[] = [];
		if (metadata) {
			rows.push(
				{ label: text('cyberpunk.row.life_path'), value: lifePathName(metadata.lifePath) },
				{ label: text('cyberpunk.row.body'), value: String(this.raw.bodyGender) },
				{ label: text('cyberpunk.row.voice'), value: String(this.raw.brainGender) },
				{ label: text('cyberpunk.row.level'), value: formatValue(metadata.level) },
				{ label: text('cyberpunk.row.street_cred'), value: formatValue(metadata.streetCred) },
				{
					label: text('cyberpunk.row.attributes'),
					rows: attributes.map(attribute => ({
						label: gameName('attribute', attribute),
						value: formatValue(Number(this.raw[attribute] ?? 0)),
						edit: this.attributeEdit(attribute),
					})),
				}
			);
		}
		if (!development) return rows;
		const { data, package: container } = development;

		const proficiencies = data.proficiencies ?? [];
		rows.push({
			label: text('cyberpunk.row.skills'),
			rows: skills.map(skill => {
				const proficiency = proficiencies.find(proficiency => proficiency.type == skill);
				return {
					label: gameName('skill', skill),
					value: formatValue(proficiency?.currentLevel ?? 1),
					edit:
						proficiency
						&& container.locations.edit(proficiency, 'currentLevel', { minimum: 1, maximum: 60 }),
					detail: proficiency?.currentExp
						? text('cyberpunk.row.experience', { experience: proficiency.currentExp })
						: undefined,
				};
			}),
		});

		const points = (label: string, type: string): Row => {
			const found = data.devPoints?.find(points => (points.type ?? 'Attribute') == type);
			return {
				label,
				value: formatValue(found?.unspent ?? 0),
				edit: found && container.fieldEdit(found, 'unspent', 'Int32', { safe: true, minimum: 0, maximum: 999 }),
			};
		};
		rows.push({
			label: text('cyberpunk.row.unspent'),
			rows: [
				points(text('cyberpunk.row.attribute_points'), 'Attribute'),
				points(text('cyberpunk.row.perk_points'), 'Primary'),
				points(text('cyberpunk.row.relic_points'), 'Espionage'),
			],
		});
		return rows;
	}

	protected perks(): Row[] {
		const rows: Row[] = [];
		const development = this.playerDevelopment();
		for (const data of development?.data.attributesData ?? []) {
			if (!data.type) continue;
			const unlocked = (data.unlockedPerks ?? []).filter(perk => perk.type && (perk.currLevel ?? 0) > 0);
			if (!unlocked.length) continue;
			rows.push({
				label: gameName('attribute', data.type.replace(/AttributeData$/, '')),
				value: formatValue(unlocked.length),
				rows: unlocked.map(perk => ({
					label: gameName('perk', perk.type!),
					value: text('cyberpunk.row.perk_level', { level: perk.currLevel! }),
					edit: development!.package.locations.edit(perk, 'currLevel', { minimum: 0, maximum: 3 }),
				})),
			});
		}
		return rows;
	}

	protected story(): Row[] {
		const { metadata } = this.metadata ?? {};
		if (!metadata) return [];
		const quests = metadata.finishedQuests.split(/\s+/).filter(Boolean);
		const facts = Array.isArray(this.raw.facts) ? (this.raw.facts as string[]) : [];
		const expansions = Array.isArray(this.raw.additionalContentIds)
			? (this.raw.additionalContentIds as string[])
			: [];
		const rows: Row[] = [];
		const objective = describeObjective(metadata.trackedQuestEntry);
		if (objective) rows.push({ label: text('cyberpunk.row.objective'), value: objective });
		rows.push({
			label: text('cyberpunk.row.finished_quests'),
			value: formatValue(quests.length),
			rows: quests.map(quest => ({ label: quest })),
		});
		if (facts.length) {
			rows.push({
				label: text('cyberpunk.row.choices'),
				value: formatValue(facts.length),
				rows: facts.map(fact => {
					const [name, value] = fact.split('=');
					return { label: name, value };
				}),
			});
		}
		if (expansions.length) {
			rows.push({
				label: text('cyberpunk.row.expansions'),
				value: expansions.map(expansion => gameName('expansion', expansion)).join(', '),
			});
		}
		return rows;
	}

	protected saveRows(): Row[] {
		const { metadata } = this.metadata ?? {};
		const { header } = this.save;
		const rows: Row[] = [];
		if (metadata) {
			rows.push(
				{ label: text('cyberpunk.row.slot'), value: metadata.name },
				{ label: text('cyberpunk.row.play_time'), value: hoursAndMinutes(metadata.playthroughTime) },
				{ label: text('cyberpunk.row.save_date'), value: shortDate(parseTimestamp(metadata.timestampString)) },
				{
					label: text('cyberpunk.row.difficulty'),
					value: gameName('difficulty', metadata.difficulty),
					edit: this.document?.edit(this.raw, 'difficulty', {
						safe: true,
						choices: namedChoices(difficulties, difficulty => gameName('difficulty', difficulty)),
					}),
				},
				{ label: text('cyberpunk.row.patch'), value: metadata.buildPatch },
				{ label: text('cyberpunk.row.modded'), value: formatValue(metadata.isModded) },
				{
					label: text('cyberpunk.row.point_of_no_return'),
					value: formatValue(this.raw.isPointOfNoReturn === true),
				}
			);
		}
		rows.push(
			{ label: text('cyberpunk.row.game_version'), value: String(header.gameVersion) },
			{ label: text('cyberpunk.row.save_version'), value: String(header.saveVersion) },
			{ label: text('cyberpunk.row.file_size'), value: bytes(statSync(this.path).size) },
			{ label: text('cyberpunk.row.data_size'), value: bytes(this.save.size) },
			{ label: text('cyberpunk.row.nodes'), value: formatValue(this.save.nodes.length) }
		);
		return rows;
	}

	public section(name: string): Row[] {
		switch (name) {
			case 'character':
				return this.character();
			case 'perks':
				return this.perks();
			case 'story':
				return this.story();
			case 'save':
				return this.saveRows();
		}
		throw new Error(`Unknown section: ${name}`);
	}

	/** Names for the facts the metadata lists, since the save only has their hashes */
	protected factNames(): Map<number, string> {
		const facts = Array.isArray(this.raw.facts) ? (this.raw.facts as string[]) : [];
		return new Map(facts.map(fact => fact.split('=')[0]).map(name => [factHash(name), name]));
	}

	protected nodeEntry(node: SaveNode, factNames: Map<number, string>): Entry {
		const payload = (): Entry[] => {
			if (this.save.isPackage(node)) {
				const container = this.save.package(node);
				return container.objects.map((object, i) => packageEntry(String(i), object, container));
			}
			if (node.name != 'FactsTable') return [];
			const data = this.save.nodeData(node);
			const facts = readFacts(data);
			return rangeEntries(facts.length, i => {
				const { hash, value, offset } = facts[i];
				return {
					name: factNames.get(hash) ?? `0x${hash.toString(16).padStart(8, '0')}`,
					summary: String(value),
					edit: binaryEdit({ data, offset, type: 'i32' }),
				};
			});
		};
		const hasChildren = node.children.length || node.name == 'FactsTable' || this.save.isPackage(node);
		return {
			name: node.name,
			summary: bytes(node.size),
			children: hasChildren
				? () => [...node.children.map(child => this.nodeEntry(child, factNames)), ...payload()]
				: undefined,
		};
	}

	public contents(): Entry {
		const factNames = this.factNames();
		const header = { ...this.save.header, time: this.save.header.time.toString() };
		return {
			name: basename(this.directory),
			summary: '',
			children: () => [
				this.document?.entry('metadata', this.raw) ?? valueEntry('metadata', {}),
				valueEntry('header', header),
				{
					name: 'nodes',
					summary: formatValue(this.save.nodes.length),
					children: () => this.save.roots.map(node => this.nodeEntry(node, factNames)),
				},
			],
		};
	}

	public write(path: string): void {
		this.file?.write(join(path, 'sav.dat'));
		if (!this.document?.changed || !this.metadataPath) return;
		const target = join(path, basename(this.metadataPath));
		if (path == this.directory) return writeFileSync(target, this.document.toString());

		// A copy's metadata has its own slot name.
		const name = this.document.edit(this.raw, 'name')!;
		const previous = name.value;
		name.set(basename(path));
		writeFileSync(target, this.document.toString());
		name.set(previous);
	}
}

export const inspector: Inspector = {
	sections,
	recognizes(path) {
		if (!existsSync(path)) return false;
		const file = statSync(path).isDirectory() ? join(path, 'sav.dat') : path;
		return basename(file) == 'sav.dat' && existsSync(file);
	},
	open: path => new CyberpunkInspection(path),
	copy(path) {
		const folder = statSync(path).isDirectory() ? path : dirname(path);
		const target = join(dirname(folder), slots.nextManual(dirname(folder)));
		copySave(folder, target);
		slots.rename(target, basename(folder));
		return target;
	},
};
