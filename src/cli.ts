import { Command, Option } from 'commander';
import * as io from 'ioium/node';
import { existsSync } from 'node:fs';
import { styleText } from 'node:util';
import $pkg from '../package.json' with { type: 'json' };
import { duration } from 'utilium/format';
import { games, getGame } from './games/index.js';
import { Timeline } from './timeline.js';

interface ScanOptions {
	game: string;
	directory?: string;
}

function loadTimelines(options: ScanOptions): Timeline[] {
	const game = getGame(options.game);
	const directory = options.directory ?? game.defaultDirectories.find(path => existsSync(path));
	if (!directory) io.exit(`Could not find ${game.name} saves, use --directory to specify where they are`);

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
		const timelines = loadTimelines(options);
		const entry = './gui/main.js';
		const gui = (await import(entry)) as { run(timelines: Timeline[]): Promise<void> };
		await gui.run(timelines);
	});

export default cli;
