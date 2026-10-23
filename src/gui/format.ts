import { text } from '../i18n.js';

/** Formats seconds like the game's save list, e.g. `104h 1m`. */
export function hoursAndMinutes(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	return text('play_time', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

export function shortDate(time: Temporal.ZonedDateTime): string {
	return time.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

const markupEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeMarkup(text: string): string {
	return text.replace(/[&<>"']/g, character => markupEntities[character]);
}
