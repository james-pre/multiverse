import { array, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';

export enum CrimeType {
	Theft = 0,
	Pickpocketing = 1,
	Trespassing = 2,
	Assault = 3,
	Murder = 4,
	Unknown5 = 5,
	Lycanthropy = 6,
}

export const Crime = struct.packed(
	'Crime',
	{
		witnessNum: t.uint32,
		crimeType: t.uint32.$type<CrimeType>(),
		unknown: t.uint8,
		/** The number of stolen items (e.g. if you've stolen Gold(7), it would be equals to 7). Only for thefts */
		quantity: t.uint32,
		/** Assigned in accordance with nextNum */
		serialNum: t.uint32,
		unknown2: t.uint8,
		/** May be date of crime? Little byte is equal to day */
		unknownDate: t.uint32,
		/** Negative value measured from moment of crime */
		elapsedTime: t.float32,
		/** The killed, forced door, stolen item etc. */
		victimID: RefID,
		criminalID: RefID,
		/** Only for thefts */
		itemBaseID: RefID,
		/** Faction, outfit etc. Only for thefts */
		ownershipID: RefID,
		witnessCount: vsval,
		witnesses: array(RefID).countedBy(crime => getVsval(crime.witnessCount)),
		bounty: t.uint32,
		crimeFactionID: RefID,
		/** 0 - active crime, 1 - it was atoned */
		isCleared: t.uint8,
		unknown3: t.uint16,
	},
	{
		isDynamic: true,
	}
);

export const CrimesOfType = struct.packed(
	'CrimesOfType',
	{
		count: vsval,
		crimes: array(Crime).countedBy(cot => getVsval(cot.count)),
	},
	{ isDynamic: true }
);

export const ProcessLists = struct.packed(
	'ProcessLists',
	{
		unknown1: t.float32,
		unknown2: t.float32,
		unknown3: t.float32,
		nextNum: t.uint32,
		allCrimes: array(CrimesOfType, 7),
	},
	{ isDynamic: true }
);
