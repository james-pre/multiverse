import assert from 'node:assert/strict';
import { lstatSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { installEntry, uninstallEntry, uninstallValues, windowsCommandLine } from '../src/desktop.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

test('installEntry links the desktop entry and icon, and uninstallEntry removes them', () => {
	const linked = installEntry(directory);
	assert.equal(linked.length, 2);
	for (const path of linked) assert.ok(lstatSync(path).isSymbolicLink());
	assert.match(readlinkSync(linked[0]), /data\/dev\.jamespre\.Multiverse\.desktop$/);

	assert.deepEqual(installEntry(directory), linked);
	assert.deepEqual(uninstallEntry(directory), linked);
	for (const path of linked) assert.equal(lstatSync(path, { throwIfNoEntry: false }), undefined);
});

test('windowsCommandLine quotes arguments with spaces, quotes and trailing backslashes', () => {
	assert.equal(
		windowsCommandLine(['C:\\Program Files\\nodejs\\node.exe', 'main.js', 'say "hi"', 'C:\\dir with space\\']),
		'"C:\\Program Files\\nodejs\\node.exe" main.js "say \\"hi\\"" "C:\\dir with space\\\\"'
	);
});

test('uninstallValues lists the app in Settings, uninstalling the package too', () => {
	const values = Object.fromEntries(
		uninstallValues(['C:\\node.exe', 'C:\\app\\main.js'], 'C:\\icon.ico').map(([name, , value]) => [name, value])
	);
	assert.equal(values.DisplayName, 'Multiverse');
	assert.equal(values.DisplayIcon, 'C:\\icon.ico');
	assert.equal(values.UninstallString, 'C:\\node.exe C:\\app\\main.js uninstall --package');
});
