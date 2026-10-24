import type { ArrayOf, FieldBuilder, InstanceOf, StructConstructor, Type } from 'memium';
import { offsetof, struct, types as t } from 'memium';
import { inflateSync } from 'node:zlib';
import { formatNumber } from './format.js';
import { RefID } from './ref-id.js';

export enum ChangeFormType {
	REFR,
	ACHR,
	PMIS,
	PGRE,
	PBEA,
	PFLA,
	CELL,
	INFO,
	QUST,
	NPC_,
	ACTI,
	TACT,
	ARMO,
	BOOK,
	CONT,
	DOOR,
	INGR,
	LIGH,
	MISC,
	APPA,
	STAT,
	MSTT,
	FURN,
	WEAP,
	AMMO,
	KEYM,
	ALCH,
	IDLM,
	NOTE,
	ECZN,
	CLAS,
	FACT,
	PACK,
	NAVM,
	WOOP,
	MGEF,
	SMQN,
	SCEN,
	LCTN,
	RELA,
	PHZD,
	PBAR,
	PCON,
	FLST,
	LVLN,
	LVLI,
	LVSP,
	PARW,
	ENCH,
}

/**
 * @todo
 */
const changeFormStructs = [
	null, // REFR
	null, // ACHR
	null, // PMIS
	null, // PGRE
	null, // PBEA
	null, // PFLA
	null, // CELL
	null, // INFO
	null, // QUST
	null, // NPC_
	null, // ACTI
	null, // TACT
	null, // ARMO
	null, // BOOK
	null, // CONT
	null, // DOOR
	null, // INGR
	null, // LIGH
	null, // MISC
	null, // APPA
	null, // STAT
	null, // MSTT
	null, // FURN
	null, // WEAP
	null, // AMMO
	null, // KEYM
	null, // ALCH
	null, // IDLM
	null, // NOTE
	null, // ECZN
	null, // CLAS
	null, // FACT
	null, // PACK
	null, // NAVM
	null, // WOOP
	null, // MGEF
	null, // SMQN
	null, // SCEN
	null, // LCTN
	null, // RELA
	null, // PHZD
	null, // PBAR
	null, // PCON
	null, // FLST
	null, // LVLN
	null, // LVLI
	null, // LVSP
	null, // PARW
	null, // ENCH
] as const satisfies Record<ChangeFormType, StructConstructor<any> | null>;

export const Change = {
	Form: {
		Flags: 1 << 0,
	},
	Class: {
		TagSkills: 1 << 1,
	},
	Faction: {
		Flags: 1 << 1,
		Reactions: 1 << 2,
		CrimeCounts: 1 << 31,
	},
	TalkingActivator: {
		Speaker: 1 << 23,
	},
	Book: {
		Teaches: 1 << 5,
		Read: 1 << 6,
	},
	Door: {
		ExtraTeleport: 1 << 17,
	},
	Ingredient: {
		Use: 1 << 31,
	},
	Actor: {
		BaseData: 1 << 1,
		BaseAttributes: 1 << 2,
		BaseAiData: 1 << 3,
		BaseSpellList: 1 << 4,
		BaseFullname: 1 << 5,
		BaseFactions: 1 << 6,
		LifeState: 1 << 10,
		ExtraPackageData: 1 << 11,
		ExtraMerchantContainer: 1 << 12,
		ExtraDismemberedLimbs: 1 << 17,
		LeveledActor: 1 << 18,
		DispositionModifiers: 1 << 19,
		TempModifiers: 1 << 20,
		DamageModifiers: 1 << 21,
		OverrideModifiers: 1 << 22,
		PermanentModifiers: 1 << 23,
	},
	Npc: {
		Skills: 1 << 9,
		Class: 1 << 10,
		Face: 1 << 11,
		DefaultOutfit: 1 << 12,
		SleepOutfit: 1 << 13,
		Gender: 1 << 24,
		Race: 1 << 25,
	},
	LeveledList: {
		AddedObject: 1 << 31,
	},
	Note: {
		Read: 1 << 31,
	},
	Cell: {
		Flags: 1 << 1,
		Fullname: 1 << 2,
		Ownership: 1 << 3,
		ExteriorShort: 1 << 28,
		ExteriorChar: 1 << 29,
		DetachTime: 1 << 30,
		SeenData: 1 << 31,
	},
	Refr: {
		Move: 1 << 1,
		HavokMove: 1 << 2,
		CellChanged: 1 << 3,
		Scale: 1 << 4,
		Inventory: 1 << 5,
		ExtraOwnership: 1 << 6,
		BaseObject: 1 << 7,
		Promoted: 1 << 25,
		ExtraActivatingChildren: 1 << 26,
		LeveledInventory: 1 << 27,
		Animation: 1 << 28,
		ExtraEncounterZone: 1 << 29,
		ExtraCreatedOnly: 1 << 30,
		ExtraGameOnly: 1 << 31,
	},
	Object: {
		ExtraItemData: 1 << 10,
		ExtraAmmo: 1 << 11,
		ExtraLock: 1 << 12,
		Empty: 1 << 21,
		OpenDefaultState: 1 << 22,
		OpenState: 1 << 23,
	},
	Topic: {
		SaidOnce: 1 << 31,
	},
	Quest: {
		Flags: 1 << 1,
		ScriptDelay: 1 << 2,
		AlreadyRun: 1 << 26,
		Instances: 1 << 27,
		RunData: 1 << 28,
		Objectives: 1 << 29,
		Script: 1 << 30,
		Stages: 1 << 31,
		NodeTimeRun: 1 << 31,
	},
	Package: {
		Waiting: 1 << 30,
		NeverRun: 1 << 31,
	},
	FormList: {
		AddedForm: 1 << 31,
	},
	EncounterZone: {
		Flags: 1 << 1,
		GameData: 1 << 31,
	},
	Location: {
		KeywordData: 1 << 30,
		Cleared: 1 << 31,
	},
	Relationship: {
		Data: 1 << 1,
	},
	Scene: {
		Active: 1 << 31,
	},
	BaseObject: {
		Value: 1 << 1,
		Fullname: 1 << 2,
	},
} as const;

interface CFDynamicData extends StructConstructor<{ lengths: ArrayOf<number>; raw: Uint8Array<ArrayBuffer> }> {}

function CFDynamicData<FB extends FieldBuilder<Type<number>>>(Length: FB): CFDynamicData {
	return struct.packed(
		'ChangeForm/dynamic/' + Length.toInit().type.name,
		{
			lengths: Length(2),
			raw: t.uint8(0).countedBy((cf) => cf.lengths[0]),
		},
		{
			isDynamic: true,
		}
	);
}

const cfDynamic = [CFDynamicData(t.uint8), CFDynamicData(t.uint16), CFDynamicData(t.uint32)];

export class ChangeForm extends struct.packed(
	'ChangeForm',
	{
		formID: RefID,
		flags: t.uint32,
		type: t.uint8,
		version: t.uint8,
		_raw: t.uint8(0).countedBy((cf: DataView & { lengthSize: 0 | 1 | 2 }) => {
			const { lengthSize } = cf;
			const size = 2 << lengthSize;
			const dv = new DataView(cf.buffer, offsetof(cf, '_raw'));
			switch (lengthSize) {
				case 0:
					return size + dv.getUint8(0);
				case 1:
					return size + dv.getUint16(0, true);
				case 2:
					return size + dv.getUint32(0, true);
			}
		}),
	},
	{ isDynamic: true }
) {
	// Upper 2 bits represent the size of the data lengths:
	// 0 = uint8, 1 = uint16 (> 0xFF), 2 = uint32 (> 0xFFFF)
	protected get lengthSize(): 0 | 1 | 2 {
		const val = this.type >> 6;

		if (val !== 0 && val !== 1 && val !== 2) {
			throw new Error('Unexpected length size: ' + val);
		}

		return val;
	}

	protected dynamic(): InstanceOf<CFDynamicData> {
		const Dyn = cfDynamic[this.lengthSize];
		return new Dyn(this._raw.buffer, this._raw.byteOffset);
	}

	get data(): Uint8Array {
		const dyn = this.dynamic();

		const [length, uncompressedLength] = dyn.lengths;

		const raw = new Uint8Array(dyn.buffer, dyn.byteOffset + (2 << this.lengthSize), length);

		return uncompressedLength ? inflateSync(raw, { maxOutputLength: uncompressedLength }) : raw;
	}

	summary(excludeVersion?: number): string {
		const type = this.type in ChangeFormType ? ChangeFormType[this.type] : formatNumber(this.type, 16);
		return this.version === excludeVersion ? type : `${type} (v${formatNumber(this.version)})`;
	}

	toString(): string {
		return `${this.summary()} ${this.formID.pretty()}`;
	}
}
