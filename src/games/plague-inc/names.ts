import { text } from '../../i18n.js';
import { decodeValue, type Fields, type SlotInfo } from './save-file.js';

/** The disease's name, or its type's for diseases saved without a name */
export function diseaseName(disease: Fields, slot?: SlotInfo): string {
	return decodeValue(disease.name ?? '') || slot?.name || diseaseTypeName(disease, slot);
}

export function diseaseTypeName(disease: Fields, slot?: SlotInfo): string {
	const type = decodeValue(disease.diseaseType ?? '') || slot?.diseaseType || '';
	return text(`plague.type.${type}`, {
		$default: decodeValue(disease.diseaseTypeGui ?? '') || slot?.diseaseTypeName || humanize(type.toLowerCase()),
	});
}

export function difficultyName(difficulty: number): string {
	return text(`plague.difficulty.${difficulty}`, { $default: String(difficulty) });
}

/** Turns names like `launch_kickstarter` into names like `Launch kickstarter` */
export function humanize(name: string): string {
	const words = name.replaceAll('_', ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Formats a fraction, which the game lets go past 1, as a percentage */
export function percent(fraction: number): string {
	return `${(Math.min(Math.max(fraction, 0), 1) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}
