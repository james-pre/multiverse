import { connect } from 'girbind';
import * as io from 'ioium';
import { watch, type FSWatcher } from 'node:fs';
import * as Adw from '../../native/adw.js';
import * as Gdk from '../../native/gdk.js';
import * as Gio from '../../native/gio.js';
import * as Gtk from '../../native/gtk.js';
import type { Game } from '../games/index.js';
import { text } from '../i18n.js';
import type { Save } from '../save.js';
import { Timeline, type TimelineNode } from '../timeline.js';
import type { Point } from '../viewport.js';
import { SaveCard, type CardAction } from './save-card.js';
import { TimelineView } from './timeline-view.js';

/** Delay before reloading after the save directory changes, in milliseconds */
const reloadDelay = 1000;

export class MainWindow {
	public readonly window: Adw.ApplicationWindow;
	protected readonly stack = new Adw.ViewStack();
	protected readonly toasts = new Adw.ToastOverlay();
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

	public constructor(
		application: Adw.Application,
		protected readonly game: Game,
		protected readonly directory: string
	) {
		this.window = new Adw.ApplicationWindow(application);
		this.window.setTitle(text('app.title'));
		this.window.setDefaultSize(1280, 720);

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
		this.window.insertActionGroup('save', group);

		const switcher = new Adw.ViewSwitcher();
		switcher.setStack(this.stack);
		switcher.setPolicy(Adw.ViewSwitcherPolicy.wide);

		const header = new Adw.HeaderBar();
		header.setTitleWidget(switcher);

		const content = new Gtk.Box(Gtk.Orientation.vertical, 0);
		this.stack.setVexpand(true);
		content.append(this.stack);
		content.append(new Gtk.Separator(Gtk.Orientation.horizontal));
		content.append(this.card.widget);
		this.toasts.setChild(content);

		const toolbar = new Adw.ToolbarView();
		toolbar.addTopBar(header);
		toolbar.setContent(this.toasts);
		this.window.setContent(toolbar);

		connect(Adw.StyleManager.getDefault(), 'notify::dark', () => this.views.forEach(view => view.render()));
		connect(this.window, 'close-request', () => {
			this.watcher?.close();
			clearTimeout(this.reloadTimer);
		});

		this.reload();
		this.watch();
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
		const timelines = Timeline.fromSaves(this.game.scan(this.directory)).toSorted((a, b) => b.end - a.end);
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
	}

	protected createView(timeline: Timeline): TimelineView {
		const view = new TimelineView(timeline);
		this.stack.addTitled(view.widget, timeline.playthrough, this.game.describe(timeline));

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

	protected toast(title: string): void {
		this.toasts.addToast(new Adw.Toast(title));
	}

	protected run(id: string, save: Save): void {
		if (id == 'delete') return this.confirmDelete(save);
		try {
			if (id == 'open') {
				Gio.AppInfo.launchDefaultForUri(Gio.File.newForPath(save.path).getUri(), null);
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
				Gio.File.newForPath(save.path).trash(null);
				this.toast(text('delete.done', { name: save.name }));
				if (this.selected === save) this.selected = undefined;
				this.reload();
			} catch (error) {
				this.toast(io.errorText(error));
			}
		});
		dialog.present(this.window);
	}
}
