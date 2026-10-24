import { connect } from 'girbind';
import * as Adw from '../../native/adw.js';
import type { SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import { GamePicker } from './game-picker.js';
import { InspectorWindow } from './inspector-window.js';
import { TimelinePage } from './timeline-page.js';

/** Starts with the game picker, and shows a game's timelines once one is opened. */
export class MainWindow {
	public readonly window: Adw.ApplicationWindow;
	protected readonly navigation = new Adw.NavigationView();
	protected readonly toasts = new Adw.ToastOverlay();
	protected readonly timelines = new Map<Adw.NavigationPage, TimelinePage>();

	public constructor(protected readonly application: Adw.Application) {
		this.window = new Adw.ApplicationWindow(application);
		this.window.setTitle(text('app.title'));
		this.window.setDefaultSize(1280, 720);

		this.navigation.add(new GamePicker(location => this.open(location)).page);
		this.toasts.setChild(this.navigation);
		this.window.setContent(this.toasts);

		connect(this.navigation, 'popped', (_, page) => {
			this.timelines.get(page)?.dispose();
			this.timelines.delete(page);
		});
		connect(this.window, 'close-request', () => {
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
				const inspector = new InspectorWindow(this.application, location.game.inspector, save);
				inspector.window.present();
				connect(inspector.window, 'close-request', () => this.window.present());
			}
		);
		this.timelines.set(timeline.page, timeline);
		this.navigation.push(timeline.page);
	}
}
