import { connect, keepAlive, once } from 'girbind';
import * as io from 'ioium';
import { basename } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gio from '../../native/gio.js';
import * as Gtk from '../../native/gtk.js';
import * as Pango from '../../native/pango.js';
import type { Archive } from '../archive.js';
import { parseEditValue, type Edit, type EditValue } from '../editing.js';
import { formatValue, hoursAndMinutes, shortDate } from '../format.js';
import type { Inspector } from '../games/index.js';
import { text } from '../i18n.js';
import type { Entry, Inspection, Row } from '../inspection.js';
import type { Save } from '../save.js';
import { screenshotTexture } from './screenshots.js';

/** How long to wait after the window appears before reading the save, in milliseconds */
const loadDelay = 50;

type View = 'overview' | 'contents';

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

/** Runs `populate` the first time a widget is expanded */
function whenExpanded(widget: Adw.ExpanderRow | Gtk.Expander, populate: () => void): void {
	void once(widget, 'notify::expanded').then(populate);
}

/** A value that can be changed, shown as text until it is allowed to be */
class ValueEditor extends Gtk.Stack {
	protected readonly entry?: Gtk.Entry;
	protected readonly toggle?: Gtk.Switch;

	public constructor(
		protected readonly edit: Edit,
		protected readonly display: Gtk.Label,
		/** Formats the value for `display` */
		protected readonly format: (value: EditValue) => string,
		protected readonly onChange: () => void,
		protected readonly onError: (message: string) => void
	) {
		super();
		this.setHhomogeneous(false);
		this.setValign(Gtk.Align.center);
		this.addNamed(display, 'view');

		if (typeof edit.value == 'boolean') {
			this.toggle = new Gtk.Switch();
			this.toggle.setActive(edit.value);
			this.toggle.setValign(Gtk.Align.center);
			this.toggle.setHalign(Gtk.Align.end);
			connect(this.toggle, 'state-set', (_, state) => {
				if (state !== edit.value) this.commit(state);
				return false;
			});
			this.addNamed(this.toggle, 'edit');
			return;
		}

		this.entry = new Gtk.Entry();
		this.entry.setText(String(edit.value));
		this.entry.setWidthChars(typeof edit.value == 'string' ? 24 : 14);
		if (typeof edit.value != 'string') this.entry.setAlignment(1);
		this.entry.setValign(Gtk.Align.center);
		connect(this.entry, 'activate', () => this.commitText());
		const focus = new Gtk.EventControllerFocus();
		connect(focus, 'leave', () => this.commitText());
		this.entry.addController(focus);
		this.addNamed(this.entry, 'edit');
	}

	/** Show the editor if the value can be changed in the current mode, and the value otherwise */
	public setMode(expert: boolean): void {
		this.setVisibleChildName(this.edit.safe || expert ? 'edit' : 'view');
	}

	protected commitText(): void {
		const input = this.entry!.getText();
		if (input == String(this.edit.value)) return;
		try {
			this.commit(parseEditValue(this.edit, input));
		} catch (error) {
			this.entry!.addCssClass('error');
			this.onError(io.errorText(error));
		}
	}

	protected commit(value: EditValue): void {
		try {
			this.edit.set(value);
			this.entry?.removeCssClass('error');
			this.display.setLabel(this.format(this.edit.value));
			this.onChange();
		} catch (error) {
			this.onError(io.errorText(error));
			this.entry?.addCssClass('error');
			this.toggle?.setActive(this.edit.value as boolean);
		}
	}
}

/**
 * Shows what is in a save, with the game's sections in an overview and everything else in its contents.
 * Values that can be changed have editors, which are written to a copy of the save unless the original is overwritten.
 */
export class InspectorWindow extends Adw.ApplicationWindow {
	protected readonly stack = new Adw.ViewStack();
	protected readonly toolbar = new Adw.ToolbarView();
	protected readonly toasts = new Adw.ToastOverlay();
	protected readonly views: Record<View, Adw.Bin> = { overview: new Adw.Bin(), contents: new Adw.Bin() };
	protected readonly editors: Record<View, ValueEditor[]> = { overview: [], contents: [] };
	/** Views that show values from before the latest change, which are rebuilt when they are next shown */
	protected readonly stale = new Set<View>();
	protected readonly expertSwitch = new Gtk.Switch();
	protected readonly expertBox = new Gtk.Box(Gtk.Orientation.horizontal, 8);
	protected readonly saveButton = new Adw.SplitButton();
	protected inspection?: Inspection;
	protected building: View = 'overview';
	protected expert = false;
	protected hasChanges = false;
	/** Where this window's copy of the save is, once it has made one */
	protected copyPath?: string;

	public constructor(
		application: Adw.Application,
		protected readonly inspector: Inspector,
		protected readonly save: Save,
		/** For games whose saves can be archived, so the original is archived before it is overwritten */
		protected readonly archive?: Archive
	) {
		super();
		this.setApplication(application);
		this.setTitle(text('inspector.title', { name: save.name }));
		this.setDefaultSize(760, 860);

		const switcher = new Adw.ViewSwitcher();
		switcher.setStack(this.stack);
		switcher.setPolicy(Adw.ViewSwitcherPolicy.wide);
		const header = new Adw.HeaderBar();
		header.setTitleWidget(switcher);
		header.packStart(this.expertToggle());
		header.packEnd(this.saveMenu());
		this.toolbar.addTopBar(header);

		const loading = new Gtk.Box(Gtk.Orientation.vertical, 12);
		loading.setValign(Gtk.Align.center);
		loading.append(new Adw.Spinner());
		loading.append(label(text('inspector.loading'), 'dim-label'));
		loading.getLastChild()!.setHalign(Gtk.Align.center);
		this.toolbar.setContent(loading);
		this.toasts.setChild(this.toolbar);
		this.setContent(this.toasts);

		const hold = keepAlive();
		const timer = setTimeout(() => this.load(), loadDelay);
		connect(this as Adw.ApplicationWindow, 'close-request', () => {
			if (this.hasChanges) {
				this.confirmDiscard();
				return true;
			}
			hold.release();
			clearTimeout(timer);
			return false;
		});
	}

	protected get canEdit(): boolean {
		return !!this.inspection?.write && !!this.inspector.copy && this.save.inGame !== false;
	}

	protected toast(title: string): void {
		this.toasts.addToast(new Adw.Toast(title));
	}

	protected expertToggle(): Gtk.Widget {
		const expertLabel = label(text('editor.expert'));
		this.expertBox.append(expertLabel);
		this.expertBox.append(this.expertSwitch);
		this.expertBox.setTooltipText(text('editor.expert_tooltip'));
		this.expertSwitch.setValign(Gtk.Align.center);
		this.expertBox.setVisible(false);
		connect(this.expertSwitch, 'notify::active', () => {
			this.expert = this.expertSwitch.getActive();
			for (const editor of [...this.editors.overview, ...this.editors.contents]) editor.setMode(this.expert);
		});
		return this.expertBox;
	}

	protected saveMenu(): Gtk.Widget {
		const menu = new Gio.Menu();
		menu.append(text('editor.overwrite'), 'inspector.overwrite');
		const actions = new Gio.SimpleActionGroup();
		const overwrite = new Gio.SimpleAction('overwrite', null);
		connect(overwrite, 'activate', () => this.confirmSave(true));
		actions.addAction(overwrite);
		this.insertActionGroup('inspector', actions);

		this.saveButton.setLabel(text('editor.save_copy'));
		this.saveButton.setMenuModel(menu);
		this.saveButton.addCssClass('suggested-action');
		this.saveButton.setSensitive(false);
		this.saveButton.setVisible(false);
		connect(this.saveButton, 'clicked', () => this.confirmSave(false));
		return this.saveButton;
	}

	protected load(): void {
		try {
			this.inspection = this.inspector.open(this.save.path);
		} catch (error) {
			const status = new Adw.StatusPage();
			status.setIconName('dialog-error-symbolic');
			status.setTitle(text('inspector.error'));
			status.setDescription(io.errorText(error));
			this.toolbar.setContent(status);
			return;
		}

		this.expertBox.setVisible(this.canEdit);
		this.saveButton.setVisible(this.canEdit);
		if (this.inspection.write && this.save.inGame === false) {
			const banner = new Adw.Banner(text('editor.archived'));
			banner.setRevealed(true);
			this.toolbar.addTopBar(banner);
		}

		this.rebuild('overview');
		this.rebuild('contents');
		this.stack.addTitledWithIcon(
			this.views.overview,
			'overview',
			text('inspector.overview'),
			'view-list-bullet-symbolic'
		);
		this.stack.addTitledWithIcon(this.views.contents, 'contents', text('inspector.contents'), 'view-list-symbolic');
		connect(this.stack, 'notify::visible-child-name', () => {
			const view = this.stack.getVisibleChildName() as View;
			if (this.stale.delete(view)) this.rebuild(view);
		});
		this.toolbar.setContent(this.stack);
	}

	protected rebuild(view: View): void {
		this.building = view;
		this.editors[view] = [];
		this.views[view].setChild(
			view == 'overview' ? this.overview(this.inspection!) : this.contents(this.inspection!)
		);
	}

	/** A widget showing a value, with an editor for it if it can be changed */
	protected valueWidget(
		display: Gtk.Label,
		edit: Edit | undefined,
		format: (value: EditValue) => string
	): Gtk.Widget {
		if (!edit || !this.canEdit) return display;
		const view = this.building;
		const editor = new ValueEditor(
			edit,
			display,
			format,
			() => this.changed(view),
			message => this.toast(message)
		);
		editor.setMode(this.expert);
		this.editors[view].push(editor);
		return editor;
	}

	protected changed(view: View): void {
		this.hasChanges = true;
		this.saveButton.setSensitive(true);
		this.stale.add(view == 'overview' ? 'contents' : 'overview');
	}

	/** A row in the overview, whose child rows are only created once it is expanded */
	protected rowWidget(row: Row): Gtk.Widget {
		const format = (value: EditValue) => (typeof value == 'string' ? value : formatValue(value));
		const value =
			row.value === undefined && !row.edit
				? undefined
				: this.valueWidget(valueLabel(row.value ?? format(row.edit!.value)), row.edit, format);

		if (!row.rows?.length) {
			const widget = new Adw.ActionRow();
			widget.setUseMarkup(false);
			widget.setTitle(row.label);
			if (row.detail) widget.setSubtitle(row.detail);
			if (value) widget.addSuffix(value);
			return widget;
		}

		const widget = new Adw.ExpanderRow();
		widget.setUseMarkup(false);
		widget.setTitle(row.label);
		if (row.detail) widget.setSubtitle(row.detail);
		if (value) widget.addSuffix(value);
		const view = this.building;
		whenExpanded(widget, () => {
			this.building = view;
			for (const child of row.rows!) widget.addRow(this.rowWidget(child));
		});
		return widget;
	}

	/** An entry in the contents, like HTML's `<details>`, whose children are only read once it is expanded */
	protected entryWidget(entry: Entry): Gtk.Widget {
		const heading = new Gtk.Box(Gtk.Orientation.horizontal, 12);
		heading.append(label(entry.name));
		const summary = label(entry.summary, 'dim-label');
		summary.setEllipsize(Pango.EllipsizeMode.end);

		if (!entry.children) {
			heading.setMarginStart(22);
			summary.setSelectable(true);
			heading.append(
				this.valueWidget(summary, entry.edit, value =>
					typeof value == 'string' ? JSON.stringify(value) : String(value)
				)
			);
			return heading;
		}

		heading.append(summary);
		const expander = new Gtk.Expander(null);
		expander.setLabelWidget(heading);
		whenExpanded(expander, () => {
			this.building = 'contents';
			expander.setChild(this.entryList(entry));
		});
		return expander;
	}

	protected entryList(entry: Entry): Gtk.Widget {
		const list = new Gtk.Box(Gtk.Orientation.vertical, 4);
		list.setMarginStart(18);
		list.setMarginTop(4);
		try {
			for (const child of entry.children?.() ?? []) list.append(this.entryWidget(child));
		} catch (error) {
			list.append(label(io.errorText(error), 'error'));
		}
		return list;
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
				for (const row of rows) group.add(this.rowWidget(row));
			} catch (error) {
				group.add(this.rowWidget({ label: text('inspector.error'), detail: io.errorText(error) }));
			}
			page.add(group);
		}
		return page;
	}

	protected contents(inspection: Inspection): Gtk.Widget {
		const scroll = new Gtk.ScrolledWindow();
		scroll.setPolicy(Gtk.PolicyType.automatic, Gtk.PolicyType.automatic);
		const list = this.entryList(inspection.contents());
		list.setMarginTop(12);
		list.setMarginBottom(12);
		list.setMarginEnd(12);
		list.addCssClass('monospace');
		scroll.setChild(list);
		return scroll;
	}

	/** Warn that edited saves can break, then write the changes */
	protected confirmSave(overwrite: boolean): void {
		const name = this.save.label || this.save.name;
		const dialog = new Adw.AlertDialog(
			text('editor.warning.heading'),
			overwrite
				? text(this.archive ? 'editor.warning.overwrite_archived' : 'editor.warning.overwrite', { name })
				: text('editor.warning.copy', { name })
		);
		dialog.addResponse('cancel', text('editor.warning.cancel'));
		dialog.addResponse('save', text(overwrite ? 'editor.overwrite' : 'editor.save_copy'));
		dialog.setResponseAppearance(
			'save',
			overwrite ? Adw.ResponseAppearance.destructive : Adw.ResponseAppearance.suggested
		);
		dialog.setDefaultResponse('cancel');
		dialog.setCloseResponse('cancel');
		connect(dialog, 'response', (_, response) => {
			if (response == 'save') this.write(overwrite);
		});
		dialog.present(this);
	}

	/** Write the changes to this window's copy of the save, making it first, or over the original */
	protected write(overwrite: boolean): void {
		try {
			if (overwrite) this.archive?.add(this.save);
			const target = overwrite ? this.save.path : (this.copyPath ??= this.inspector.copy!(this.save.path));
			this.inspection!.write!(target);
			this.hasChanges = false;
			this.saveButton.setSensitive(false);
			this.toast(
				overwrite ? text('editor.saved_original') : text('editor.saved_copy', { name: basename(target) })
			);
		} catch (error) {
			this.toast(io.errorText(error));
		}
	}

	protected confirmDiscard(): void {
		const dialog = new Adw.AlertDialog(text('editor.discard.heading'), text('editor.discard.body'));
		dialog.addResponse('cancel', text('editor.discard.cancel'));
		dialog.addResponse('discard', text('editor.discard.confirm'));
		dialog.setResponseAppearance('discard', Adw.ResponseAppearance.destructive);
		dialog.setDefaultResponse('cancel');
		dialog.setCloseResponse('cancel');
		connect(dialog, 'response', (_, response) => {
			if (response != 'discard') return;
			this.hasChanges = false;
			this.close();
		});
		dialog.present(this);
	}
}
