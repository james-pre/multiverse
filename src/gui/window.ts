import { connect } from 'girbind';
import * as Adw from '../../native/adw.js';
import { Archive } from '../archive.js';
import type { SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import { GamePicker } from './game-picker.js';
import { InspectorWindow } from './inspector-window.js';
import { TimelinePage } from './timeline-page.js';

/** Starts with the game picker, and shows a game's timelines once one is opened. */
export class MainWindow extends Adw.ApplicationWindow {
	protected readonly navigation = new Adw.NavigationView();
	protected readonly toasts = new Adw.ToastOverlay();
	protected readonly timelines = new Map<Adw.NavigationPage, TimelinePage>();

	public constructor(application: Adw.Application) {
		super({ application });
		this.setTitle(text('app.title'));
		this.setDefaultSize(1280, 720);

		this.navigation.add(new GamePicker(location => this.open(location)).page);
		this.toasts.setChild(this.navigation);
		this.setContent(this.toasts);

		connect(this.navigation, 'popped', (_, page) => {
			this.timelines.get(page)?.dispose();
			this.timelines.delete(page);
		});
		connect(this as Adw.ApplicationWindow, 'close-request', () => {
			for (const timeline of this.timelines.values()) timeline.dispose();
		});
	}

	public toast(title: string): void {
		this.toasts.addToast(new Adw.Toast(title));
	}

	public open(location: SaveLocation): void {
		const timeline = new TimelinePage(
			location,
			title => this.toast(title),
			save => {
				if (!location.game.inspector) return;
				const archive = location.game.archive ? new Archive(location) : undefined;
				const inspector = new InspectorWindow(
					this.application as Adw.Application,
					location.game.inspector,
					save,
					archive
				);
				inspector.present();
				connect(inspector, 'close-request', () => this.present());
			}
		);
		this.timelines.set(timeline.page, timeline);
		this.navigation.push(timeline.page);
	}
}
