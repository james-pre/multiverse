import { connect, keepAlive } from 'girbind';
import * as Adw from '../../native/adw.js';
import type { Timeline } from '../timeline.js';
import { TimelineView } from './timeline-view.js';

export function run(timelines: Timeline[]): void {
	const app = new Adw.Application('dev.jamespre.SaveTimeline', 0);

	connect(app, 'activate', () => {
		const hold = keepAlive();

		const window = new Adw.ApplicationWindow(app);
		window.setTitle('Save Timeline');
		window.setDefaultSize(1280, 720);

		const stack = new Adw.ViewStack();
		const views = timelines.map(timeline => new TimelineView(timeline));
		for (const view of views) stack.addTitled(view.widget, view.timeline.playthrough, view.timeline.playthrough);

		const switcher = new Adw.ViewSwitcher();
		switcher.setStack(stack);
		switcher.setPolicy(Adw.ViewSwitcherPolicy.wide);

		const header = new Adw.HeaderBar();
		header.setTitleWidget(switcher);

		const toolbar = new Adw.ToolbarView();
		toolbar.addTopBar(header);
		toolbar.setContent(stack);
		window.setContent(toolbar);

		const render = () => views.forEach(view => view.render());
		connect(window, 'notify::default-width', render);
		connect(window, 'notify::default-height', render);
		connect(Adw.StyleManager.getDefault(), 'notify::dark', render);

		connect(window, 'close-request', () => {
			hold.release();
			return false;
		});

		window.present();
	});

	app.register(null);
	app.activate();
}
