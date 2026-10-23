import * as locales from '@james-pre/locales/node';
import { join } from 'node:path';

locales.load(join(import.meta.dirname, '..', 'locales'));

const preferred = locales.resolve(Intl.DateTimeFormat().resolvedOptions().locale);
if (preferred) locales.use(preferred);

export const { text } = locales;
