import { Command, Option } from 'commander';
import * as io from 'ioium/node';
import { writeFileSync } from 'node:fs';
import { styleText } from 'node:util';
import $pkg from '../package.json' with { type: 'json' };
import { duration } from 'utilium/format';
import { defaultDataDirectory, installEntry, uninstallEntry, uninstallPackage } from './desktop.js';
import { findSaveDirectories, games, getGame, type Game, type SaveLocation } from './games/index.js';
import { text } from './i18n.js';
import { entryLines, sectionLines } from './inspection.js';
import { Timeline } from './timeline.js';

interface ScanOptions {
	game?: string;
	directory?: string;
}

/** The chosen game and where its saves are, or every game with saves on this machine. */
function locate(options: ScanOptions): SaveLocation[] {
	if (!options.game) {
		if (options.directory) io.exit('--directory needs --game');
		return [...games.values()].flatMap(game => {
			const [directory] = findSaveDirectories(game);
			return directory ? [{ game, directory }] : [];
		});
	}

	const game = getGame(options.game);
	const directory = options.directory ?? findSaveDirectories(game)[0];
	if (!directory) io.exit(`Could not find ${game.name} saves, use --directory to specify where they are`);
	return [{ game, directory }];
}

function printTimeline(game: Game, timeline: Timeline): void {
	io.log(styleText('bold', `${game.describe(timeline)} (${text('common.saves', { count: timeline.nodes.length })})`));

	for (const { node, isBranchStart, depth } of timeline.walk()) {
		const { save } = node;
		const indent = '  '.repeat(depth) + (isBranchStart && node.parent ? '↳ ' : '  ');
		const time = save.time.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
		io.log(
			(indent + save.name).padEnd(32)
				+ duration(save.playTime).padStart(10)
				+ '  '
				+ styleText('dim', time.padEnd(20))
				+ save.label
		);
	}
}

const gameOption = new Option('-g, --game <id>', 'Game the saves are from').choices([...games.keys()]);
const directoryOption = new Option('-d, --directory <path>', 'Directory containing the saves, with --game');

const cli = new Command('multiverse').version($pkg.version).description($pkg.description).showHelpAfterError();

cli.command('tree')
	.description('Print the inferred timelines')
	.addOption(gameOption)
	.addOption(directoryOption)
	.action(options => {
		const located = locate(options);
		if (!located.length) io.exit('Could not find saves for any supported game, use --game and --directory');

		for (const { game, directory } of located) {
			const saves = io.track(`Scanning ${game.name} saves in ${directory}`, () => game.scan(directory));
			for (const timeline of Timeline.fromSaves(saves)) printTimeline(game, timeline);
		}
	});

cli.command('inspect')
	.description('Show what is in a save')
	.argument('<save>', 'Path to the save file or folder')
	.argument('[sections...]', 'Sections to show (default: all)')
	.addOption(gameOption)
	.option('--contents', 'Show the full contents of the save instead of its sections')
	.option('--depth <levels>', 'How many levels of the contents to show', Number, 3)
	.option('--items <count>', 'How many children of each value in the contents to show', Number, 10)
	.option('--decompressed <path>', 'Also write the save data without compression to a file')
	.action((path, sections, options) => {
		const game = options.game
			? getGame(options.game)
			: [...games.values()].find(game => game.inspector?.recognizes(path));
		const inspector = game?.inspector;
		if (!inspector) io.exit(`Could not tell which game ${path} is from, use --game`);

		const unknown = sections.filter(section => !(section in inspector.sections));
		if (unknown.length) {
			const known = Object.entries(inspector.sections).map(
				([name, section]) => `\n  ${name}: ${section.description}`
			);
			io.exit(`Unknown sections: ${unknown.join(', ')}. ${game.name} saves have:${known.join('')}`);
		}

		const inspection = inspector.open(path);
		if (options.contents) {
			const lines = entryLines(inspection.contents(), { depth: options.depth, items: options.items });
			for (const line of lines) io.log(line);
		} else {
			for (const name of sections.length ? sections : Object.keys(inspector.sections)) {
				const [title, ...rows] = sectionLines(inspector.sections[name], inspection.section(name));
				io.log(styleText('bold', title));
				for (const row of rows) io.log(row);
			}
		}

		if (!options.decompressed) return;
		if (!inspector.decompress) io.exit(`${game.name} saves are not compressed`);
		writeFileSync(options.decompressed, inspector.decompress(path));
	});

cli.command('gui', { isDefault: true })
	.description('Open the timeline viewer, starting with a game picker unless --game is given')
	.addOption(gameOption)
	.addOption(directoryOption)
	.action(async options => {
		const [location] = options.game ? locate(options) : [];
		const entry = './gui/main.js';
		const gui = (await import(entry)) as { run(location?: SaveLocation): void };
		gui.run(location);
	});

const dataDirectoryOption = new Option(
	'--data-directory <path>',
	'Where the launcher entry goes: a data directory on Linux, or a Start Menu folder on Windows'
).default(defaultDataDirectory(), 'system-wide as root, otherwise your user');

cli.command('install')
	.description('Make the app show up in launchers, with a desktop entry on Linux or a Start Menu shortcut on Windows')
	.addOption(dataDirectoryOption)
	.option('--global-only', 'Only install during a global npm install, and warn instead of failing')
	.action(options => {
		if (!options.globalOnly) {
			for (const path of installEntry(options.dataDirectory)) io.log('Installed', path);
			return;
		}

		if (process.env.npm_config_global !== 'true' || !['linux', 'win32'].includes(process.platform)) return;
		try {
			installEntry(options.dataDirectory);
		} catch (error) {
			io.warn('Could not add the app to launchers:', io.errorText(error));
		}
	});

cli.command('uninstall')
	.description('Remove the app from launchers')
	.addOption(dataDirectoryOption)
	.option('--package', 'Also uninstall the npm package, as uninstalling from Windows does')
	.action(options => {
		for (const path of uninstallEntry(options.dataDirectory)) io.log('Removed', path);
		if (options.package) uninstallPackage();
	});

export default cli;
