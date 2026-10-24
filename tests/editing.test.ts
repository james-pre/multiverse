import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, suite, test } from 'node:test';
import {
	binaryEdit,
	copySave,
	linkedEdit,
	Locations,
	parseEditValue,
	propertyEdit,
	type Edit,
} from '../src/editing.js';
import { JsonDocument } from '../src/json.js';

const directory = mkdtempSync(join(tmpdir(), 'multiverse-'));
after(() => rmSync(directory, { recursive: true, force: true }));

suite('editing', () => {
	test('parseEditValue parses by the type of the current value and checks limits', () => {
		const number: Edit = { value: 5, integer: true, minimum: 0, maximum: 10, set() {} };
		assert.equal(parseEditValue(number, ' 7 '), 7);
		assert.throws(() => parseEditValue(number, '7.5'), /whole number/);
		assert.throws(() => parseEditValue(number, '11'), /highest/);
		assert.throws(() => parseEditValue(number, ''), /not a number/);
		assert.equal(parseEditValue({ value: 5n, set() {} }, '123456789012345678901'), 123456789012345678901n);
		assert.equal(parseEditValue({ value: true, set() {} }, 'no'), false);
		assert.equal(parseEditValue({ value: 'a', set() {} }, ' b '), ' b ');
	});

	test('binaryEdit changes values in the data, within the limits of their type', () => {
		const data = new Uint8Array(8);
		const changes: unknown[] = [];
		const edit = binaryEdit({ data, offset: 2, type: 'u16' }, { safe: true }, value => changes.push(value));
		assert.equal(edit.maximum, 0xffff);
		edit.set(0x1234);
		assert.deepEqual([...data.subarray(2, 4)], [0x34, 0x12]);
		assert.equal(edit.value, 0x1234);
		assert.deepEqual(changes, [0x1234]);
		assert.throws(() => edit.set(-1));
		assert.throws(() => edit.set(1.5));
	});

	test('Locations find members, array elements and copies of arrays', () => {
		const data = new Uint8Array(16);
		const locations = new Locations();
		const object = { level: 0 };
		const array = new Int32Array(2);
		locations.set(object, 'level', { data, offset: 0, type: 'i32' });
		locations.setArray(array, { data, offset: 8, type: 'i32' });
		locations.edit(object, 'level')!.set(-3);
		assert.equal(object.level, -3);
		assert.equal(new DataView(data.buffer).getInt32(0, true), -3);

		const copy = Array.from(array);
		locations.alias(copy, array);
		locations.edit(copy, 1)!.set(9);
		assert.equal(copy[1], 9);
		assert.equal(array[1], 9);
		assert.equal(new DataView(data.buffer).getInt32(12, true), 9);
		assert.equal(locations.edit(object, 'missing'), undefined);
	});

	test('propertyEdit and linkedEdit change every copy of a value', () => {
		const save = { points: 1 };
		const summary = { points: 1 };
		const edit = linkedEdit(propertyEdit(save, 'points', { type: 'u8', safe: true }), [
			propertyEdit(summary, 'points'),
		]);
		assert.ok(edit.safe);
		edit.set(4);
		assert.deepEqual([save.points, summary.points, edit.value], [4, 4, 4]);
		assert.throws(() => edit.set(256));
	});

	test('copySave copies a save and renames its companions', () => {
		const folder = join(directory, 'copy');
		mkdirSync(folder);
		writeFileSync(join(folder, 'Save1_a.ess'), 'save');
		writeFileSync(join(folder, 'Save1_a.skse'), 'co-save');
		copySave(join(folder, 'Save1_a.ess'), join(folder, 'Save2_a.ess'), [join(folder, 'Save1_a.skse')]);
		assert.equal(readFileSync(join(folder, 'Save2_a.skse'), 'utf8'), 'co-save');
		assert.throws(() => copySave(join(folder, 'Save1_a.ess'), join(folder, 'Save2_a.ess')), /already exists/);

		writeFileSync(join(folder, 'Mission. start'), 'save');
		writeFileSync(join(folder, 'Mission. start.dat'), 'header');
		copySave(join(folder, 'Mission. start'), join(folder, 'Mission. start copy'), [
			join(folder, 'Mission. start.dat'),
		]);
		assert.ok(existsSync(join(folder, 'Mission. start copy.dat')));
	});
});

suite('JsonDocument', () => {
	const text =
		'{\r\n    "name": "Benzies",\r\n    "Money": 50.0,\r\n    "Big": 12345678901234567890,\r\n    "List": [1, 2],\r\n    "Item": "{\\"Cash\\":5.5}"\r\n}';

	test('writes the text as it was when nothing changed', () => {
		const document = new JsonDocument(text);
		assert.equal(document.toString(), text);
		assert.equal((document.value as { Big: bigint }).Big, 12345678901234567890n);
		assert.ok(!document.changed);
	});

	test('changes only the values that were edited, keeping decimal points', () => {
		const document = new JsonDocument(text);
		const value = document.value as Record<string, unknown>;
		document.edit(value, 'Money')!.set(75);
		document.edit(value.List as object, 1)!.set(3);
		document.edit(value, 'name')!.set('Ben "Z"');
		assert.equal(document.edit(value, 'List'), undefined);
		assert.equal(
			document.toString(),
			'{\r\n    "name": "Ben \\"Z\\"",\r\n    "Money": 75.0,\r\n    "Big": 12345678901234567890,\r\n    "List": [1, 3],\r\n    "Item": "{\\"Cash\\":5.5}"\r\n}'
		);
	});

	test('edits JSON in strings, writing it back into the string', () => {
		const document = new JsonDocument(text);
		const value = document.value as Record<string, unknown>;
		const item = document.nested(value, 'Item')!;
		item.edit(item.value as object, 'Cash')!.set(10);
		assert.ok(document.changed);
		assert.equal(JSON.parse(document.toString()).Item, '{"Cash":10.0}');
	});

	test('entries have edits for values without members', () => {
		const document = new JsonDocument(text);
		const [name, , , list, item] = document.entry('root').children!();
		assert.equal(name.edit?.value, 'Benzies');
		assert.equal(list.children!()[0].edit?.value, 1);
		assert.equal(item.children!()[0].edit?.value, 5.5);
	});
});
