// Builds the app's native addons for Windows, and the package with the GTK DLLs and data they need.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const target = 'win32-x64';
const sysroot = join(root, 'node_modules/.cache/girbind', target);
const prefix = join(sysroot, 'ucrt64');
const runtime = join(root, 'build/windows/runtime');
const girbind = join(root, 'node_modules/girbind-devel/dist/main.js');
const $pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

execFileSync(process.execPath, [girbind, 'build', '--target', target], { cwd: root, stdio: 'inherit' });

rmSync(runtime, { recursive: true, force: true });
execFileSync(process.execPath, [girbind, 'dlls', '--target', target, join(runtime, 'bin')], {
	cwd: root,
	stdio: 'inherit',
});

for (const data of ['share/icons/Adwaita', 'share/icons/hicolor', 'share/licenses']) {
	cpSync(join(prefix, data), join(runtime, data), { recursive: true });
}
cpSync(
	join(root, 'data/dev.jamespre.Multiverse.svg'),
	join(runtime, 'share/icons/hicolor/scalable/apps/dev.jamespre.Multiverse.svg')
);

const schemas = join(runtime, 'share/glib-2.0/schemas');
mkdirSync(schemas, { recursive: true });
execFileSync('glib-compile-schemas', ['--targetdir', schemas, join(prefix, 'share/glib-2.0/schemas')], {
	stdio: 'inherit',
});

writeFileSync(
	join(runtime, 'package.json'),
	JSON.stringify(
		{
			name: $pkg.name + '-' + target,
			version: $pkg.version,
			description: 'GTK and libadwaita for Multiverse on Windows, from MSYS2',
			author: $pkg.author,
			license: 'LGPL-2.1-or-later',
			repository: $pkg.repository,
			homepage: $pkg.homepage,
			os: ['win32'],
			cpu: ['x64'],
		},
		null,
		'\t'
	) + '\n'
);
writeFileSync(
	join(runtime, 'README.md'),
	`# ${$pkg.name}-${target}\n\nThe GTK 4 and libadwaita DLLs and data that [Multiverse](${$pkg.homepage}) uses on Windows, from [MSYS2](https://www.msys2.org/). npm installs this package alongside Multiverse on Windows.\n\nEach library's license is in \`share/licenses\`.\n`
);
