import { readFileSync } from 'node:fs';
import { numberOf, readFields, readVarint, textOf, type Field } from '../../protobuf.js';

/* Reads the objects Subnautica saves with `ProtobufSerializer`: length-prefixed messages for each object and its components. */

/** `ProtobufSerializer.StreamHeader.Signature` */
const signature = 1369164567;

/** A component of an object, such as `LiveMixin`, whose fields are in its own message */
export interface Component {
	type: string;
	isEnabled: boolean;
	/** Where the component's message is in the file */
	start: number;
	end: number;
}

export interface GameObject {
	id: string;
	/** The prefab the object was made from */
	classId?: string;
	/** The ID of the object it is a child of */
	parent?: string;
	isActive: boolean;
	components: Component[];
	/** For objects in the scene, the name the scene knows them by */
	sceneName?: string;
}

function lastNumber(fields: Field[], number: number): number {
	const field = fields.findLast(field => field.number == number);
	return field ? numberOf(field) : 0;
}

function lastText(fields: Field[], number: number): string | undefined {
	const field = fields.findLast(field => field.number == number);
	return field && textOf(field);
}

/** Reads length-prefixed messages in order from part of a file */
class Stream {
	public constructor(
		protected readonly data: Uint8Array,
		public offset: number,
		protected readonly end: number
	) {}

	public get isDone(): boolean {
		return this.offset >= this.end;
	}

	public span(): { start: number; end: number } {
		const prefix = readVarint(this.data, this.offset);
		const start = this.offset + prefix.length;
		const end = start + Number(prefix.value);
		if (end > this.end) throw new RangeError(`Message at ${this.offset} runs past its end`);
		this.offset = end;
		return { start, end };
	}

	public message(): Field[] {
		const { start, end } = this.span();
		return readFields(this.data, start, end);
	}

	/** An object's data and its components */
	public object(): GameObject {
		const data = this.message();
		const object: GameObject = {
			id: lastText(data, 6) ?? '',
			classId: lastText(data, 7),
			parent: lastText(data, 8),
			isActive: lastNumber(data, 2) != 0,
			components: [],
		};
		const count = lastNumber(this.message(), 1);
		for (let i = 0; i < count; i++) {
			const header = this.message();
			const { start, end } = this.span();
			object.components.push({ type: lastText(header, 1) ?? '', isEnabled: lastNumber(header, 2) != 0, start, end });
		}
		return object;
	}

	/** A count, followed by that many objects */
	public objects(): GameObject[] {
		const count = lastNumber(this.message(), 1);
		return Array.from({ length: count }, () => this.object());
	}

	public finish(): void {
		if (this.offset != this.end) throw new Error(`${this.end - this.offset} bytes after the objects`);
	}
}

/** A file of objects, which changes to their components are made in */
export class ObjectFile {
	public readonly data: Uint8Array;
	public readonly objects: GameObject[];

	public constructor(path: string) {
		this.data = new Uint8Array(readFileSync(path));
		this.objects = this.read();
	}

	protected read(): GameObject[] {
		const stream = new Stream(this.data, 0, this.data.length);
		const header = stream.message();
		if (lastNumber(header, 1) != signature) throw new Error('Not a Subnautica object file');
		const objects = stream.objects();
		stream.finish();
		return objects;
	}

	/** The fields of a component's message */
	public fields(component: Component): Field[] {
		return readFields(this.data, component.start, component.end);
	}

	/** The first object with a component of a type, and that component */
	public find(type: string): { object: GameObject; component: Component } | undefined {
		for (const object of this.objects) {
			const component = object.components.find(component => component.type == type);
			if (component) return { object, component };
		}
	}

	/** The component of a type on an object */
	public component(object: GameObject, type: string): Component | undefined {
		return object.components.find(component => component.type == type);
	}
}

/** `scene-objects.bin`, which keeps each of the scene's saved objects, or trees of them, by name */
export class SceneFile extends ObjectFile {
	protected override read(): GameObject[] {
		const outer = new Stream(this.data, 0, this.data.length);
		const { start, end } = outer.span();
		outer.finish();
		const objects: GameObject[] = [];
		for (const entry of readFields(this.data, start, end)) {
			if (entry.number != 2) continue;
			const pair = readFields(this.data, entry.offset, entry.offset + entry.length);
			const value = pair.find(field => field.number == 2);
			if (!value) continue;
			const item = readFields(this.data, value.offset, value.offset + value.length);
			const name = lastText(item, 2);
			const serialData = item.findLast(field => field.number == 3);
			if (!serialData) continue;
			const stream = new Stream(this.data, serialData.offset, serialData.offset + serialData.length);
			const found = lastNumber(item, 4) ? stream.objects() : [stream.object()];
			stream.finish();
			for (const object of found) objects.push({ ...object, sceneName: name });
		}
		return objects;
	}
}
