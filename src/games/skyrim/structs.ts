import { array, primitive, struct, types as t } from 'memium';
import { GlobalData } from './global-data.js';
import { FileTime, wstring } from './strings.js';
import { ChangeForm } from './change-forms.js';

export enum PlayerSex {
	Male = 0,
	Female = 1,
}

export enum CompressionType {
	None = 0,
	zLib = 1,
	LZ4 = 2,
}

export const SaveHeader = struct(
	'SaveHeader',
	{
		version: t.uint32,
		saveNumber: t.uint32,
		playerName: wstring,
		playerLevel: t.uint32,
		playerLocation: wstring,
		gameDate: wstring,
		playerRaceEditorId: wstring,
		playerSex: t.uint16.$type<PlayerSex>(),
		playerCurExp: t.float32,
		playerLvlUpExp: t.float32,
		filetime: FileTime,
		shotWidth: t.uint32,
		shotHeight: t.uint32,
		compressionType: t.uint16.$type<CompressionType>(),
	},
	{ isDynamic: true, isPacked: true }
);

export const PluginInfo = struct(
	'PluginInfo',
	{
		pluginCount: t.uint8,
		plugins: array(wstring).countedBy('pluginCount'),
	},
	{ isDynamic: true, isPacked: true }
);

export const LightPluginInfo = struct(
	'LightPluginInfo',
	{
		pluginCount: t.uint16,
		plugins: array(wstring).countedBy('pluginCount'),
	},
	{ isDynamic: true, isPacked: true }
);

export const FileLocationTable = struct.packed('FileLocationTable', {
	formIDArrayCountOffset: t.uint32,
	unknownTable3Offset: t.uint32,
	globalDataTable1Offset: t.uint32,
	globalDataTable2Offset: t.uint32,
	changeFormsOffset: t.uint32,
	globalDataTable3Offset: t.uint32,
	globalDataTable1Count: t.uint32,
	globalDataTable2Count: t.uint32,
	globalDataTable3Count: t.uint32,
	changeFormCount: t.uint32,
	unused: t.uint32(15),
});

export const Unknown3Table = struct(
	'Unknown3Table',
	{
		count: t.uint32,
		unknown: array(wstring).countedBy('count'),
	},
	{ isDynamic: true, isPacked: true }
);

/** The data after the header and screenshot, once decompressed */
export class SaveBody extends struct(
	'SaveBody',
	{
		formVersion: t.uint8,
		pluginInfoSize: t.uint32,
		pluginInfo: PluginInfo,
		lightPluginInfo: LightPluginInfo,
		fileLocationTable: FileLocationTable,
		globalDataTable1: array(GlobalData).countedBy((sv) => sv.fileLocationTable.globalDataTable1Count),
		globalDataTable2: array(GlobalData).countedBy((sv) => sv.fileLocationTable.globalDataTable2Count),
		changeForms: array(ChangeForm).countedBy((sv) => sv.fileLocationTable.changeFormCount),
		globalDataTable3: array(GlobalData).countedBy((sv) => sv.fileLocationTable.globalDataTable3Count),
		formIDArrayCount: t.uint32,
		formIDArray: array(primitive.types.uint32).countedBy('formIDArrayCount'),
		visitedWorldspaceArrayCount: t.uint32,
		visitedWorldspaceArray: array(primitive.types.uint32).countedBy('visitedWorldspaceArrayCount'),
		unknown3TableSize: t.uint32,
		unknown3Table: Unknown3Table,
	},
	{ isDynamic: true, isPacked: true }
) {}
