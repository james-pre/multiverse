export interface Save {
	/** Identifies the save even after the game reuses its slot. */
	id: string;
	/** Slot name, as shown by the game */
	name: string;
	path: string;
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
	screenshot?: string;
	/** Markers that only accumulate during a playthrough, so an ancestor's set is a subset of its descendant's. */
	progress: ReadonlySet<string>;
	/** Game-specific values shown alongside the save */
	details: Record<string, string | number | boolean>;
}
