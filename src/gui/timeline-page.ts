import { connect, disconnect } from 'girbind';
import * as io from 'ioium';
import { statSync, watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gdk from '../../native/gdk.js';
import * as Gio from '../../native/gio.js';
import * as Gtk from '../../native/gtk.js';
import type { SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import type { Save } from '../save.js';
import { Timeline, type TimelineNode } from '../timeline.js';
import type { Point } from '../viewport.js';
import { shortDate } from './format.js';
import { SaveCard, type CardAction } from './save-card.js';
import { TimelineView } from './timeline-view.js';

/** Delay before reloading after the save directory changes, in milliseconds */
const reloadDelay = 1000;

/** The most playthroughs shown as tabs, beyond which they are listed in a sidebar */
const maxTabs = 4;

/** The most recently made save of a timeline */
function latest(timeline: Timeline): Save {
	return timeline.nodes.reduce(
		(latest, node) => (node.save.time.epochNanoseconds > latest.time.epochNanoseconds ? node.save : latest),
		timeline.nodes[0].save
	);
}

/** Shows the timelines of one game's playthroughs, with the hovered or selected save's details below them. */
export class TimelinePage {
	public readonly page: Adw.NavigationPage;
	protected readonly stack = new Adw.ViewStack();
	protected readonly header = new Adw.HeaderBar();
	protected readonly switcher = new Adw.ViewSwitcher();
	protected readonly title: Adw.WindowTitle;
	protected readonly split = new Adw.OverlaySplitView();
	protected readonly sidebar = new Gtk.ListBox();
	protected readonly card: SaveCard;
	protected readonly actions: CardAction[];
	protected readonly menu = new Gio.Menu();
	protected readonly menuActions = new Map<CardAction, Gio.SimpleAction>();

	protected views: TimelineView[] = [];
	protected readonly popovers = new Map<TimelineView, Gtk.PopoverMenu>();
	protected hovered?: Save;
	protected selected?: Save;
	/** The save a context menu was opened for */
	protected target?: Save;
	protected watcher?: FSWatcher;
	protected reloadTimer?: NodeJS.Timeout;
	protected styleHandler: number;

	protected get game() {
		return this.location.game;
	}

	protected get directory() {
		return this.location.directory;
	}

	public constructor(
		protected readonly location: SaveLocation,
		protected readonly toast: (title: string) => void
	) {
		const { game } = location;
		this.actions = [
			...game.actions,
			{ id: 'open', label: text('action.open'), canRun: () => true },
			{ id: 'delete', label: text('action.delete'), isDestructive: true, canRun: () => true },
		];

		this.card = new SaveCard(game, this.actions);
		this.card.onAction = (id, save) => this.run(id, save);

		const group = new Gio.SimpleActionGroup();
		for (const action of this.actions) {
			this.menu.append(action.label, `save.${action.id}`);
			const menuAction = new Gio.SimpleAction(action.id, null);
			connect(menuAction, 'activate', () => this.target && this.run(action.id, this.target));
			group.addAction(menuAction);
			this.menuActions.set(action, menuAction);
		}

		this.switcher.setStack(this.stack);
		this.switcher.setPolicy(Adw.ViewSwitcherPolicy.wide);
		this.title = new Adw.WindowTitle(game.name, '');

		const content = new Gtk.Box(Gtk.Orientation.vertical, 0);
		this.stack.setVexpand(true);
		content.append(this.stack);
		content.append(new Gtk.Separator(Gtk.Orientation.horizontal));
		content.append(this.card.widget);

		this.sidebar.addCssClass('navigation-sidebar');
		connect(this.sidebar, 'row-selected', (_, row) => {
			const view = row && this.views[row.getIndex()];
			if (view) this.stack.setVisibleChild(view.widget);
		});
		connect(this.stack, 'notify::visible-child', () => {
			this.updateTitle();
			this.selectOnlySave();
		});
		const sidebarScroll = new Gtk.ScrolledWindow();
		sidebarScroll.setPolicy(Gtk.PolicyType.never, Gtk.PolicyType.automatic);
		sidebarScroll.setChild(this.sidebar);
		this.split.setSidebar(sidebarScroll);
		this.split.setContent(content);

		const toolbar = new Adw.ToolbarView();
		toolbar.addTopBar(this.header);
		toolbar.setContent(this.split);
		this.page = new Adw.NavigationPage(toolbar, game.name);
		this.page.insertActionGroup('save', group);

		const styles = Adw.StyleManager.getDefault();
		this.styleHandler = connect(styles, 'notify::dark', () => this.views.forEach(view => view.render()));

		this.reload();
		this.watch();
	}

	/** Stop watching for changes, once the page is closed. */
	public dispose(): void {
		this.watcher?.close();
		clearTimeout(this.reloadTimer);
		disconnect(Adw.StyleManager.getDefault(), this.styleHandler);
	}

	protected watch(): void {
		try {
			this.watcher = watch(this.directory, { recursive: true }, () => {
				clearTimeout(this.reloadTimer);
				this.reloadTimer = setTimeout(() => this.reload(), reloadDelay);
			});
		} catch (error) {
			io.warn(`Not watching ${this.directory} for changes: ${io.errorText(error)}`);
		}
	}

	/** Rescan the saves and update every timeline in place, keeping each one's zoom and the selection. */
	public reload(): void {
		const timelines = Timeline.fromSaves(this.game.scan(this.directory)).toSorted((a, b) =>
			Temporal.ZonedDateTime.compare(latest(b).time, latest(a).time)
		);
		const previous = new Map(this.views.map(view => [view.timeline.playthrough, view]));

		this.views = timelines.map(timeline => {
			const view = previous.get(timeline.playthrough);
			if (!view) return this.createView(timeline);
			previous.delete(timeline.playthrough);
			view.setTimeline(timeline);
			this.stack.getPage(view.widget).setTitle(this.game.describe(timeline));
			return view;
		});

		for (const view of previous.values()) {
			this.stack.remove(view.widget);
			this.popovers.get(view)?.unparent();
			this.popovers.delete(view);
		}

		this.hovered = undefined;
		this.selected =
			this.selected && this.views.map(view => view.timeline.find(this.selected!.id)?.save).find(Boolean);
		this.card.show(this.selected);
		this.updateSidebar();
		this.updateTitle();
		this.selectOnlySave();
	}

	protected get visibleView(): TimelineView | undefined {
		const visible = this.stack.getVisibleChild();
		return this.views.find(view => view.widget === visible);
	}

	/** Select the save of a playthrough with only one, since there is nothing else to pick. */
	protected selectOnlySave(): void {
		const nodes = this.visibleView?.timeline.nodes ?? [];
		if (nodes.length == 1) this.visibleView!.select(nodes[0]);
	}

	/** List the playthroughs in the sidebar, which is only shown when there are too many for tabs. */
	protected updateSidebar(): void {
		const visible = this.visibleView;
		this.sidebar.removeAll();
		for (const view of this.views) {
			const row = new Adw.ActionRow();
			row.setUseMarkup(false);
			row.setTitle(this.game.describe(view.timeline));
			row.setSubtitle(
				text('sidebar.subtitle', {
					saves: text('common.saves', { count: view.timeline.nodes.length }),
					time: shortDate(latest(view.timeline).time),
				})
			);
			this.sidebar.append(row);
		}
		const index = visible ? this.views.indexOf(visible) : 0;
		this.sidebar.selectRow(this.sidebar.getRowAtIndex(Math.max(0, index)));
		this.split.setShowSidebar(this.views.length > maxTabs);
	}

	/** Show tabs for switching between a few playthroughs, or the game's name and the current playthrough otherwise. */
	protected updateTitle(): void {
		if (this.views.length > 1 && this.views.length <= maxTabs) {
			this.header.setTitleWidget(this.switcher);
			return;
		}
		const view = this.visibleView;
		this.title.setSubtitle(view ? this.game.describe(view.timeline) : '');
		this.header.setTitleWidget(this.title);
	}

	protected createView(timeline: Timeline): TimelineView {
		const view = new TimelineView(timeline);
		this.stack.addTitledWithIcon(
			view.widget,
			timeline.playthrough,
			this.game.describe(timeline),
			'avatar-default-symbolic'
		);

		view.onHover = node => {
			this.hovered = node?.save;
			this.card.show(this.hovered ?? this.selected);
		};
		view.onSelect = node => {
			this.selected = node?.save;
			this.card.show(this.hovered ?? this.selected);
		};

		const popover = Gtk.PopoverMenu.newFromModelFull(this.menu, Gtk.PopoverMenuFlags.nested);
		popover.setParent(view.widget);
		popover.setHasArrow(false);
		this.popovers.set(view, popover);
		view.onContextMenu = (node, position) => this.showMenu(popover, node, position);

		return view;
	}

	protected showMenu(popover: Gtk.PopoverMenu, node: TimelineNode, { x, y }: Point): void {
		this.target = node.save;
		for (const [action, menuAction] of this.menuActions) menuAction.setEnabled(action.canRun(node.save));
		const pointer = new Gdk.Rectangle();
		pointer.x = Math.round(x);
		pointer.y = Math.round(y);
		pointer.width = 1;
		pointer.height = 1;
		popover.setPointingTo(pointer);
		popover.popup();
	}

	protected run(id: string, save: Save): void {
		if (id == 'delete') return this.confirmDelete(save);
		try {
			if (id == 'open') {
				const folder = statSync(save.path).isDirectory() ? save.path : dirname(save.path);
				Gio.AppInfo.launchDefaultForUri(Gio.File.newForPath(folder).getUri(), null);
				return;
			}
			const action = this.game.actions.find(action => action.id == id);
			if (!action) throw new Error(`Unknown action: ${id}`);
			action.run(save);
			this.toast(text('action.done', { action: action.label, name: save.name }));
			this.reload();
		} catch (error) {
			this.toast(io.errorText(error));
		}
	}

	protected confirmDelete(save: Save): void {
		const dialog = new Adw.AlertDialog(
			text('delete.heading', { name: save.name }),
			text('delete.body', { label: save.label || save.name })
		);
		dialog.addResponse('cancel', text('delete.cancel'));
		dialog.addResponse('delete', text('delete.confirm'));
		dialog.setResponseAppearance('delete', Adw.ResponseAppearance.destructive);
		dialog.setDefaultResponse('cancel');
		dialog.setCloseResponse('cancel');
		connect(dialog, 'response', (_, response) => {
			if (response != 'delete') return;
			try {
				for (const path of [save.path, ...(save.companions ?? [])]) Gio.File.newForPath(path).trash(null);
				this.toast(text('delete.done', { name: save.name }));
				if (this.selected === save) this.selected = undefined;
				this.reload();
			} catch (error) {
				this.toast(io.errorText(error));
			}
		});
		dialog.present(this.page);
	}
}
