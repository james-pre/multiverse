import * as io from 'ioium';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { Game, SaveLocation } from './games/index.js';
import { dataDirectory } from './paths.js';
import type { Save } from './save.js';

/** What the archive knows about a copy, kept in a file next to its folder */
interface ArchiveRecord {
	id: string;
	slot: string;
	/** When the copy was made */
	archived: string;
}

export function archiveDirectory(game: Game): string {
	return join(dataDirectory(), 'archive', game.id);
}

/** Delay after a save directory changes before its saves are archived, so the game can finish writing, in milliseconds */
const settleDelay = 5000;

const copyOptions = { recursive: true, preserveTimestamps: true };

/** The name of a save's folder in the archive, which is safe on every platform */
function keyOf(id: string): string {
	return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

function filesOf(save: Save): string[] {
	return [save.path, ...(save.companions ?? [])];
}

/** Copies of a game's saves, kept outside its save directory so they survive the game saving over them */
export class Archive {
	public readonly game: Game;

	public constructor(
		public readonly location: SaveLocation,
		public readonly directory: string = archiveDirectory(location.game)
	) {
		this.game = location.game;
		if (!this.game.archive) throw new Error(`${this.game.name} saves can not be archived`);
	}

	/** Copies in the archive, by the name of their folder */
	protected records(): Map<string, ArchiveRecord> {
		const records = new Map<string, ArchiveRecord>();
		if (!existsSync(this.directory)) return records;
		for (const name of readdirSync(this.directory)) {
			const key = name.slice(0, -'.json'.length);
			if (!name.endsWith('.json') || !existsSync(join(this.directory, key))) continue;
			try {
				records.set(key, JSON.parse(readFileSync(join(this.directory, name), 'utf8')) as ArchiveRecord);
			} catch (error) {
				io.warn(`Skipping archived save ${key}: ${io.errorText(error)}`);
			}
		}
		return records;
	}

	/** The saves in the game's save directory */
	public live(): Save[] {
		const records = this.records();
		const { directory } = this.location;
		return this.game.scan(directory).map(save => {
			const key = keyOf(save.id);
			save.slot = relative(directory, save.path).split(sep)[0];
			save.inGame = true;
			if (records.has(key)) save.archived = join(this.directory, key);
			return save;
		});
	}

	/**
	 * The saves in the game's save directory and the archive, with each save that is in both listed once.
	 * For games with fixed slots, saves from a slot that holds a save are in that slot's playthrough.
	 */
	public scan(): Save[] {
		const saves = this.live();
		const inGame = new Set(saves.map(save => save.id));
		for (const [key, record] of this.records()) {
			if (inGame.has(record.id)) continue;
			const folder = join(this.directory, key);
			try {
				for (const save of this.game.scan(folder)) {
					saves.push(Object.assign(save, { slot: record.slot, inGame: false, archived: folder }));
				}
			} catch (error) {
				io.warn(`Skipping archived save ${key}: ${io.errorText(error)}`);
			}
		}

		if (!('slots' in this.game.archive!)) return saves;
		const occupied = new Set(saves.filter(save => save.inGame).map(save => save.slot));
		for (const save of saves) if (occupied.has(save.slot)) save.playthrough = `slot:${save.slot}`;
		return saves;
	}

	/** Copy a save from the game's save directory into the archive, unless it is already there. */
	public add(save: Save): void {
		if (save.archived || !save.inGame) return;
		const key = keyOf(save.id);
		const folder = join(this.directory, key);
		const staging = folder + '.partial';
		rmSync(staging, { recursive: true, force: true });
		rmSync(folder, { recursive: true, force: true });
		for (const path of filesOf(save)) {
			const name = relative(this.location.directory, path);
			if (name.startsWith('..') || isAbsolute(name)) throw new Error(`${path} is not in the save directory`);
			cpSync(path, join(staging, name), copyOptions);
		}
		const record: ArchiveRecord = { id: save.id, slot: save.slot!, archived: Temporal.Now.instant().toString() };
		writeFileSync(folder + '.json', JSON.stringify(record, null, '\t') + '\n');
		renameSync(staging, folder);
		save.archived = folder;
	}

	/** Archive every save in the game's save directory that isn't yet, returning those that were added */
	public addAll(): Save[] {
		const added: Save[] = [];
		for (const save of this.live()) {
			if (save.archived) continue;
			try {
				this.add(save);
				added.push(save);
			} catch (error) {
				io.warn(`Could not archive ${save.name}: ${io.errorText(error)}`);
			}
		}
		return added;
	}

	/** Archive a save, then remove it from the game's save directory. */
	public removeFromGame(save: Save): void {
		if (!save.inGame) return;
		this.add(save);
		for (const path of filesOf(save)) rmSync(path, { recursive: true, force: true });
		save.inGame = false;
	}

	/**
	 * Copy an archived save back into the game's save directory, returning the save it replaced.
	 * For games with fixed slots, the save in its slot is archived and replaced, and otherwise it goes in a free slot if its own is taken.
	 */
	public putInGame(save: Save): Save | undefined {
		if (save.inGame || !save.archived) return;
		const support = this.game.archive!;
		const occupant = this.live().find(other => other.slot == save.slot);
		const slot = occupant && !('slots' in support) ? support.freeSlot(this.location.directory) : save.slot!;
		const replaced = occupant && 'slots' in support ? occupant : undefined;

		const names = readdirSync(save.archived);
		const targets = names.map(name => join(this.location.directory, name == save.slot ? slot : name));
		const replacing = new Set(replaced ? filesOf(replaced) : []);
		const blocked = targets.find(target => existsSync(target) && !replacing.has(target));
		if (blocked) throw new Error(`${blocked} is in the way`);

		if (replaced) this.removeFromGame(replaced);
		mkdirSync(this.location.directory, { recursive: true });
		names.forEach((name, i) => cpSync(join(save.archived!, name), targets[i], copyOptions));
		save.inGame = true;
		return replaced;
	}

	/** The files of a save's copy in the archive, for deleting it */
	public filesOf(save: Save): string[] {
		return save.archived ? [save.archived, save.archived + '.json'] : [];
	}
}

/** Archive each location's saves now and whenever the game writes them, until `signal` aborts. */
export function autoArchive(
	locations: SaveLocation[],
	signal: AbortSignal,
	onArchived?: (location: SaveLocation, saves: Save[]) => void
): void {
	for (const location of locations) {
		const archive = new Archive(location);
		let timer: NodeJS.Timeout | undefined;
		const run = () => {
			try {
				const added = archive.addAll();
				if (added.length) onArchived?.(location, added);
			} catch (error) {
				io.warn(`Could not archive ${location.game.name} saves: ${io.errorText(error)}`);
			}
		};
		run();
		try {
			const watcher = watch(location.directory, { recursive: true, signal }, () => {
				clearTimeout(timer);
				timer = setTimeout(run, settleDelay);
			});
			watcher.on('error', error => {
				if (!signal.aborted) io.warn(`Stopped archiving ${location.game.name} saves: ${io.errorText(error)}`);
			});
		} catch (error) {
			io.warn(`Not archiving ${location.game.name} saves as they change: ${io.errorText(error)}`);
		}
		signal.addEventListener('abort', () => clearTimeout(timer));
	}
}
