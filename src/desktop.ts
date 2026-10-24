import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isSea } from 'node:sea';

export const applicationId = 'dev.jamespre.Multiverse';

const packageData = join(import.meta.dirname, '..', 'data');

/** Files linked into a data directory, by their path relative to it */
const files: Record<string, string> = {
	[`applications/${applicationId}.desktop`]: join(packageData, `${applicationId}.desktop`),
	[`icons/hicolor/scalable/apps/${applicationId}.svg`]: join(packageData, `${applicationId}.svg`),
};

/** The system-wide data directory when running as root, otherwise the user's. */
export function defaultDataDirectory(): string {
	if (process.getuid?.() === 0) return '/usr/local/share';
	return process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
}

function remove(path: string): void {
	if (existsSync(path) || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(path);
}

/** Copies a file for a single executable, whose files only live in a cache, pointing the desktop entry at the executable. */
function copyForExecutable(source: string, target: string): void {
	if (!source.endsWith('.desktop')) return copyFileSync(source, target);
	const entry = readFileSync(source, 'utf8')
		.replace(/^TryExec=.*$/m, `TryExec=${process.execPath}`)
		.replace(/^Exec=.*$/m, `Exec="${process.execPath.replace(/["`$\\]/g, '\\$&')}"`);
	writeFileSync(target, entry);
}

/** Link the desktop entry and icon into a data directory, so the app shows up in launchers. */
export function installEntry(dataDirectory: string = defaultDataDirectory()): string[] {
	if (process.platform != 'linux') throw new Error('Desktop entries are only supported on Linux');
	return Object.entries(files).map(([relative, source]) => {
		const target = join(dataDirectory, relative);
		mkdirSync(dirname(target), { recursive: true });
		remove(target);
		if (isSea()) copyForExecutable(source, target);
		else symlinkSync(source, target);
		return target;
	});
}

export function uninstallEntry(dataDirectory: string = defaultDataDirectory()): string[] {
	return Object.keys(files)
		.map(relative => join(dataDirectory, relative))
		.filter(target => lstatSync(target, { throwIfNoEntry: false }))
		.map(target => (remove(target), target));
}
