import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as z from 'zod';
import { text } from '../../i18n.js';

export const Metadata = z.object({
	Data: z.object({
		metadata: z.object({
			name: z.string(),
			playthroughID: z.string(),
			playthroughTime: z.number(),
			timestampString: z.string(),
			trackedQuestEntry: z.string(),
			finishedQuests: z.string(),
			lifePath: z.string(),
			level: z.number(),
			streetCred: z.number(),
			difficulty: z.string(),
			buildPatch: z.string(),
			isModded: z.boolean(),
		}),
	}),
});

/** Parses the game's `hh:mm:ss, d.mm.yyyy` timestamps, which are in the system's time zone. */
export function parseTimestamp(timestamp: string): Temporal.ZonedDateTime {
	const match = /^(\d+):(\d+):(\d+), (\d+)\.(\d+)\.(\d+)$/.exec(timestamp);
	if (!match) throw new Error(`Invalid timestamp: ${timestamp}`);
	const [hour, minute, second, day, month, year] = match.slice(1).map(Number);
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second }).toZonedDateTime(
		Temporal.Now.timeZoneId()
	);
}

/** Turns a quest entry path like `quests/meta/09_solo/404/01b_find_mikoshi` into `Find mikoshi`. */
export function describeObjective(entry: string): string {
	const objective = entry.split('/').at(-1)!;
	if (objective == '[nothing]') return '';
	const text = objective.replace(/^\d+\w?_/, '').replaceAll('_', ' ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The newest metadata file in a save directory, since the game versions the file name. */
export function findMetadata(directory: string): string | undefined {
	const versions = readdirSync(directory)
		.map(file => /^metadata\.(\d+)\.json$/.exec(file))
		.filter(match => !!match)
		.toSorted((a, b) => Number(b[1]) - Number(a[1]));
	return versions[0] && join(directory, versions[0][0]);
}

export type Metadata = z.infer<typeof Metadata>['Data']['metadata'];

export function lifePathName(lifePath: string): string {
	return text(`cyberpunk.life_path.${lifePath}`, { $default: lifePath });
}

/** Reads a save's metadata, with every field the game wrote in `raw` */
export function readMetadata(directory: string): { metadata: Metadata; raw: Record<string, unknown> } | undefined {
	const path = findMetadata(directory);
	if (!path) return;
	const json = JSON.parse(readFileSync(path, 'utf8')) as { Data?: { metadata?: Record<string, unknown> } };
	return { metadata: Metadata.parse(json).Data.metadata, raw: json.Data?.metadata ?? {} };
}
