import { Command, Option } from 'commander';
import * as io from 'ioium/node';
import { existsSync } from 'node:fs';
import { styleText } from 'node:util';
import $pkg from '../package.json' with { type: 'json' };
import { duration } from 'utilium/format';
import { defaultDataDirectory, installEntry, uninstallEntry } from './desktop.js';
import { games, getGame, type Game } from './games/index.js';
import { Timeline } from './timeline.js';

interface ScanOptions {
	game: string;
	directory?: string;
}

function resolve(options: ScanOptions): { game: Game; directory: string } {
	const game = getGame(options.game);
	const directory = options.directory ?? game.defaultDirectories.find(path => existsSync(path));
	if (!directory) io.exit(`Could not find ${game.name} saves, use --directory to specify where they are`);
	return { game, directory };
}

function loadTimelines(options: ScanOptions): Timeline[] {
	const { game, directory } = resolve(options);
	const saves = io.track(`Scanning ${directory}`, () => game.scan(directory));
	return Timeline.fromSaves(saves);
}

const gameOption = new Option('-g, --game <id>', 'Game the saves are from')
	.choices([...games.keys()])
	.default('cyberpunk');
const directoryOption = new Option('-d, --directory <path>', 'Directory containing the saves');

const cli = new Command('save-timeline').version($pkg.version).description($pkg.description).showHelpAfterError();

cli.command('tree')
	.description('Print the inferred timelines')
	.addOption(gameOption)
	.addOption(directoryOption)
	.action(options => {
		for (const timeline of loadTimelines(options)) {
			io.log(styleText('bold', `${timeline.playthrough} (${timeline.nodes.length} saves)`));

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
	});

cli.command('gui', { isDefault: true })
	.description('Open the timeline viewer')
	.addOption(gameOption)
	.addOption(directoryOption)
	.action(async options => {
		const { game, directory } = resolve(options);
		const entry = './gui/main.js';
		const gui = (await import(entry)) as { run(game: Game, directory: string): void };
		gui.run(game, directory);
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
