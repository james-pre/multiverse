import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package with GTK's DLLs and data for Windows, which npm installs alongside the app on Windows */
export const runtimePackage = '@james-pre/multiverse-win32-x64';

/** Where GTK's DLLs and data for Windows are: the runtime package, or one built by `npm run build:windows` */
export function gtkRuntime(): string | undefined {
	try {
		return dirname(fileURLToPath(import.meta.resolve(runtimePackage + '/package.json')));
	} catch {
		const built = join(import.meta.dirname, '../build/windows/runtime');
		return existsSync(built) ? built : undefined;
	}
}

/** Lets Windows find GTK's DLLs when the bindings load */
export function useGtkRuntime(): void {
	const runtime = gtkRuntime();
	if (!runtime) throw new Error(`GTK for Windows is missing; reinstall Multiverse so npm installs ${runtimePackage}`);
	process.env.PATH = join(runtime, 'bin') + delimiter + process.env.PATH;
}

/** Parses the output of `reg query` into the values of the key it queried, by name */
export function parseRegistryQuery(output: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const [, name, value] of output.matchAll(/^ {4}(.+?) {4}REG_\w+ {4}(.*?)\r?$/gm)) values.set(name, value);
	return values;
}

/** The values of a registry key, or none if it can't be read */
export function registryValues(key: string): Map<string, string> {
	try {
		return parseRegistryQuery(
			execFileSync('reg', ['query', key], {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
				windowsHide: true,
			})
		);
	} catch {
		return new Map();
	}
}

/** Replaces `%NAME%` with the value of the environment variable */
export function expandEnvironment(value: string, environment: NodeJS.ProcessEnv = process.env): string {
	return value.replace(/%([^%]+)%/g, (match, name: string) => environment[name] ?? match);
}

/** Folders users can move, by their usual path in the user's profile, with their names in the registry */
const movableFolders: Record<string, string> = {
	Documents: 'Personal',
	'Saved Games': '{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}',
	'AppData/LocalLow': '{A520A1A4-1780-4FF6-BD18-167343C5AF16}',
	'AppData/Local': 'Local AppData',
	'AppData/Roaming': 'AppData',
};

let shellFolders: Map<string, string> | undefined;

/**
 * Resolves a path relative to the user's profile, following folders like Documents that the user or OneDrive moved.
 * @param folders The `User Shell Folders` registry values, read from the registry by default
 */
export function profilePath(path: string, folders?: Map<string, string>): string {
	folders ??= shellFolders ??= registryValues(
		'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders'
	);
	const segments = path.split(/[/\\]/);
	for (const [usual, name] of Object.entries(movableFolders)) {
		const usualSegments = usual.split('/');
		const matches = usualSegments.every((segment, i) => segments[i]?.toLowerCase() == segment.toLowerCase());
		const moved = folders.get(name);
		if (!matches || !moved) continue;
		return win32.join(expandEnvironment(moved), ...segments.slice(usualSegments.length));
	}
	return win32.join(homedir(), ...segments);
}

/** Where Steam is installed, from the registry */
export function steamPath(): string | undefined {
	const path = registryValues('HKCU\\Software\\Valve\\Steam').get('SteamPath');
	return path && win32.normalize(path);
}
