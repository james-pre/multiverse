import { connect, keepAlive, once } from 'girbind';
import * as io from 'ioium';
import * as Adw from '../../native/adw.js';
import * as Gtk from '../../native/gtk.js';
import * as Pango from '../../native/pango.js';
import { hoursAndMinutes, shortDate } from '../format.js';
import type { Inspector } from '../games/index.js';
import { text } from '../i18n.js';
import type { Entry, Inspection, Row } from '../inspection.js';
import type { Save } from '../save.js';
import { screenshotTexture } from './screenshots.js';

/** How long to wait after the window appears before reading the save, in milliseconds */
const loadDelay = 50;

function label(content: string, cssClass?: string): Gtk.Label {
	const widget = new Gtk.Label(content);
	widget.setXalign(0);
	if (cssClass) widget.addCssClass(cssClass);
	return widget;
}

function valueLabel(value: string): Gtk.Label {
	const widget = new Gtk.Label(value);
	widget.setSelectable(true);
	widget.setWrap(true);
	widget.setNaturalWrapMode(Gtk.NaturalWrapMode.none);
	widget.setXalign(1);
	widget.setMaxWidthChars(40);
	return widget;
}

/** A row in the overview, whose child rows are only created once it is expanded */
function rowWidget(row: Row): Gtk.Widget {
	if (!row.rows?.length) {
		const widget = new Adw.ActionRow();
		widget.setUseMarkup(false);
		widget.setTitle(row.label);
		if (row.detail) widget.setSubtitle(row.detail);
		if (row.value !== undefined) widget.addSuffix(valueLabel(row.value));
		return widget;
	}

	const widget = new Adw.ExpanderRow();
	widget.setUseMarkup(false);
	widget.setTitle(row.label);
	if (row.detail) widget.setSubtitle(row.detail);
	if (row.value !== undefined) widget.addSuffix(valueLabel(row.value));
	void once(widget, 'notify::expanded').then(() => {
		for (const child of row.rows!) widget.addRow(rowWidget(child));
	});
	return widget;
}

/** An entry in the contents, like HTML's `<details>`, whose children are only read once it is expanded */
function entryWidget(entry: Entry): Gtk.Widget {
	const heading = new Gtk.Box(Gtk.Orientation.horizontal, 12);
	heading.append(label(entry.name));
	const summary = label(entry.summary, 'dim-label');
	summary.setEllipsize(Pango.EllipsizeMode.end);
	heading.append(summary);

	if (!entry.children) {
		heading.setMarginStart(22);
		summary.setSelectable(true);
		return heading;
	}

	const expander = new Gtk.Expander(null);
	expander.setLabelWidget(heading);
	void once(expander, 'notify::expanded').then(() => expander.setChild(entryList(entry)));
	return expander;
}

function entryList(entry: Entry): Gtk.Widget {
	const list = new Gtk.Box(Gtk.Orientation.vertical, 4);
	list.setMarginStart(18);
	list.setMarginTop(4);
	try {
		for (const child of entry.children?.() ?? []) list.append(entryWidget(child));
	} catch (error) {
		list.append(label(io.errorText(error), 'error'));
	}
	return list;
}

/** Shows what is in a save, with the game's sections in an overview and everything else in its contents. */
export class InspectorWindow {
	public readonly window: Adw.ApplicationWindow;
	protected readonly stack = new Adw.ViewStack();
	protected readonly toolbar = new Adw.ToolbarView();

	public constructor(
		application: Adw.Application,
		protected readonly inspector: Inspector,
		protected readonly save: Save
	) {
		this.window = new Adw.ApplicationWindow(application);
		this.window.setTitle(text('inspector.title', { name: save.name }));
		this.window.setDefaultSize(720, 860);

		const switcher = new Adw.ViewSwitcher();
		switcher.setStack(this.stack);
		switcher.setPolicy(Adw.ViewSwitcherPolicy.wide);
		const header = new Adw.HeaderBar();
		header.setTitleWidget(switcher);
		this.toolbar.addTopBar(header);

		const loading = new Gtk.Box(Gtk.Orientation.vertical, 12);
		loading.setValign(Gtk.Align.center);
		loading.append(new Adw.Spinner());
		loading.append(label(text('inspector.loading'), 'dim-label'));
		loading.getLastChild()!.setHalign(Gtk.Align.center);
		this.toolbar.setContent(loading);
		this.window.setContent(this.toolbar);

		const hold = keepAlive();
		connect(this.window, 'close-request', () => hold.release());
		setTimeout(() => this.load(), loadDelay);
	}

	protected load(): void {
		let inspection: Inspection;
		try {
			inspection = this.inspector.open(this.save.path);
		} catch (error) {
			const status = new Adw.StatusPage();
			status.setIconName('dialog-error-symbolic');
			status.setTitle(text('inspector.error'));
			status.setDescription(io.errorText(error));
			this.toolbar.setContent(status);
			return;
		}

		this.stack.addTitledWithIcon(
			this.overview(inspection),
			'overview',
			text('inspector.overview'),
			'view-list-bullet-symbolic'
		);
		this.stack.addTitledWithIcon(
			this.contents(inspection),
			'contents',
			text('inspector.contents'),
			'view-list-symbolic'
		);
		this.toolbar.setContent(this.stack);
	}

	/** The save's screenshot, name and time, at the top of the overview */
	protected banner(): Gtk.Widget {
		const banner = new Gtk.Box(Gtk.Orientation.horizontal, 16);
		if (this.save.screenshot) {
			const picture = Gtk.Picture.newForPaintable(screenshotTexture(this.save));
			picture.setSizeRequest(192, 108);
			picture.setContentFit(Gtk.ContentFit.cover);
			picture.setOverflow(Gtk.Overflow.hidden);
			picture.addCssClass('card');
			banner.append(picture);
		}
		const info = new Gtk.Box(Gtk.Orientation.vertical, 4);
		info.setValign(Gtk.Align.center);
		const title = label(this.save.label || this.save.name, 'title-2');
		title.setWrap(true);
		info.append(title);
		info.append(
			label([hoursAndMinutes(this.save.playTime), ...this.save.highlights].join(text('card.separator')), 'accent')
		);
		info.append(label([this.save.name, shortDate(this.save.time)].join(text('card.separator')), 'dim-label'));
		banner.append(info);
		return banner;
	}

	protected overview(inspection: Inspection): Gtk.Widget {
		const page = new Adw.PreferencesPage();
		const top = new Adw.PreferencesGroup();
		top.add(this.banner());
		page.add(top);

		for (const [name, section] of Object.entries(this.inspector.sections)) {
			const group = new Adw.PreferencesGroup();
			group.setTitle(section.title);
			group.setDescription(section.description);
			try {
				const rows = inspection.section(name);
				if (!rows.length) continue;
				for (const row of rows) group.add(rowWidget(row));
			} catch (error) {
				group.add(rowWidget({ label: text('inspector.error'), detail: io.errorText(error) }));
			}
			page.add(group);
		}
		return page;
	}

	protected contents(inspection: Inspection): Gtk.Widget {
		const scroll = new Gtk.ScrolledWindow();
		scroll.setPolicy(Gtk.PolicyType.automatic, Gtk.PolicyType.automatic);
		const list = entryList(inspection.contents());
		list.setMarginTop(12);
		list.setMarginBottom(12);
		list.setMarginEnd(12);
		list.addCssClass('monospace');
		scroll.setChild(list);
		return scroll;
	}
}
