import { array, struct, types as t } from 'memium';
import { wstring } from '../strings.js';

export enum StatCategory {
	General = 0,
	Quest = 1,
	Combat = 2,
	Magic = 3,
	Crafting = 4,
	Crime = 5,
	/** maybe? */
	DLC = 6,
}

export const MiscStat = struct.packed(
	'MiscStat',
	{
		name: wstring,
		category: t.uint8.$type<StatCategory>(),
		value: t.int32,
	},
	{ isDynamic: true }
);

export const MiscStats = struct.packed(
	'MiscStats',
	{
		count: t.uint32,
		stats: array(MiscStat).countedBy('count'),
	},
	{ isDynamic: true }
);
