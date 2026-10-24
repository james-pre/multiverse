import { Manager } from '@james-pre/config';
import * as io from 'ioium';
import * as z from 'zod';

export const settings = new Manager(
	z.object({
		/** Whether saves are copied into the archive whenever a game writes them, while the app is running */
		autoArchive: z.boolean().default(false),
	}),
	{ xdg: 'multiverse/settings' }
);

settings.on('load_error', (path, stage, error) => io.warn(`Could not ${stage} ${path}: ${io.errorText(error)}`));
settings.loadDefaults({ loose: true });
