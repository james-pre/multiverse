// Builds single executable applications, embedding a production copy of the app with the native addons for each platform.
import { cpSync, existsSync, globSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildApp } from 'xsea';

const root = join(import.meta.dirname, '..');
const windowsRuntime = join(root, 'build/windows/runtime');

/** Whether an addon is built for Windows, rather than for Linux */
const isWindowsAddon = path => path.endsWith('.win32-x64.node');

/** Copies the app into `app` and installs its production dependencies */
function prepare(app, includeAddon) {
	rmSync(app, { recursive: true, force: true });
	mkdirSync(app, { recursive: true });
	for (const file of ['package.json', 'package-lock.json', 'LICENSE.md']) cpSync(join(root, file), join(app, file));
	for (const directory of ['dist', 'data', 'locales']) {
		cpSync(join(root, directory), join(app, directory), {
			recursive: true,
			filter: path => !path.endsWith('.d.ts'),
		});
	}
	for (const file of globSync('native/*.js', { cwd: root })) cpSync(join(root, file), join(app, file));
	for (const file of globSync('native/*.node', { cwd: root }).filter(includeAddon)) {
		cpSync(join(root, file), join(app, file));
	}

	execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], {
		cwd: app,
		stdio: 'inherit',
	});
	const otherRuntimes = globSync('node_modules/girbind/dist/girbind.*.node', { cwd: app }).filter(
		path => !includeAddon(path)
	);
	for (const file of otherRuntimes) {
		rmSync(join(app, file));
	}
}

const linux = join(root, 'build/sea/linux');
prepare(linux, path => !isWindowsAddon(path));
await buildApp({
	root: linux,
	main: 'dist/main.js',
	name: 'multiverse',
	prefix: join(root, 'build/multiverse-'),
	targets: ['linux-x64'],
});

if (!existsSync(windowsRuntime)) {
	console.warn('Skipping Windows: run `npm run build:windows` first');
	process.exit();
}

const windows = join(root, 'build/sea/windows');
prepare(windows, isWindowsAddon);
const runtimeBinary = join(windows, 'node_modules/girbind/dist/girbind.win32-x64.node');
if (!existsSync(runtimeBinary)) cpSync(join(root, 'node_modules/girbind/dist/girbind.win32-x64.node'), runtimeBinary);
cpSync(windowsRuntime, join(windows, 'node_modules/@james-pre/multiverse-win32-x64'), { recursive: true });
await buildApp({
	root: windows,
	main: 'dist/main.js',
	name: 'multiverse',
	prefix: join(root, 'build/multiverse-'),
	targets: ['win-x64'],
});
