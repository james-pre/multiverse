import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where the app keeps its data, such as archived saves */
export function dataDirectory(): string {
	const home = homedir();
	switch (process.platform) {
		case 'win32':
			return join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Multiverse');
		case 'darwin':
			return join(home, 'Library/Application Support/Multiverse');
		default:
			return join(process.env.XDG_DATA_HOME || join(home, '.local/share'), 'multiverse');
	}
}
