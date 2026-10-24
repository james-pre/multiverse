import { checkEditValue, type Edit, type EditOptions, type EditValue } from './editing.js';
import { rangeEntries, valueEntry, type Entry } from './inspection.js';

/** Where a value is in the text */
interface Span {
	start: number;
	end: number;
}

const numberPattern = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

const whitespace = new Set([0x20, 0x09, 0x0a, 0x0d]);

function stringify(value: EditValue): string {
	return typeof value == 'bigint' ? value.toString() : JSON.stringify(value);
}

/**
 * JSON text parsed so that its values can be changed, leaving the rest of the text as it was.
 * Integers too big for numbers are read as bigints.
 */
export class JsonDocument {
	public readonly value: unknown;
	protected readonly spans = new WeakMap<object, Map<string | number, Span>>();
	/** New text for spans, by where they start */
	protected readonly replacements = new Map<number, { end: number; text: string }>();
	protected readonly children = new Map<
		string,
		{ container: object; key: string | number; document: JsonDocument }
	>();
	protected position = 0;
	protected isChanged = false;

	public constructor(protected readonly text: string) {
		this.skipWhitespace();
		this.value = this.parseValue();
		this.skipWhitespace();
		if (this.position < text.length) throw new SyntaxError(`Unexpected text at ${this.position}`);
	}

	/** Whether any value has been changed, including in nested documents */
	public get changed(): boolean {
		return this.isChanged || [...this.children.values()].some(child => child.document.changed);
	}

	protected skipWhitespace(): void {
		while (whitespace.has(this.text.charCodeAt(this.position))) this.position++;
	}

	protected expect(character: string): void {
		if (this.text[this.position] != character)
			throw new SyntaxError(`Expected ${character} at ${this.position} of the JSON`);
		this.position++;
	}

	protected record(container: object, key: string | number, start: number): void {
		let spans = this.spans.get(container);
		if (!spans) this.spans.set(container, (spans = new Map()));
		spans.set(key, { start, end: this.position });
	}

	protected parseValue(): unknown {
		const { text } = this;
		const character = text[this.position];
		switch (character) {
			case '{':
				return this.parseObject();
			case '[':
				return this.parseArray();
			case '"':
				return this.parseString();
			case 't':
			case 'f':
			case 'n': {
				const word = character == 't' ? 'true' : character == 'f' ? 'false' : 'null';
				if (!text.startsWith(word, this.position)) throw new SyntaxError(`Unexpected text at ${this.position}`);
				this.position += word.length;
				return character == 't' ? true : character == 'f' ? false : null;
			}
		}
		numberPattern.lastIndex = this.position;
		const match = numberPattern.exec(text);
		if (!match) throw new SyntaxError(`Unexpected text at ${this.position}`);
		this.position += match[0].length;
		const value = Number(match[0]);
		return Number.isSafeInteger(value) || !/^-?\d+$/.test(match[0]) ? value : BigInt(match[0]);
	}

	protected parseString(): string {
		const start = this.position;
		let escaped = false;
		for (this.position++; ; this.position++) {
			const code = this.text.charCodeAt(this.position);
			if (Number.isNaN(code)) throw new SyntaxError('The JSON ends inside a string');
			if (code == 0x5c) {
				escaped = true;
				this.position++;
			} else if (code == 0x22) {
				break;
			}
		}
		this.position++;
		const raw = this.text.slice(start, this.position);
		return escaped ? (JSON.parse(raw) as string) : raw.slice(1, -1);
	}

	/** Parses a member or element, recording where it is if it has no members of its own */
	protected parseMember(container: object, key: string | number): unknown {
		const start = this.position;
		const value = this.parseValue();
		if (typeof value != 'object' || value === null) this.record(container, key, start);
		return value;
	}

	protected parseObject(): Record<string, unknown> {
		const object: Record<string, unknown> = {};
		this.position++;
		this.skipWhitespace();
		if (this.text[this.position] == '}') {
			this.position++;
			return object;
		}
		for (;;) {
			this.skipWhitespace();
			const key = this.parseString();
			this.skipWhitespace();
			this.expect(':');
			this.skipWhitespace();
			Object.defineProperty(object, key, {
				value: this.parseMember(object, key),
				writable: true,
				enumerable: true,
				configurable: true,
			});
			this.skipWhitespace();
			if (this.text[this.position] == '}') break;
			this.expect(',');
		}
		this.position++;
		return object;
	}

	protected parseArray(): unknown[] {
		const array: unknown[] = [];
		this.position++;
		this.skipWhitespace();
		if (this.text[this.position] == ']') {
			this.position++;
			return array;
		}
		for (;;) {
			this.skipWhitespace();
			array.push(this.parseMember(array, array.length));
			this.skipWhitespace();
			if (this.text[this.position] == ']') break;
			this.expect(',');
		}
		this.position++;
		return array;
	}

	/** An edit of a value that has no members, such as a number or a string, or nothing for values it can't change */
	public edit(container: object, key: string | number, options: EditOptions = {}): Edit | undefined {
		const span = this.spans.get(container)?.get(key);
		const current = Reflect.get(container, key) as unknown;
		if (!span || current === null || typeof current == 'object') return;
		const source = this.text.slice(span.start, span.end);
		const edit: Edit = {
			...(typeof current == 'number' && /^-?\d+$/.test(source) ? { integer: true } : {}),
			...options,
			get value() {
				return Reflect.get(container, key) as EditValue;
			},
			set: value => {
				value = checkEditValue(edit, value);
				Reflect.set(container, key, value);
				this.replacements.set(span.start, { end: span.end, text: stringify(value) });
				this.isChanged = true;
			},
		};
		return edit;
	}

	/** The document in a string value that is itself JSON, whose changes are written into the string */
	public nested(container: object, key: string | number): JsonDocument | undefined {
		const span = this.spans.get(container)?.get(key);
		const value = Reflect.get(container, key) as unknown;
		if (!span || typeof value != 'string') return;
		const id = `${span.start}`;
		const existing = this.children.get(id);
		if (existing) return existing.document;
		let document: JsonDocument;
		try {
			document = new JsonDocument(value);
		} catch {
			return;
		}
		this.children.set(id, { container, key, document });
		return document;
	}

	/** Describes a value in the document for inspection, with edits for values without members */
	public entry(name: string, value: unknown = this.value, edit?: Edit): Entry {
		if (Array.isArray(value)) {
			return {
				name,
				summary: `[${value.length}]`,
				children: value.length
					? () => rangeEntries(value.length, i => this.memberEntry(String(i), value, i))
					: undefined,
			};
		}
		if (typeof value == 'object' && value !== null) {
			const keys = Object.keys(value);
			return {
				name,
				summary: keys.length ? '{…}' : '{}',
				children: keys.length ? () => keys.map(key => this.memberEntry(key, value, key)) : undefined,
			};
		}
		return valueEntry(name, value, {}, edit);
	}

	/** Describes a member, showing strings that are JSON as the documents in them */
	protected memberEntry(name: string, container: object, key: string | number): Entry {
		const value = Reflect.get(container, key) as unknown;
		const nested = typeof value == 'string' && /^\s*[[{]/.test(value) ? this.nested(container, key) : undefined;
		return nested ? nested.entry(name) : this.entry(name, value, this.edit(container, key));
	}

	/** The text with every change */
	public toString(): string {
		for (const [id, { container, key, document }] of this.children) {
			if (!document.changed) continue;
			const span = this.spans.get(container)!.get(key)!;
			const text = document.toString();
			Reflect.set(container, key, text);
			this.replacements.set(Number(id), { end: span.end, text: JSON.stringify(text) });
		}
		let result = '';
		let position = 0;
		for (const [start, { end, text }] of [...this.replacements].sort(([a], [b]) => a - b)) {
			result += this.text.slice(position, start) + text;
			position = end;
		}
		return result + this.text.slice(position);
	}
}
