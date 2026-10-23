import { connect, keepAlive } from 'girbind';
import { existsSync, readFileSync } from 'node:fs';
import * as Adw from '../../native/adw.js';
import * as Gio from '../../native/gio.js';
import type { Game } from '../games/index.js';
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

export function run(game: Game, directory: string): void {
	// Without the portal, libadwaita reads the color scheme from GSettings instead.
	if (!canUsePortal()) process.env.ADW_DISABLE_PORTAL = '1';

	const app = new Adw.Application('dev.jamespre.SaveTimeline', Gio.ApplicationFlags.default_flags);

	connect(app, 'activate', () => {
		const hold = keepAlive();
		const { window } = new MainWindow(app, game, directory);
		connect(window, 'close-request', () => hold.release());
		window.present();
	});

	app.register(null);
	app.activate();
}
