import { connect, keepAlive } from 'girbind';
import { existsSync, readFileSync } from 'node:fs';
import * as Adw from '../../native/adw.js';
import * as Gio from '../../native/gio.js';
import { autoArchive } from '../archive.js';
import { findSaveDirectories, games, type SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import { settings } from '../settings.js';
import { preferencesDialog } from './preferences.js';
import { MainWindow } from './window.js';

/**
 * Whether the settings portal can identify this process.
 * It can't inspect processes with file capabilities, which some node binaries are given.
 */
function canUsePortal(): boolean {
	if (process.platform != 'linux' || existsSync('/.flatpak-info')) return true;
	const status = readFileSync('/proc/self/status', 'utf8');
	return /^CapPrm:\s*0+$/m.test(status);
}

/** Every game whose saves can be archived, with where its saves are */
function archivable(): SaveLocation[] {
	return [...games.values()].flatMap(game => {
		const [directory] = game.archive ? findSaveDirectories(game) : [];
		return directory ? [{ game, directory }] : [];
	});
}

/** Open the app, going straight to a game's timelines if `location` is given. */
export function run(location?: SaveLocation): void {
	// Without the portal, libadwaita reads the color scheme from GSettings instead.
	if (!canUsePortal()) process.env.ADW_DISABLE_PORTAL = '1';

	const app = new Adw.Application('dev.jamespre.Multiverse', Gio.ApplicationFlags.default_flags);

	let main: MainWindow | undefined;
	let archiving: AbortController | undefined;

	/** Archive saves as games write them, while the app is running */
	const setAutoArchive = (enabled: boolean) => {
		archiving?.abort();
		archiving = enabled ? new AbortController() : undefined;
		if (!archiving) return;
		autoArchive(archivable(), archiving.signal, (location, saves) =>
			main?.toast(text('archive.auto', { count: saves.length, game: location.game.name }))
		);
	};

	const preferences = new Gio.SimpleAction('preferences', null);
	connect(preferences, 'activate', () => preferencesDialog(setAutoArchive).present(main?.window));
	app.addAction(preferences);
	app.setAccelsForAction('app.preferences', ['<Control>comma']);

	connect(app, 'activate', () => {
		if (main) return main.window.present();

		const hold = keepAlive();
		main = new MainWindow(app);
		if (location) main.open(location);
		setAutoArchive(settings.data.autoArchive);
		connect(main.window, 'close-request', () => {
			main = undefined;
			setAutoArchive(false);
			hold.release();
		});
		main.window.present();
	});

	app.register(null);
	app.activate();
}
