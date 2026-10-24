import { connect } from 'girbind';
import { homedir } from 'node:os';
import { sep } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gtk from '../../native/gtk.js';
import { findSaveDirectories, games, type SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';

/** Shortens paths in the user's home directory to start with `~`. */
function abbreviateHome(path: string): string {
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
			row.setSubtitle(directory ? abbreviateHome(directory) : text('picker.no_saves'));
			row.setSensitive(!!directory);
			if (directory) {
				row.setActivatable(true);
				row.addSuffix(Gtk.Image.newFromIconName('go-next-symbolic'));
				connect(row, 'activated', () => onOpen({ game, directory }));
			}
			group.add(row as unknown as Gtk.Widget);
		}

		const preferences = new Adw.PreferencesPage();
		preferences.add(group);

		const toolbar = new Adw.ToolbarView();
		toolbar.addTopBar(new Adw.HeaderBar());
		toolbar.setContent(preferences as unknown as Gtk.Widget);
		this.page = new Adw.NavigationPage(toolbar, text('app.title'));
	}
}
