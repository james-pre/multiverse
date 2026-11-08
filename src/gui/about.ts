import * as Adw from '../../native/adw.js';
import * as Gtk from '../../native/gtk.js';
import $pkg from '../../package.json' with { type: 'json' };
import { text } from '../i18n.js';

const [, author = $pkg.author, website] = /^(.*?)\s*(?:<[^>]*>)?\s*(?:\((.*)\))?$/.exec($pkg.author) ?? [];

/** Shows who made the app, its license and which version this is */
export function aboutDialog(): Adw.AboutDialog {
	const dialog = new Adw.AboutDialog();
	dialog.setApplicationName(text('about.name'));
	dialog.setApplicationIcon('dev.jamespre.Multiverse');
	dialog.setDeveloperName(author);
	dialog.setDevelopers([website ? `${author} ${website}` : author]);
	dialog.setVersion($pkg.version);
	dialog.setWebsite($pkg.homepage);
	dialog.setIssueUrl($pkg.bugs.url);
	dialog.setCopyright(text('about.copyright', { author }));
	dialog.setLicenseType(Gtk.License.lgpl_3_0);
	dialog.setDebugInfo(
		[`${$pkg.name} ${$pkg.version}`, `Node.js ${process.version}`, `${process.platform} ${process.arch}`].join('\n')
	);
	return dialog;
}
