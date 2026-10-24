import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** How the game saves dates, in local time */
interface DateTimeData {
	Year: number;
	Month: number;
	Day: number;
	Hour: number;
	Minute: number;
	Second: number;
}

interface QuestData {
	GUID: string;
	/** 2 once completed */
	State: number;
}

/** A save slot's folder, which has a JSON file for each part of the game */
export interface SaveFolder {
	organisation: string;
	seed: number;
	version: string;
	created?: Temporal.PlainDateTime;
	lastPlayed?: Temporal.PlainDateTime;
	/** In seconds */
	playTime: number;
	day: number;
	balance: number;
	networth: number;
	earnings?: number;
	rank: number;
	tier: number;
	experience: number;
	/** The GUIDs of completed quests */
	completedQuests: string[];
}

/** A file in the folder, or nothing if it is missing, which it is in saves from older versions */
function readPart(folder: string, name: string): Record<string, unknown> {
	const path = join(folder, `${name}.json`);
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function dateTime(data: unknown): Temporal.PlainDateTime | undefined {
	if (typeof data != 'object' || !data) return;
	const { Year: year, Month: month, Day: day, Hour: hour, Minute: minute, Second: second } = data as DateTimeData;
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second });
}

export function readSaveFolder(folder: string): SaveFolder {
	if (!existsSync(join(folder, 'Game.json'))) throw new Error('Not a Schedule I save');
	const game = readPart(folder, 'Game');
	const metadata = readPart(folder, 'Metadata');
	const time = readPart(folder, 'Time');
	const money = readPart(folder, 'Money');
	const rank = readPart(folder, 'Rank');
	const quests = (readPart(folder, 'Quests').Quests ?? []) as QuestData[];

	return {
		organisation: String(game.OrganisationName ?? ''),
		seed: Number(game.Seed ?? 0),
		version: String(game.GameVersion ?? ''),
		created: dateTime(metadata.CreationDate),
		lastPlayed: dateTime(metadata.LastPlayedDate),
		playTime: Number(time.Playtime ?? 0),
		day: Number(time.ElapsedDays ?? 0),
		balance: Number(money.OnlineBalance ?? 0),
		networth: Number(money.Networth ?? 0),
		earnings: money.LifetimeEarnings === undefined ? undefined : Number(money.LifetimeEarnings),
		rank: Number(rank.Rank ?? 0),
		tier: Number(rank.Tier ?? 0),
		experience: Number(rank.TotalXP ?? 0),
		completedQuests: quests.filter(quest => quest.State == 2).map(quest => quest.GUID),
	};
}
