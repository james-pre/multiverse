import type { Edit } from './editing.js';

/** A line of information about a save, which can have more lines under it */
export interface Row {
	label: string;
	value?: string;
	/** Less important text, such as an ID or a description */
	detail?: string;
	rows?: Row[];
	/** Set for rows whose value can be changed */
	edit?: Edit;
}

/** One part of a save the inspector shows, such as the character or the plugins */
export interface Section {
	title: string;
	description: string;
}

/** One value in the full contents of a save */
export interface Entry {
	name: string;
	/** A short description of the value, such as the value itself or its type and size */
	summary: string;
	/** Reads the entry's children, which can be slow */
	children?: () => Entry[];
	/** Set for entries whose value can be changed */
	edit?: Edit;
}

/** A save opened for inspection, which reads each part of it when asked */
export interface Inspection {
	/** The rows of one of the inspector's sections, by name */
	section(name: string): Row[];
	/** The full contents of the save */
	contents(): Entry;
	/**
	 * Writes the save with its changes to `path`, which is the save's own path or a copy's from `Inspector.copy`.
	 * Inspections whose values can be changed have this.
	 * For games whose saves can be archived, the written save has a new `Save.id`, so the archive tells it apart from the original.
	 */
	write?(path: string): void;
}

/** The most children an entry shows directly, beyond which they are grouped into ranges */
const rangeSize = 100;

/** Groups many children into nested ranges like `0–99`, so each level stays short */
export function rangeEntries(length: number, entry: (index: number) => Entry, start = 0): Entry[] {
	if (length - start <= rangeSize) return Array.from({ length: length - start }, (_, i) => entry(start + i));

	let span = rangeSize;
	while ((length - start) / span > rangeSize) span *= rangeSize;
	const ranges: Entry[] = [];
	for (let first = start; first < length; first += span) {
		const end = Math.min(first + span, length);
		ranges.push({
			name: `${first}–${end - 1}`,
			summary: '',
			children: () => rangeEntries(end, entry, first),
		});
	}
	return ranges;
}

export interface ValueOptions {
	/** The type of an object, for objects that have one */
	typeOf?(value: object): string | undefined;
	/** Replaces values that have a simpler form, such as a list object with its items */
	simplify?(value: unknown): unknown;
	/** Describes values that have no children, such as enums */
	summarize?(value: unknown): string | undefined;
	/** How a value without children can be changed, by its container and its key there */
	edit?(container: object, key: string | number): Edit | undefined;
}

function isArrayLike(value: object): value is ArrayLike<unknown> {
	return Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
}

/**
 * Describes a deserialized value, with its members or elements as children.
 * @param edit How the value can be changed, if it has no children
 */
export function valueEntry(name: string, value: unknown, options: ValueOptions = {}, edit?: Edit): Entry {
	const summary = options.summarize?.(value);
	if (summary !== undefined) return { name, summary };
	const type = typeof value == 'object' && value !== null ? options.typeOf?.(value) : undefined;
	value = options.simplify?.(value) ?? value;

	if (value === null || value === undefined) return { name, summary: 'null' };
	if (typeof value == 'string') return { name, summary: JSON.stringify(value), edit };
	if (typeof value == 'number' || typeof value == 'bigint' || typeof value == 'boolean') {
		return { name, summary: String(value), edit };
	}
	if (typeof value != 'object') return { name, summary: typeof value };

	if (isArrayLike(value)) {
		const first = value[0];
		const elementType = ArrayBuffer.isView(value)
			? value.constructor.name.replace(/Array$/, '')
			: typeof first == 'object' && first !== null
				? (options.typeOf?.(first) ?? '')
				: '';
		const summary = type ? `${type}(${value.length})` : `${elementType}[${value.length}]`;
		if (!value.length) return { name, summary };
		return {
			name,
			summary,
			children: () =>
				rangeEntries(value.length, i => valueEntry(String(i), value[i], options, options.edit?.(value, i))),
		};
	}

	const members = Object.entries(value);
	return {
		name,
		summary: type ?? (members.length ? '{…}' : '{}'),
		children: members.length
			? () => members.map(([key, member]) => valueEntry(key, member, options, options.edit?.(value, key)))
			: undefined,
	};
}

export function* sectionLines(section: Section, rows: Row[]): Generator<string> {
	yield `${section.title}:`;
	const visit = function* (rows: Row[], indent: string): Generator<string> {
		for (const row of rows) {
			const value = row.value === undefined ? '' : `: ${row.value}`;
			const detail = row.detail ? ` (${row.detail})` : '';
			const choices = row.edit?.choices ? `: ${row.edit.choices.map(choice => choice.label).join(', ')}` : '';
			const edit = !row.edit
				? ''
				: row.edit.safe
					? ` [editable${choices}]`
					: ` [editable with --expert${choices}]`;
			yield `${indent}${row.label}${value}${detail}${edit}`;
			if (row.rows) yield* visit(row.rows, indent + '\t');
		}
	};
	yield* visit(rows, '\t');
}

export interface EntryLinesOptions {
	/** How many levels of children to show */
	depth?: number;
	/** How many children of each entry to show */
	items?: number;
}

export function* entryLines(entry: Entry, options: EntryLinesOptions = {}, indent = ''): Generator<string> {
	const { depth = 3, items = 10 } = options;
	yield `${indent}${entry.name}${entry.summary ? `: ${entry.summary}` : ''}`;
	if (depth <= 0 || !entry.children) return;

	const children = entry.children();
	for (const child of children.slice(0, items)) {
		yield* entryLines(child, { depth: depth - 1, items }, indent + '\t');
	}
	if (children.length > items) yield `${indent}\t… ${children.length - items} more`;
}
