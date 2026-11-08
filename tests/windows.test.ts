import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { expandEnvironment, parseRegistryQuery, profilePath } from '../src/windows.js';

suite('windows', () => {
	const output = [
		'',
		'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
		'    Personal    REG_EXPAND_SZ    %USERPROFILE%\\OneDrive\\Documents',
		'    {4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}    REG_EXPAND_SZ    D:\\Saved Games',
		'    Local AppData    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local',
		'',
	].join('\r\n');

	test('parseRegistryQuery reads values with spaces in their names', () => {
		const values = parseRegistryQuery(output);
		assert.equal(values.get('Personal'), '%USERPROFILE%\\OneDrive\\Documents');
		assert.equal(values.get('Local AppData'), '%USERPROFILE%\\AppData\\Local');
		assert.equal(values.size, 3);
	});

	test('expandEnvironment replaces variables it knows', () => {
		assert.equal(
			expandEnvironment('%HOME%\\a\\%MISSING%', { HOME: 'C:\\Users\\jp' }),
			'C:\\Users\\jp\\a\\%MISSING%'
		);
	});

	test('profilePath follows moved folders', () => {
		const folders = parseRegistryQuery(output);
		assert.equal(
			profilePath('Saved Games/CD Projekt Red/Cyberpunk 2077', folders),
			'D:\\Saved Games\\CD Projekt Red\\Cyberpunk 2077'
		);
		assert.ok(
			profilePath('AppData/LocalLow/TVGS/Schedule I/Saves/*', folders).endsWith(
				'\\AppData\\LocalLow\\TVGS\\Schedule I\\Saves\\*'
			)
		);
	});
});
