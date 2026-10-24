import type { ArrayOf, InstanceOf, StructConstructor } from 'memium';
import { struct, types as t } from 'memium';
import { styleText } from 'node:util';
import type { Entries } from 'utilium';
import { formatNumber } from './format.js';
import * as globals from './globals/index.js';
import { getVsval } from './vsval.js';

export enum GlobalDataType {
	MiscStats = 0,
	PlayerLocation = 1,
	TES = 2,
	GlobalVariables = 3,
	CreatedObjects = 4,
	Effects = 5,
	Weather = 6,
	Audio = 7,
	SkyCells = 8,
	ProcessLists = 100,
	Combat = 101,
	Interface = 102,
	ActorCauses = 103,
	Unknown104 = 104,
	DetectionManager = 105,
	LocationMetaData = 106,
	QuestStaticData = 107,
	StoryTeller = 108,
	MagicFavorites = 109,
	PlayerControls = 110,
	StoryEventManager = 111,
	IngredientShared = 112,
	MenuControls = 113,
	MenuTopicManager = 114,
	TempEffects = 1000,
	Papyrus = 1001,
	AnimObjects = 1002,
	Timer = 1003,
	SynchronizedAnimations = 1004,
	Main = 1005,
}

export const globalStructMap = {
	[GlobalDataType.MiscStats]: globals.MiscStats,
	[GlobalDataType.PlayerLocation]: globals.PlayerLocation,
	[GlobalDataType.TES]: globals.TES,
	[GlobalDataType.GlobalVariables]: globals.GlobalVariables,
	[GlobalDataType.CreatedObjects]: globals.CreatedObjects,
	[GlobalDataType.Effects]: globals.Effects,
	[GlobalDataType.Weather]: globals.Weather,
	[GlobalDataType.Audio]: globals.Audio,
	[GlobalDataType.SkyCells]: globals.SkyCells,
	[GlobalDataType.ProcessLists]: globals.ProcessLists,
	[GlobalDataType.Combat]: globals.Combat,
	[GlobalDataType.Interface]: globals.Interface,
	[GlobalDataType.ActorCauses]: globals.ActorCauses,
	[GlobalDataType.Unknown104]: null,
	[GlobalDataType.DetectionManager]: globals.DetectionManager,
	[GlobalDataType.LocationMetaData]: globals.LocationMetaData,
	[GlobalDataType.QuestStaticData]: globals.QuestStaticData,
	[GlobalDataType.StoryTeller]: globals.StoryTeller,
	[GlobalDataType.MagicFavorites]: null,
	[GlobalDataType.PlayerControls]: null,
	[GlobalDataType.StoryEventManager]: null,
	[GlobalDataType.IngredientShared]: null,
	[GlobalDataType.MenuControls]: null,
	[GlobalDataType.MenuTopicManager]: null,
	[GlobalDataType.TempEffects]: null,
	[GlobalDataType.Papyrus]: null,
	[GlobalDataType.AnimObjects]: null,
	[GlobalDataType.Timer]: null,
	[GlobalDataType.SynchronizedAnimations]: null,
	[GlobalDataType.Main]: null,
} as const satisfies Record<GlobalDataType, StructConstructor<any> | null>;

type __instances = {
	[K in GlobalDataType]: (typeof globalStructMap)[K] extends StructConstructor<any> ? InstanceOf<(typeof globalStructMap)[K]> : null;
};

type InstanceFor<T extends GlobalDataType> = __instances[T];

export class GlobalData extends struct(
	'GlobalData',
	{
		type: t.uint32.$type<GlobalDataType>(),
		length: t.uint32,
		data: t.uint8(0).countedBy('length'),
	},
	{ isDynamic: true, isPacked: true }
) {}

export function getGlobal<T extends GlobalDataType>(globalData: GlobalData & { type: T }): InstanceFor<T> {
	const Struct = globalStructMap[globalData.type];

	if (!Struct) return null as InstanceFor<T>;

	const { data } = globalData;
	const instance = new Struct(data.buffer, data.byteOffset, data.byteLength);
	return instance as any as InstanceFor<T>;
}

export type GlobalDataSpecific = (typeof globalStructMap)[keyof typeof globalStructMap];

const __unknown = '(not enough information to describe this data)';

function magicEffectText(ef: globals.MagicEffect): string {
	let text = ef.effectID.pretty();

	if (ef.info.magnitude) {
		text += ' x';
		const mag = ef.info.magnitude.toFixed(1);
		text += mag.endsWith('.0') ? mag.slice(0, -2) : mag;
	}

	if (ef.info.duration) {
		text += ` for ${ef.info.duration}s`;
	}

	if (ef.info.area) {
		text += ` area ${ef.info.area}`;
	}

	text += ` ($${Math.round(ef.price)})`;

	return text;
}

export function* dumpGlobal<T extends GlobalDataType>(type: T, instance: InstanceFor<T>): Generator<string | { toString(): string }> {
	const $ = { type, instance } as { [K in GlobalDataType]: { type: K; instance: __instances[K] } }[GlobalDataType];

	switch ($.type) {
		case GlobalDataType.MiscStats: {
			const grouped = Object.groupBy($.instance.stats, (stat) => stat.category);
			for (const [category, stats] of Object.entries(grouped) as any as Entries<typeof grouped>) {
				if (!stats) continue;
				yield `---- ${globals.StatCategory[category]} ----`;
				for (const stat of stats) {
					yield `${styleText('yellow', stat.name.toString())} = ${formatNumber(stat.value)}`;
				}
			}

			return;
		}
		case GlobalDataType.PlayerLocation:
			yield `world space #1: ${$.instance.worldSpace1}, cell (${$.instance.coorX}, ${$.instance.coorY})`;
			yield `world space #2: ${$.instance.worldSpace2}, position (${$.instance.posX.toFixed(2)}, ${$.instance.posY.toFixed(2)}, ${$.instance.posZ.toFixed(2)})`;
			return;
		case GlobalDataType.TES:
			yield __unknown;
			return;
		case GlobalDataType.GlobalVariables:
			for (const gv of $.instance.variables) {
				yield `${gv.refID.pretty()} = ${formatNumber(gv.value)}`;
			}
			return;
		case GlobalDataType.CreatedObjects:
			for (const [name, enchants] of [
				['weapon', $.instance.weaponEnchTable],
				['armor', $.instance.armourEnchTable],
				['potion', $.instance.potionTable],
				['poison', $.instance.poisonTable],
			] as const) {
				yield `${name} enchantments:`;

				for (const enchant of enchants) {
					yield `\t${enchant.refID.pretty()}: ${Array.from(enchant.effects).map(magicEffectText).join(', ')}`;
				}
			}
			return;
		case GlobalDataType.Effects:
			for (const effect of $.instance.imageSpaceModifiers) {
				yield `${effect.effectID.pretty()} x${effect.strength} started at ${effect.timestamp.toFixed(2)}`;
			}
			return;
		case GlobalDataType.Weather:
			yield __unknown;
			return;
		case GlobalDataType.Audio:
			yield __unknown;
			return;
		case GlobalDataType.SkyCells:
			yield __unknown;
			return;
		case GlobalDataType.ProcessLists:
			for (const [type, { count, crimes }] of Array.from($.instance.allCrimes).entries()) {
				yield `${globals.CrimeType[type]} (${getVsval(count)}):`;
				for (const crime of crimes) {
					yield `\t${formatNumber(crime.witnessNum)} witnesses saw ${crime.criminalID.pretty()} commit crime #${formatNumber(crime.serialNum)} ${!crime.victimID.formID ? '' : 'against ' + crime.victimID.pretty()}`;
					if (crime.crimeType == globals.CrimeType.Theft) {
						yield `\t\tstole ${crime.quantity} of ${crime.itemBaseID.pretty()} owned by ${crime.ownershipID.pretty()}`;
					}
				}
			}
			return;
		case GlobalDataType.Combat:
			yield __unknown;
			return;
		case GlobalDataType.Interface:
			yield __unknown;
			return;
		case GlobalDataType.ActorCauses:
			yield __unknown;
			return;
		case GlobalDataType.DetectionManager:
			yield __unknown;
			return;
		case GlobalDataType.LocationMetaData:
			yield __unknown;
			return;
		case GlobalDataType.QuestStaticData:
			yield __unknown;
			return;
		case GlobalDataType.StoryTeller:
			yield __unknown;
			return;
		default:
			yield instance === null ? '???' : `Missing dump logic for ${GlobalDataType[type]} (this is probably a bug!)`;
			return;
	}
}

export function* dumpTable(table: ArrayOf<GlobalData>): Generator<string> {
	for (const data of table) {
		const name = GlobalDataType[data.type];
		if (!name) {
			yield `unknown type ${data.type}`;
			continue;
		}
		yield `${name}:`;
		const global = getGlobal(data);
		if (!global) continue;
		for (const line of dumpGlobal(data.type, global)) yield '\t' + String(line);
	}
}
