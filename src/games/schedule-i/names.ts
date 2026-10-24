import { text } from '../../i18n.js';

const slotCount = 5;

/** The folders of the game's save slots */
export const slots = Array.from({ length: slotCount }, (_, i) => `SaveGame_${i + 1}`);

const romanTiers = ['I', 'II', 'III', 'IV', 'V'];

export function money(amount: number): string {
	return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function rankName(rank: number, tier: number): string {
	const name = text(`schedule.rank.${rank}`, { $default: text('schedule.rank.unknown', { rank }) });
	return `${name} ${romanTiers[tier - 1] ?? tier}`;
}
