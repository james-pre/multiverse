import { Command, Option } from 'commander';
import * as io from 'ioium/node';
import { styleText } from 'node:util';
import $pkg from '../package.json' with { type: 'json' };
import { duration } from 'utilium/format';
import { defaultDataDirectory, installEntry, uninstallEntry } from './desktop.js';
import { findSaveDirectories, games, getGame, type Game, type SaveLocation } from './games/index.js';
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
	io.log(styleText('bold', `${game.describe(timeline)} (${timeline.nodes.length} saves)`));

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

const cli = new Command('save-timeline').version($pkg.version).description($pkg.description).showHelpAfterError();

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

const dataDirectoryOption = new Option('--data-directory <path>', 'Where to link them').default(
	defaultDataDirectory(),
	'system-wide as root, otherwise your user'
);

cli.command('install')
	.description('Add the desktop entry and icon, so the app shows up in launchers')
	.addOption(dataDirectoryOption)
	.option('--global-only', 'Only install during a global npm install, and warn instead of failing')
	.action(options => {
		if (!options.globalOnly) {
			for (const path of installEntry(options.dataDirectory)) io.log('Installed', path);
			return;
		}

		if (process.env.npm_config_global !== 'true' || process.platform != 'linux') return;
		try {
			installEntry(options.dataDirectory);
		} catch (error) {
			io.warn('Could not install the desktop entry:', io.errorText(error));
		}
	});

cli.command('uninstall')
	.description('Remove the desktop entry and icon')
	.addOption(dataDirectoryOption)
	.action(options => {
		for (const path of uninstallEntry(options.dataDirectory)) io.log('Removed', path);
	});

export default cli;
