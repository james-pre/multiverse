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

/** A file in the folder, with nothing in it if it is missing, which some are in saves from older versions */
function readPart<Part>(folder: string, name: string): Partial<Part> {
	const path = join(folder, `${name}.json`);
	if (!existsSync(path)) return {};
	return JSON.parse(readFileSync(path, 'utf8')) as Partial<Part>;
}

function dateTime(data?: DateTimeData): Temporal.PlainDateTime | undefined {
	if (!data) return;
	const { Year: year, Month: month, Day: day, Hour: hour, Minute: minute, Second: second } = data;
	return Temporal.PlainDateTime.from({ year, month, day, hour, minute, second });
}

export function readSaveFolder(folder: string): SaveFolder {
	if (!existsSync(join(folder, 'Game.json'))) throw new Error('Not a Schedule I save');
	const game = readPart<{ OrganisationName: string; Seed: number; GameVersion: string }>(folder, 'Game');
	const metadata = readPart<{ CreationDate: DateTimeData; LastPlayedDate: DateTimeData }>(folder, 'Metadata');
	const time = readPart<{ Playtime: number; ElapsedDays: number }>(folder, 'Time');
	const money = readPart<{ OnlineBalance: number; Networth: number; LifetimeEarnings: number }>(folder, 'Money');
	const rank = readPart<{ Rank: number; Tier: number; TotalXP: number }>(folder, 'Rank');
	const { Quests: quests = [] } = readPart<{ Quests: QuestData[] }>(folder, 'Quests');

	return {
		organisation: game.OrganisationName ?? '',
		seed: game.Seed ?? 0,
		version: game.GameVersion ?? '',
		created: dateTime(metadata.CreationDate),
		lastPlayed: dateTime(metadata.LastPlayedDate),
		playTime: time.Playtime ?? 0,
		day: time.ElapsedDays ?? 0,
		balance: money.OnlineBalance ?? 0,
		networth: money.Networth ?? 0,
		earnings: money.LifetimeEarnings,
		rank: rank.Rank ?? 0,
		tier: rank.Tier ?? 0,
		experience: rank.TotalXP ?? 0,
		completedQuests: quests.filter(quest => quest.State == 2).map(quest => quest.GUID),
	};
}
