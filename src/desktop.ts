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
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, win32 } from 'node:path';
import { isSea } from 'node:sea';
import $pkg from '../package.json' with { type: 'json' };

export const applicationId = 'dev.jamespre.Multiverse';

const packageData = join(import.meta.dirname, '..', 'data');

/** Files linked into a data directory, by their path relative to it */
const files: Record<string, string> = {
	[`applications/${applicationId}.desktop`]: join(packageData, `${applicationId}.desktop`),
	[`icons/hicolor/scalable/apps/${applicationId}.svg`]: join(packageData, `${applicationId}.svg`),
};

/**
 * Where the launcher entry goes.
 * On Linux, this is the system-wide data directory when running as root, otherwise the user's.
 * On Windows, it is the user's Start Menu.
 */
export function defaultDataDirectory(): string {
	if (process.platform == 'win32') return win32.join(appData(), 'Microsoft\\Windows\\Start Menu\\Programs');
	if (process.getuid?.() === 0) return '/usr/local/share';
	return process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
}

function appData(): string {
	return process.env.APPDATA || win32.join(homedir(), 'AppData\\Roaming');
}

const displayName = 'Multiverse';

/** Where Windows lists installed apps in Settings, for the current user */
const uninstallKey = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${applicationId}`;

/** The command that starts the app, which is the executable itself or Node.js with the app's entry point */
export function launchCommand(): string[] {
	return isSea() ? [process.execPath] : [process.execPath, join(import.meta.dirname, 'main.js')];
}

/** Joins arguments into a Windows command line, quoting each one */
export function windowsCommandLine(args: string[]): string {
	return args
		.map(arg => {
			if (/^[\w\-./:\\]+$/.test(arg)) return arg;
			return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
		})
		.join(' ');
}

/** Where the icon is copied, since a shortcut can't use the package's SVG and an executable's files only live in a cache */
function windowsIconPath(): string {
	const localAppData = process.env.LOCALAPPDATA || win32.join(homedir(), 'AppData\\Local');
	return win32.join(localAppData, displayName, `${displayName}.ico`);
}

/** The values for the app's entry in Settings, with their registry types */
export function uninstallValues(command: string[], icon: string): [name: string, type: string, value: string][] {
	return [
		['DisplayName', 'REG_SZ', displayName],
		['DisplayIcon', 'REG_SZ', icon],
		['DisplayVersion', 'REG_SZ', $pkg.version],
		['Publisher', 'REG_SZ', 'James Prevett'],
		['UninstallString', 'REG_SZ', windowsCommandLine([...command, 'uninstall', ...(isSea() ? [] : ['--package'])])],
		['NoModify', 'REG_DWORD', '1'],
		['NoRepair', 'REG_DWORD', '1'],
	];
}

const shortcutScript = `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($env:MULTIVERSE_SHORTCUT)
$shortcut.TargetPath = $env:MULTIVERSE_TARGET
$shortcut.Arguments = $env:MULTIVERSE_ARGUMENTS
$shortcut.IconLocation = $env:MULTIVERSE_ICON
$shortcut.Description = $env:MULTIVERSE_DESCRIPTION
$shortcut.Save()`;

/** Add a Start Menu shortcut and an entry in Settings' installed apps. */
function installWindows(startMenu: string): string[] {
	const shortcut = win32.join(startMenu, `${displayName}.lnk`);
	const icon = windowsIconPath();
	mkdirSync(win32.dirname(icon), { recursive: true });
	copyFileSync(join(packageData, `${applicationId}.ico`), icon);

	// The headless console host starts Node.js without a console window.
	const conhost = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32\\conhost.exe');
	const command = launchCommand();
	execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', shortcutScript], {
		env: {
			...process.env,
			MULTIVERSE_SHORTCUT: shortcut,
			MULTIVERSE_TARGET: conhost,
			MULTIVERSE_ARGUMENTS: windowsCommandLine(['--headless', ...command]),
			MULTIVERSE_ICON: icon,
			MULTIVERSE_DESCRIPTION: $pkg.description,
		},
	});

	for (const [name, type, value] of uninstallValues(command, icon)) {
		execFileSync('reg.exe', ['add', uninstallKey, '/v', name, '/t', type, '/d', value, '/f'], { stdio: 'ignore' });
	}
	return [shortcut, icon, uninstallKey];
}

function uninstallWindows(startMenu: string): string[] {
	const removed: string[] = [];
	for (const path of [win32.join(startMenu, `${displayName}.lnk`), windowsIconPath()]) {
		if (!existsSync(path)) continue;
		unlinkSync(path);
		removed.push(path);
	}
	try {
		execFileSync('reg.exe', ['delete', uninstallKey, '/f'], { stdio: 'ignore' });
		removed.push(uninstallKey);
	} catch {
		// The key was already gone.
	}
	return removed;
}

/** Uninstall the npm package, for when the app is uninstalled from Windows' Settings */
export function uninstallPackage(): void {
	execFileSync('cmd.exe', ['/d', '/s', '/c', `npm uninstall --global ${$pkg.name}`], { stdio: 'inherit' });
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

/**
 * Make the app show up in launchers.
 * On Linux, this links the desktop entry and icon into a data directory.
 * On Windows, this adds a Start Menu shortcut and an entry in Settings' installed apps.
 */
export function installEntry(dataDirectory: string = defaultDataDirectory()): string[] {
	if (process.platform == 'win32') return installWindows(dataDirectory);
	if (process.platform != 'linux') throw new Error('Launcher entries are only supported on Linux and Windows');
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
	if (process.platform == 'win32') return uninstallWindows(dataDirectory);
	return Object.keys(files)
		.map(relative => join(dataDirectory, relative))
		.filter(target => lstatSync(target, { throwIfNoEntry: false }))
		.map(target => (remove(target), target));
}
