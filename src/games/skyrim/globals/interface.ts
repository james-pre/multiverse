import { array, primitive, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';
import { wstring } from '../strings.js';

const Interface_Unknown0_0 = struct.packed('Interface_Unknown0_0', {
	unknown0: wstring,
	unknown1: wstring,
	uint32s: t.uint32(4),
});

const Interface_Unknown0 = struct.packed(
	'Interface_Unknown0',
	{
		count1: vsval,
		unknown1: array(Interface_Unknown0_0).countedBy((u) => getVsval(u.count1)),
		count2: vsval,
		unknown2: array(wstring).countedBy((u) => getVsval(u.count2)),
		unknown3: t.uint32,
	},
	{ isDynamic: true }
);

export const Interface = struct.packed(
	'Interface',
	{
		shownHelpMsgCount: t.uint32,
		/**
			0xEC - HelpLockpickingShort
			0xEE - HelpSmithingShort
			0xEF - HelpCookingPots
			0xF0 - HelpSmeltingShort
			0xF1 - HelpTanningShort
			0xF3 - HelpEnchantingShort
			0xF4 - HelpGrindstoneShort
			0xF5 - HelpArmorBenchShort
			0xF6 - HelpAlchemyShort
			0xF7 - HelpBarterShortPC
			0xF9 - HelpLevelingShort
			0xFA - HelpWorldMapShortPC
			0xFB - HelpJournalShortPC
			0xFF - HelpJailTutorial
			0x100 - HelpFollowerCommandTutorial
			0x102 - HelpFavoritesPCShort
			etc.
		 */
		shownHelpMsg: array(primitive.types.uint32).countedBy('shownHelpMsgCount'),
		unknown0: t.uint8,
		lastUsedWeaponsCount: vsval,
		lastUsedWeapons: array(RefID).countedBy((i) => getVsval(i.lastUsedWeaponsCount)),
		lastUsedSpellsCount: vsval,
		lastUsedSpells: array(RefID).countedBy((i) => getVsval(i.lastUsedSpellsCount)),
		lastUsedShoutsCount: vsval,
		lastUsedShouts: array(RefID).countedBy((i) => getVsval(i.lastUsedShoutsCount)),
		unknown1: t.uint8,
		/** This value is only present in certain situations. Undetermined when.  */
		unknown: array(Interface_Unknown0, 0),
	},
	{ isDynamic: true }
);
