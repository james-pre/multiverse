import { array, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';

export const EnchInfo = struct.packed('EnchInfo', {
	magnitude: t.float32,
	duration: t.uint32,
	area: t.uint32,
});

export class MagicEffect extends struct.packed('MagicEffect', {
	effectID: RefID,
	info: EnchInfo,
	/** Amount this enchantment adds to the base item's price. */
	price: t.float32,
}) {}

export const Enchantment = struct.packed(
	'Enchantment',
	{
		/** FormID of the enchantment. */
		refID: RefID,
		/** Seems to represent the number of times the enchantment is used? However, sometimes using the same enchantment nets two different forms. Could just be a bug in Skyrim. */
		timesUsed: t.uint32,
		count: vsval,
		effects: array(MagicEffect).countedBy((en) => getVsval(en.count)),
	},
	{ isDynamic: true }
);

export const CreatedObjects = struct.packed(
	'CreatedObjects',
	{
		/** Number of elements in weaponEnchTable */
		weaponCount: vsval,
		/** List of all created enchantments that are/were applied to weapons. */
		weaponEnchTable: array(Enchantment).countedBy((co) => getVsval(co.weaponCount)),
		/** Number of elements in armourEnchTable */
		armourCount: vsval,
		/** List of all created enchantments that are/were applied to armour. Not sure which types of armour (Body/Gloves/Boots/Shield/etc) this encompasses. */
		armourEnchTable: array(Enchantment).countedBy((co) => getVsval(co.armourCount)),
		/** Number of elements in potionTable */
		potionCount: vsval,
		/** List of all created potions. */
		potionTable: array(Enchantment).countedBy((co) => getVsval(co.potionCount)),
		/** Number of elements in poisonTable */
		poisonCount: vsval,
		/** List of all created poisons. */
		poisonTable: array(Enchantment).countedBy((co) => getVsval(co.poisonCount)),
	},
	{ isDynamic: true }
);
