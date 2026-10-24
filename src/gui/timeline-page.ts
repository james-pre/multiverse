import { connect, disconnect } from 'girbind';
import * as io from 'ioium';
import { mkdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import * as Adw from '../../native/adw.js';
import * as Gdk from '../../native/gdk.js';
import * as Gio from '../../native/gio.js';
import * as Gtk from '../../native/gtk.js';
import { Archive } from '../archive.js';
import type { SaveLocation } from '../games/index.js';
import { text } from '../i18n.js';
import type { Save } from '../save.js';
import { Timeline, type TimelineNode } from '../timeline.js';
import type { Point } from '../viewport.js';
import { shortDate } from '../format.js';
import { menuButton } from './preferences.js';
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
	protected readonly archive?: Archive;
	protected watchers: FSWatcher[] = [];
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
		protected readonly toast: (title: string) => void,
		protected readonly inspect: (save: Save) => void
	) {
		const { game } = location;
		if (game.archive) this.archive = new Archive(location);
		this.actions = [
			...(game.inspector ? [{ id: 'inspect', label: text('action.inspect'), canRun: () => true }] : []),
			...(this.archive ? this.archiveActions() : []),
			...game.actions,
			{ id: 'open', label: text('action.open'), canRun: () => true },
			{ id: 'delete', label: text('action.delete'), isDestructive: true, canRun: () => true },
		];

		this.card = new SaveCard(game, this.actions);
		this.card.onAction = (id, save) => this.run(id, save);
		this.card.onToggleInGame = (save, inGame) => this.run(inGame ? 'put_in_game' : 'remove_from_game', save);

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
			if (view) this.stack.setVisibleChild(view);
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

		this.header.packEnd(menuButton());
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

	/** Stop watching for changes and free the timelines, once the page is closed. */
	public dispose(): void {
		for (const watcher of this.watchers) watcher.close();
		clearTimeout(this.reloadTimer);
		disconnect(Adw.StyleManager.getDefault(), this.styleHandler);
		for (const view of this.views) this.disposeView(view);
	}

	/** Remove and free a view, since its event handlers would otherwise keep it alive. */
	protected disposeView(view: TimelineView): void {
		this.stack.remove(view);
		this.popovers.get(view)?.unparent();
		this.popovers.delete(view);
		view.dispose();
	}

	protected archiveActions(): CardAction[] {
		return [
			{ id: 'archive', label: text('action.archive'), canRun: save => !!save.inGame && !save.archived },
			{ id: 'put_in_game', label: text('action.put_in_game'), menuOnly: true, canRun: save => !save.inGame },
			{
				id: 'remove_from_game',
				label: text('action.remove_from_game'),
				menuOnly: true,
				canRun: save => !!save.inGame,
			},
		];
	}

	/** Reload when the saves or the archive change, such as when the game saves. */
	protected watch(): void {
		const directories = [this.directory];
		if (this.archive) {
			mkdirSync(this.archive.directory, { recursive: true });
			directories.push(this.archive.directory);
		}
		for (const directory of directories) {
			try {
				const watcher = watch(directory, { recursive: true }, () => {
					clearTimeout(this.reloadTimer);
					this.reloadTimer = setTimeout(() => this.reload(), reloadDelay);
				});
				this.watchers.push(watcher);
			} catch (error) {
				io.warn(`Not watching ${directory} for changes: ${io.errorText(error)}`);
			}
		}
	}

	/** Rescan the saves and update every timeline in place, keeping each one's zoom and the selection. */
	public reload(): void {
		const saves = this.archive?.scan() ?? this.game.scan(this.directory);
		const timelines = Timeline.fromSaves(saves).toSorted((a, b) =>
			Temporal.ZonedDateTime.compare(latest(b).time, latest(a).time)
		);
		const previous = new Map(this.views.map(view => [view.timeline.playthrough, view]));

		this.views = timelines.map(timeline => {
			const view = previous.get(timeline.playthrough);
			if (!view) return this.createView(timeline);
			previous.delete(timeline.playthrough);
			view.setTimeline(timeline);
			this.stack.getPage(view).setTitle(this.game.describe(timeline));
			return view;
		});

		for (const view of previous.values()) this.disposeView(view);

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
		return this.views.find(view => view === visible);
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
			view,
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
		popover.setParent(view);
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
		if (id == 'inspect') return this.inspect(save);
		try {
			if (this.archive && this.runArchiveAction(this.archive, id, save)) {
				this.reload();
				return;
			}
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
			this.card.show(this.hovered ?? this.selected);
		}
	}

	/** Run an action on the archive, returning whether `id` is one */
	protected runArchiveAction(archive: Archive, id: string, save: Save): boolean {
		switch (id) {
			case 'archive':
				archive.add(save);
				this.toast(text('archive.done', { name: save.name }));
				return true;
			case 'put_in_game': {
				const replaced = archive.putInGame(save);
				this.toast(
					replaced
						? text('archive.replaced', { name: save.name, replaced: replaced.label || replaced.name })
						: text('archive.put', { name: save.name })
				);
				return true;
			}
			case 'remove_from_game':
				archive.removeFromGame(save);
				this.toast(text('archive.removed', { name: save.name }));
				return true;
		}
		return false;
	}

	protected confirmDelete(save: Save): void {
		const label = save.label || save.name;
		const dialog = new Adw.AlertDialog(
			text('delete.heading', { name: save.name }),
			save.archived ? text('delete.body_archived', { label }) : text('delete.body', { label })
		);
		dialog.addResponse('cancel', text('delete.cancel'));
		dialog.addResponse('delete', text('delete.confirm'));
		dialog.setResponseAppearance('delete', Adw.ResponseAppearance.destructive);
		dialog.setDefaultResponse('cancel');
		dialog.setCloseResponse('cancel');
		connect(dialog, 'response', (_, response) => {
			if (response != 'delete') return;
			try {
				const files = save.inGame === false ? [] : [save.path, ...(save.companions ?? [])];
				files.push(...(this.archive?.filesOf(save) ?? []));
				for (const path of files) Gio.File.newForPath(path).trash(null);
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
