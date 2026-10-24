export interface Pixels {
	width: number;
	height: number;
	/** RGBA, with 4 bytes per pixel */
	data: Uint8Array;
}

export interface Save {
	/** Identifies the save even after the game reuses its slot. */
	id: string;
	/** Slot name, as shown by the game */
	name: string;
	/** The save's file or directory */
	path: string;
	/** Other files that belong to the save, such as script extender co-saves */
	companions?: string[];
	game: string;
	playthrough: string;
	/** In-game play time, in seconds */
	playTime: number;
	/** When the save was written */
	time: Temporal.ZonedDateTime;
	kind: string;
	/** Short description of where the player is, such as the tracked objective */
	label: string;
	/** Short facts shown next to the play time, like a game's own save list */
	highlights: string[];
	/** The path of the save's screenshot, or a function reading its pixels */
	screenshot?: string | (() => Pixels);
	/** Markers that only accumulate during a playthrough, so an ancestor's set is a subset of its descendant's. */
	progress: ReadonlySet<string>;
	/** Counts that never decrease during a playthrough, such as quests completed */
	counters?: Readonly<Record<string, number>>;
	/** Game-specific values shown alongside the save */
	details: Record<string, string | number | boolean>;
	/** The name of the save's file or folder in the game's save directory, for games whose saves can be archived */
	slot?: string;
	/** Whether the save is in the game's save directory, rather than only in the archive */
	inGame?: boolean;
	/** The folder of the save's copy in the archive */
	archived?: string;
}
