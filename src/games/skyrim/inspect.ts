import { closeSync, openSync, readSync } from 'node:fs';
import { decodeUTF8 } from 'utilium';
import { bytes } from 'utilium/format';
import type { Inspector } from '../index.js';
import { formatNumber, formatString } from './format.js';
import { dumpTable } from './global-data.js';
import { SaveFile } from './save-file.js';
import { fileTimeToInstant } from './strings.js';
import { CompressionType, PlayerSex, type SaveBody } from './structs.js';

const sections = {
	header: 'The header and other metadata',
	plugins: 'The plugin list',
	light: 'The light plugin list',
	locations: 'The file location table',
	globals: 'The global data tables',
	changes: 'A summary of the change forms',
};

function* header(file: SaveFile, body: SaveBody): Generator<string> {
	const { header } = file;
	yield 'Header:';
	yield `\tversion ${formatNumber(header.version)}`;
	yield `\tsave #${formatNumber(header.saveNumber)}`;
	yield `\tplayer: ${formatString(header.playerName)}`;
	yield `\t\tlevel: ${formatNumber(header.playerLevel)} (${formatNumber(header.playerCurExp)}/${formatNumber(header.playerLvlUpExp)})`;
	yield `\t\tlocation: ${formatString(header.playerLocation)}`;
	yield `\t\trace: ${formatString(header.playerRaceEditorId)}`;
	yield `\t\tsex: ${PlayerSex[header.playerSex]}`;
	yield `\tplay time: ${formatString(header.gameDate)}`;
	yield `\tsave date: ${fileTimeToInstant(header.filetime).toLocaleString()}`;
	yield `\tscreenshot: ${formatNumber(header.shotWidth)}x${formatNumber(header.shotHeight)}`;
	yield `Compression: ${CompressionType[header.compressionType]}, ${bytes(file.bodySize)} uncompressed`;
	yield `Form version: ${formatNumber(body.formVersion)}`;
}

function* locations(body: SaveBody): Generator<string> {
	const table = body.fileLocationTable;
	yield 'File Location Table:';
	yield `\tform ID array count offset: ${formatNumber(table.formIDArrayCountOffset, 16)}`;
	yield `\tunknown table 3 offset: ${formatNumber(table.unknownTable3Offset, 16)}`;
	yield `\tchange forms: ${formatNumber(table.changeFormCount)} items at ${formatNumber(table.changeFormsOffset, 16)}`;

	const tables = [
		[table.globalDataTable1Count, table.globalDataTable1Offset],
		[table.globalDataTable2Count, table.globalDataTable2Offset],
		[table.globalDataTable3Count, table.globalDataTable3Offset],
	] as const;
	for (const [i, [count, offset]] of tables.entries()) {
		yield `\tglobal data table #${i + 1}: ${formatNumber(count)} items at ${formatNumber(offset, 16)}`;
	}
}

function* changes(body: SaveBody): Generator<string> {
	const groups = Object.groupBy(body.changeForms, form => form.summary(body.formVersion));
	const summary = Object.entries(groups).map(([name, forms = []]) => `${formatNumber(forms.length)} ${name}`);
	yield `Change Forms: ${summary.join(', ')}`;
}

function* globals(body: SaveBody): Generator<string> {
	const tables = [body.globalDataTable1, body.globalDataTable2, body.globalDataTable3];
	for (const [i, table] of tables.entries()) {
		yield `Global Data Table #${i + 1}:`;
		for (const line of dumpTable(table)) yield '\t' + line;
	}
}

export const inspector: Inspector = {
	sections,

	recognizes(path) {
		const fd = openSync(path, 'r');
		try {
			const start = new Uint8Array(13);
			readSync(fd, start, 0, start.length, 0);
			return decodeUTF8(start) == 'TESV_SAVEGAME';
		} catch {
			return false;
		} finally {
			closeSync(fd);
		}
	},

	*inspect(path, chosen) {
		const file = new SaveFile(path);
		const body = file.parseBody();

		if (chosen.has('header')) yield* header(file, body);
		if (chosen.has('plugins')) {
			const { plugins, pluginCount } = body.pluginInfo;
			yield `Plugins (${pluginCount}): ${Array.from(plugins, formatString).join(', ')}`;
		}
		if (chosen.has('light')) {
			const { plugins, pluginCount } = body.lightPluginInfo;
			yield `Light Plugins (${pluginCount}): ${Array.from(plugins, formatString).join(', ')}`;
		}
		if (chosen.has('locations')) yield* locations(body);
		if (chosen.has('changes')) yield* changes(body);
		if (chosen.has('globals')) yield* globals(body);
	},

	decompress(path) {
		return new SaveFile(path).body();
	},
};
