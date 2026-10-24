// Builds a single executable application, embedding a production copy of the app with its native addons.
import { cpSync, globSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildApp } from 'xsea';

const root = join(import.meta.dirname, '..');
const app = join(root, 'build/sea');

rmSync(app, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

for (const file of ['package.json', 'package-lock.json', 'LICENSE.md']) cpSync(join(root, file), join(app, file));
for (const directory of ['dist', 'data', 'locales']) {
	cpSync(join(root, directory), join(app, directory), { recursive: true, filter: path => !path.endsWith('.d.ts') });
}
for (const file of globSync('native/*.{js,node}', { cwd: root })) cpSync(join(root, file), join(app, file));

execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], {
	cwd: app,
	stdio: 'inherit',
});

await buildApp({
	root: app,
	main: 'dist/main.js',
	name: 'save-multiverse',
	prefix: join(root, 'build/save-multiverse-'),
	targets: ['linux-x64'],
});
