export * from './combat.js';
export * from './created-objects.js';
export * from './interface.js';
export * from './misc-stats.js';
export * from './process-lists.js';
export * from './quest-static-data.js';

import { array, struct, types as t } from 'memium';
import { RefID } from '../ref-id.js';
import { getVsval, vsval } from '../vsval.js';

// player location //

export const PlayerLocation = struct.packed('PlayerLocation', {
	/** Number of next savegame specific object id, i.e. FFxxxxxx. */
	nextObjectId: t.uint32,
	/** This form is usually 0x0 or a worldspace. coorX and coorY represent a cell in this worldspace. */
	worldSpace1: RefID,
	/** x-coordinate (cell coordinates) in worldSpace1. */
	coorX: t.int32,
	/** y-coordinate (cell coordinates) in worldSpace1 */
	coorY: t.int32,
	/** This can be either a worldspace or an interior cell. If it's a worldspace, the player is located at the cell (coorX, coorY). posX/Y/Z is the player's position inside the cell. */
	worldSpace2: RefID,
	/** x-coordinate in worldSpace2 */
	posX: t.float32,
	/** y-coordinate in worldSpace2 */
	posY: t.float32,
	/** z-coordinate in worldSpace2 */
	posZ: t.float32,
	/** vsval? It seems absent in 9th version  */
	unk: t.uint8,
});

// TES //

const TES_Unknown0 = struct.packed('TES_Unknown0', {
	formID: RefID,
	unknown: t.uint16,
});

export const TES = struct.packed(
	'TES',
	{
		count1: vsval,
		unknown0: array(TES_Unknown0).countedBy(tes => getVsval(tes.count1)),
		count2: t.uint32,
		unknown1: array(RefID).countedBy(tes => tes.count2 * tes.count2),
		count3: vsval,
		unknown2: array(RefID).countedBy(tes => getVsval(tes.count3)),
	},
	{ isDynamic: true }
);

// global variables //

export const GlobalVariable = struct.packed('GlobalVariable', {
	refID: RefID,
	value: t.float32,
});

export const GlobalVariables = struct.packed(
	'GlobalVariables',
	{
		count: vsval,
		variables: array(GlobalVariable).countedBy(gv => getVsval(gv.count)),
	},
	{ isDynamic: true }
);

// effects //

export const Effect = struct.packed('Effect', {
	/** Value from 0 to 1 (0 is no effect, 1 is full effect)  */
	strength: t.float32,
	/** Time from effect beginning  */
	timestamp: t.float32,
	/** May be flag. Appears when you аdd a crossfade imagespace modifier to the active list with imodcf command */
	unknown: t.uint32,
	effectID: RefID,
});

export const Effects = struct.packed(
	'Effects',
	{
		count: vsval,
		imageSpaceModifiers: array(Effect).countedBy(e => getVsval(e.count)),
		unknown1: t.float32,
		unknown2: t.float32,
	},
	{ isDynamic: true }
);

// weather //

export const Weather = struct.packed('Weather', {
	climate: RefID,
	weather: RefID,
	/** Only during weather transition. In other cases it equals zero. */
	prevWeather: RefID,
	unkWeather1: RefID,
	unkWeather2: RefID,
	regnWeather: RefID,
	/** Current in-game time in hours */
	curTime: t.float32,
	/** Time of current weather beginning */
	begTime: t.float32,
	/** A value from 0.0 to 1.0 describing how far in the current weather has transitioned */
	weatherPct: t.float32,
	unknown: t.uint32(8),
	flags: t.uint8,
	/** Unresearched format. Only present if flags has bit 0 set. */
	/** Unresearched format. Only present if flags has bit 1 set. */
});

// audio //

export const Audio = struct.packed('Audio', {
	/** Only the UIActivateFail sound descriptor has been observed here. */
	unknown: RefID,
	tracksCount: vsval,
	/** Seems to contain music tracks (MUST records) that were playing at the time of saving, not including the background music. */
	tracks: array(RefID).countedBy(a => getVsval(a.tracksCount)),
	bgm: RefID,
});

// sky cells //

export const SkyCell = struct.packed('SkyCell', {
	unknown1: RefID,
	unknown2: RefID,
});

export const SkyCells = struct.packed(
	'SkyCells',
	{
		count: vsval,
		cells: array(SkyCell).countedBy(sc => getVsval(sc.count)),
	},
	{ isDynamic: true }
);

// actor causes //

const ActorCause_Unknown0 = struct.packed('ActorCause_Unknown0', {
	x: t.float32,
	y: t.float32,
	z: t.float32,
	serialNum: t.uint32,
	actorID: RefID,
});

export const ActorCauses = struct.packed(
	'ActorCauses',
	{
		nextNum: t.uint32,
		count0: vsval,
		unknown0: array(ActorCause_Unknown0).countedBy(ac => getVsval(ac.count0)),
	},
	{ isDynamic: true }
);

// detection manager //

const DetectionManager_Unknown0 = struct.packed('DetectionManager_Unknown0', {
	id: RefID,
	unknown0: t.uint32,
	unknown1: t.float32,
});

export const DetectionManager = struct.packed(
	'DetectionManager',
	{
		count: vsval,
		unknown: array(DetectionManager_Unknown0).countedBy(dm => getVsval(dm.count)),
	},
	{ isDynamic: true }
);

// location metadata //

const LocationMetaData_Unknown0 = struct.packed('LocationMetaData_Unknown0', {
	id: RefID,
	unknown: t.uint32,
});

export const LocationMetaData = struct.packed(
	'LocationMetaData',
	{
		count: vsval,
		unknown: array(LocationMetaData_Unknown0).countedBy(lmd => getVsval(lmd.count)),
	},
	{ isDynamic: true }
);

// storyteller //

export const StoryTeller = struct.packed('StoryTeller', {
	/** Either 0 or 1 */
	flag: t.uint8,
});
