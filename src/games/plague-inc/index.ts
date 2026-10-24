import * as io from 'ioium';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { formatValue } from '../../format.js';
import { text } from '../../i18n.js';
import type { Save } from '../../save.js';
import type { Game } from '../index.js';
import { inspector } from './inspect.js';
import { diseaseName, diseaseTypeName, percent } from './names.js';
import { decodeValue, readSaveFile, readSlots, type SlotInfo } from './save-file.js';

const fileNamePattern = /^save_(\d+)\.dat$/;

const typeOf = new WeakMap<Save, string>();

function readSave(directory: string, fileName: string, slots: Map<number, SlotInfo>): Save | undefined {
	const match = fileNamePattern.exec(fileName);
	if (!match) return;
	const number = Number(match[1]);
	const path = join(directory, fileName);
	const { fields, world, disease } = readSaveFile(path);
	const slot = slots.get(number);
	const zone = Temporal.Now.timeZoneId();
	const time =
		slot?.time?.toZonedDateTime(zone)
		?? Temporal.Instant.fromEpochMilliseconds(Math.floor(statSync(path).mtimeMs)).toZonedDateTimeISO(zone);
	const day = Number(decodeValue(disease.turnNumber ?? '0'));
	const name = diseaseName(disease, slot);
	const type = diseaseTypeName(disease, slot);
	const screenshot = join(directory, `save_${number}.png`);
	const history = decodeValue(disease.techhistory ?? '');

	const save: Save = {
		id: `${fileName}@${time.toInstant().toString()}`,
		name: text('plague.slot', { number }),
		path,
		companions: existsSync(screenshot) ? [screenshot] : [],
		game: plagueInc.id,
		playthrough: decodeValue(world.startDate ?? fileName),
		playTime: Number(fields.gameTime ?? 0),
		time,
		kind: 'manual',
		label: name,
		highlights: [type, text('plague.day', { day })],
		screenshot: existsSync(screenshot) ? screenshot : undefined,
		progress: new Set(history.split(',').filter(Boolean)),
		counters: { day },
		details: {
			[text('plague.detail.infected')]: formatValue(Number(decodeValue(disease.totalInfected ?? '0'))),
			[text('plague.detail.dead')]: formatValue(Number(decodeValue(disease.totalDead ?? '0'))),
			[text('plague.detail.cure')]: percent(Number(decodeValue(disease.cureCompletePercent ?? '0'))),
		},
	};
	typeOf.set(save, type);
	return save;
}

export const plagueInc: Game = {
	id: 'plague-inc',
	name: 'Plague Inc: Evolved',
	steam: { id: 246620, saves: '', cloud: true },
	describe(timeline) {
		const latest = timeline.nodes.at(-1)!.save;
		return text('plague.playthrough', { name: latest.label, type: typeOf.get(latest)! });
	},
	actions: [],
	inspector,
	scan(directory) {
		const slots = readSlots(directory);
		const saves: Save[] = [];
		for (const fileName of readdirSync(directory)) {
			try {
				const save = readSave(directory, fileName, slots);
				if (save) saves.push(save);
			} catch (error) {
				io.warn(`Skipping ${fileName}: ${io.errorText(error)}`);
			}
		}
		return saves;
	},
};
