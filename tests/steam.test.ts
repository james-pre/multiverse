import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
