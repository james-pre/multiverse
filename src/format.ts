import { text } from './i18n.js';

/** Formats seconds like the game's save list, e.g. `104h 1m`. */
export function hoursAndMinutes(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return text('play_time', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function shortDate(time: Temporal.ZonedDateTime | Temporal.PlainDateTime): string {
	return time.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/** Formats a value in the user's locale */
export function formatValue(value: string | number | bigint | boolean): string {
	if (typeof value == 'boolean') return text(value ? 'common.yes' : 'common.no');
	if (typeof value == 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
	if (typeof value == 'bigint') return value.toLocaleString();
	return value;
}
