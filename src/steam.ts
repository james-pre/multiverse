import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Game {
	/** The app ID, e.g. `1091500` */
	id: number;
	/** The save folder relative to the user's profile, e.g. `Saved Games/CD Projekt Red/Cyberpunk 2077` */
	saves: string;
}

/** Data in Valve's KeyValues text format */
export interface KeyValues {
	[key: string]: string | KeyValues;
}

const escapes: Record<string, string> = { n: '\n', t: '\t' };

function unescape(text: string): string {
	return text.replace(/\\(.)/g, (_, character: string) => escapes[character] ?? character);
}

/** Parse Valve's KeyValues text format, used by files like `libraryfolders.vdf`. */
export function parseKeyValues(text: string): KeyValues {
	const root: KeyValues = {};
	const stack = [root];
	let key: string | undefined;

	for (const [, quoted, brace] of text.matchAll(/"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g)) {
		const current = stack.at(-1)!;
		if (brace == '{') {
			const child: KeyValues = {};
			current[key ?? ''] = child;
			stack.push(child);
			key = undefined;
		} else if (brace == '}') {
			if (stack.length > 1) stack.pop();
		} else if (quoted === undefined) {
			continue;
		} else if (key === undefined) {
			key = unescape(quoted);
		} else {
			current[key] = unescape(quoted);
			key = undefined;
		}
	}

	return root;
}

/** Directories where Steam is installed on this machine */
export function roots(): string[] {
	const home = homedir();
	const candidates =
		process.platform == 'win32'
			? [join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam')]
			: process.platform == 'darwin'
				? [join(home, 'Library/Application Support/Steam')]
				: [
						join(home, '.local/share/Steam'),
						join(home, '.steam/steam'),
						join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
					];
	return [...new Set(candidates.filter(path => existsSync(path)).map(path => realpathSync(path)))];
}

export interface Library {
	path: string;
	/** IDs of the apps installed in the library */
	apps: Set<number>;
}

/** Every Steam library on this machine, from each installation's `libraryfolders.vdf`. */
export function libraries(): Library[] {
	const found = new Map<string, Library>();

	for (const root of roots()) {
		const configPath = join(root, 'steamapps/libraryfolders.vdf');
		if (!existsSync(configPath)) {
			found.set(root, { path: root, apps: new Set() });
			continue;
		}

		const folders = parseKeyValues(readFileSync(configPath, 'utf8')).libraryfolders;
		if (typeof folders != 'object') continue;

		for (const folder of Object.values(folders)) {
			if (typeof folder != 'object' || typeof folder.path != 'string' || !existsSync(folder.path)) continue;
			const apps = typeof folder.apps == 'object' ? Object.keys(folder.apps).map(Number) : [];
			const path = realpathSync(folder.path);
			found.set(path, { path, apps: new Set([...(found.get(path)?.apps ?? []), ...apps]) });
		}
	}

	return [...found.values()];
}

/**
 * Where a Steam game could keep its saves on this machine, with libraries that have the game installed first.
 * On Linux this is inside the game's Proton prefix.
 */
export function saveDirectories({ id, saves }: Game, available: Library[] = libraries()): string[] {
	if (process.platform == 'win32') return [join(homedir(), saves)];

	return available
		.toSorted((a, b) => Number(b.apps.has(id)) - Number(a.apps.has(id)))
		.map(library => join(library.path, 'steamapps/compatdata', String(id), 'pfx/drive_c/users/steamuser', saves));
}

/** Proton prefixes' user profile directories */
const prefixProfile = /^.*\/steamapps\/compatdata\/\d+\/pfx\/drive_c\/users\/steamuser(?=\/|$)/;

/** Shortens a path in a Proton prefix's user profile to start with `S:`, or returns it unchanged. */
export function shortPath(path: string): string {
	return path.replace(prefixProfile, 'S:');
}
