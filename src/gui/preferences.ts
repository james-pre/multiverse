import { connect } from 'girbind';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gio from '../../native/gio.js';
import * as Gtk from '../../native/gtk.js';
import { text } from '../i18n.js';
import { dataDirectory } from '../paths.js';
import { settings } from '../settings.js';

/** The button at the end of a header bar, with the app's menu */
export function menuButton(): Gtk.MenuButton {
	const menu = new Gio.Menu();
	menu.append(text('menu.preferences'), 'app.preferences');
	const button = new Gtk.MenuButton();
	button.setIconName('open-menu-symbolic');
	button.setMenuModel(menu);
	button.setPrimary(true);
	return button;
}

/** Shows the app's settings, calling `onAutoArchive` when automatic archiving is turned on or off. */
export function preferencesDialog(onAutoArchive: (enabled: boolean) => void): Adw.PreferencesDialog {
	const group = new Adw.PreferencesGroup();
	group.setTitle(text('preferences.archive.title'));
	group.setDescription(text('preferences.archive.description'));

	const autoArchive = new Adw.SwitchRow();
	autoArchive.setTitle(text('preferences.auto_archive.title'));
	autoArchive.setSubtitle(text('preferences.auto_archive.subtitle'));
	autoArchive.setActive(settings.data.autoArchive);
	connect(autoArchive, 'notify::active', () => {
		settings.update({ autoArchive: autoArchive.getActive() }, 'user');
		onAutoArchive(autoArchive.getActive());
	});
	group.add(autoArchive);

	const folder = join(dataDirectory(), 'archive');
	const folderRow = new Adw.ActionRow();
	folderRow.setUseMarkup(false);
	folderRow.setTitle(text('preferences.folder.title'));
	folderRow.setSubtitle(folder);
	folderRow.setSubtitleSelectable(true);
	const open = Gtk.Button.newFromIconName('folder-open-symbolic');
	open.setValign(Gtk.Align.center);
	open.setTooltipText(text('preferences.folder.open'));
	open.addCssClass('flat');
	connect(open, 'clicked', () => {
		mkdirSync(folder, { recursive: true });
		Gio.AppInfo.launchDefaultForUri(Gio.File.newForPath(folder).getUri(), null);
	});
	folderRow.addSuffix(open);
	group.add(folderRow);

	const page = new Adw.PreferencesPage();
	page.add(group);
	const dialog = new Adw.PreferencesDialog();
	dialog.add(page);
	return dialog;
}
