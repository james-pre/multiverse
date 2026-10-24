import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suite, test } from 'node:test';
import * as steam from '../src/steam.js';

suite('steam', () => {
	test('parseKeyValues reads nested sections, escapes and comments', () => {
		const data = steam.parseKeyValues(`
			"libraryfolders"
			{
				// The main library
				"0"
				{
					"path"		"C:\\\\Program Files (x86)\\\\Steam"
					"label"		"say \\"hi\\""
					"apps"
					{
						"1091500"		"91231172278"
					}
				}
			}
		`);
		assert.deepEqual(data, {
			libraryfolders: {
				0: {
					path: 'C:\\Program Files (x86)\\Steam',
					label: 'say "hi"',
					apps: { 1091500: '91231172278' },
				},
			},
		});
	});

	test('saveDirectories prefers libraries with the game installed', { skip: process.platform == 'win32' }, () => {
		const libraries = [
			{ path: '/games/other', apps: new Set([10]) },
			{ path: '/games/main', apps: new Set([1091500]) },
		];
		const [first, second] = steam.saveDirectories({ id: 1091500, saves: 'Saved Games/Test' }, libraries);
		assert.equal(first, '/games/main/steamapps/compatdata/1091500/pfx/drive_c/users/steamuser/Saved Games/Test');
		assert.match(second, /^\/games\/other\//);
	});

	test('shortPath shortens paths in Proton prefixes only', () => {
		const prefix = '/games/steamapps/compatdata/1511460/pfx/drive_c/users/steamuser';
		assert.equal(steam.shortPath(`${prefix}/AppData/LocalLow/Game`), 'S:/AppData/LocalLow/Game');
		assert.equal(steam.shortPath(prefix), 'S:');
		assert.equal(steam.shortPath('/home/user/saves'), '/home/user/saves');
	});
	test('saveDirectories expands wildcards and finds install folders', () => {
		const root = mkdtempSync(join(tmpdir(), 'multiverse-'));
		try {
			mkdirSync(join(root, 'steamapps'));
			writeFileSync(
				join(root, 'steamapps/appmanifest_264710.acf'),
				'"AppState" { "appid" "264710" "installdir" "Subnautica" }'
			);
			for (const account of ['111', '222']) {
				mkdirSync(join(root, 'steamapps/common/Subnautica/Saves', account), { recursive: true });
			}
			const library = { path: root, apps: new Set([264710]) };
			const found = steam.saveDirectories({ id: 264710, saves: 'Saves/*', installed: true }, [library]);
			assert.deepEqual(found.toSorted(), [
				join(root, 'steamapps/common/Subnautica/Saves/111'),
				join(root, 'steamapps/common/Subnautica/Saves/222'),
			]);
			assert.equal(steam.shortPath(found.toSorted()[0]), join('Steam', 'Subnautica/Saves/111'));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('cloudDirectories finds the folder of each account, and shortPath shortens them', () => {
		const root = mkdtempSync(join(tmpdir(), 'multiverse-'));
		try {
			mkdirSync(join(root, 'userdata/123/246620/remote'), { recursive: true });
			const [found] = steam.cloudDirectories({ id: 246620, saves: '', cloud: true }, [root]);
			assert.equal(found, join(root, 'userdata/123/246620/remote'));
			assert.equal(steam.shortPath(found), 'Steam Cloud');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
