import { connect } from 'girbind';
import { homedir } from 'node:os';
import { sep } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gtk from '../../native/gtk.js';
import { findSaveDirectories, games, type SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import * as steam from '../steam.js';

/** Shortens paths in Proton prefixes to start with `S:`, and paths in the user's home directory to start with `~`. */
function abbreviate(path: string): string {
	const short = steam.shortPath(path);
	if (short != path) return short;
	const home = homedir();
	return path == home || path.startsWith(home + sep) ? '~' + path.slice(home.length) : path;
}

/** Lists the supported games and where their saves are, so one can be opened. */
export class GamePicker {
	public readonly page: Adw.NavigationPage;

	public constructor(onOpen: (location: SaveLocation) => void) {
		const group = new Adw.PreferencesGroup();
		group.setTitle(text('picker.title'));
		group.setDescription(text('picker.description'));

		for (const game of games.values()) {
			const [directory] = findSaveDirectories(game);
			const row = new Adw.ActionRow();
			row.setUseMarkup(false);
			row.setTitle(game.name);
			row.setSubtitle(directory ? abbreviate(directory) : text('picker.no_saves'));
			row.setSensitive(!!directory);
			if (directory) {
				row.setTooltipText(directory);
				row.setActivatable(true);
				row.addSuffix(Gtk.Image.newFromIconName('go-next-symbolic'));
				connect(row, 'activated', () => onOpen({ game, directory }));
			}
			group.add(row);
		}

		const preferences = new Adw.PreferencesPage();
		preferences.add(group);

		const toolbar = new Adw.ToolbarView();
		toolbar.addTopBar(new Adw.HeaderBar());
		toolbar.setContent(preferences);
		this.page = new Adw.NavigationPage(toolbar, text('app.title'));
	}
}
