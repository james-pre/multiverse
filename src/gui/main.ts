import { connect, keepAlive } from 'girbind';
import { existsSync, readFileSync } from 'node:fs';
import * as Adw from '../../native/adw.js';
import * as Gio from '../../native/gio.js';
import type { SaveLocation } from '../games/index.js';
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

/** Open the app, going straight to a game's timelines if `location` is given. */
export function run(location?: SaveLocation): void {
	// Without the portal, libadwaita reads the color scheme from GSettings instead.
	if (!canUsePortal()) process.env.ADW_DISABLE_PORTAL = '1';

	const app = new Adw.Application('dev.jamespre.Multiverse', Gio.ApplicationFlags.default_flags);

	let main: MainWindow | undefined;

	connect(app, 'activate', () => {
		if (main) return main.window.present();

		const hold = keepAlive();
		main = new MainWindow(app);
		if (location) main.open(location);
		connect(main.window, 'close-request', () => {
			main = undefined;
			hold.release();
		});
		main.window.present();
	});

	app.register(null);
	app.activate();
}
