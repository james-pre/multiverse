import { connect } from 'girbind';
import * as Adw from '../../native/adw.js';
import * as Gtk from '../../native/gtk.js';
import * as Pango from '../../native/pango.js';
import type { Game } from '../games/index.js';
import type { Save } from '../save.js';
import { text } from '../i18n.js';
import { formatValue, hoursAndMinutes, shortDate } from '../format.js';
import { screenshotTexture } from './screenshots.js';

export interface CardAction {
	id: string;
	label: string;
	isDestructive?: boolean;
	canRun(save: Save): boolean;
}

function label(cssClass?: string): Gtk.Label {
	const widget = new Gtk.Label(null);
	widget.setXalign(0);
	widget.setEllipsize(Pango.EllipsizeMode.end);
	if (cssClass) widget.addCssClass(cssClass);
	return widget;
}

/** Shows the hovered or selected save like a row in the game's save list, with buttons for its actions. */
export class SaveCard {
	public readonly widget = new Gtk.Stack();
	public onAction?: (id: string, save: Save) => void;

	protected save?: Save;
	protected readonly picture = new Gtk.Picture();
	protected readonly title = label('title-3');
	protected readonly summary = label('accent');
	protected readonly slot = label('dim-label');
	protected readonly details = label('dim-label');
	protected readonly buttons = new Map<CardAction, Gtk.Button>();

	public constructor(
		protected readonly game: Game,
		actions: CardAction[]
	) {
		const empty = new Gtk.Label(text('card.empty'));
		empty.addCssClass('dim-label');
		this.widget.addNamed(empty, 'empty');

		this.picture.setSizeRequest(192, 108);
		this.picture.setContentFit(Gtk.ContentFit.cover);
		this.picture.setOverflow(Gtk.Overflow.hidden);
		this.picture.addCssClass('card');

		const info = new Gtk.Box(Gtk.Orientation.vertical, 4);
		info.setHexpand(true);
		info.setValign(Gtk.Align.center);
		for (const widget of [this.title, this.summary, this.slot, this.details]) info.append(widget);

		const buttons = new Gtk.Box(Gtk.Orientation.vertical, 8);
		buttons.setValign(Gtk.Align.center);
		for (const action of actions) {
			const button = Gtk.Button.newWithLabel(action.label);
			if (action.isDestructive) button.addCssClass('destructive-action');
			connect(button, 'clicked', () => this.save && this.onAction?.(action.id, this.save));
			this.buttons.set(action, button);
			buttons.append(button);
		}

		const row = new Gtk.Box(Gtk.Orientation.horizontal, 16);
		// A picture asks for its screenshot's full size, so this keeps it thumbnail sized.
		const thumbnail = new Adw.Clamp();
		thumbnail.setMaximumSize(192);
		thumbnail.setTighteningThreshold(192);
		thumbnail.setChild(this.picture);
		for (const widget of [thumbnail, info, buttons]) row.append(widget);
		this.widget.addNamed(row, 'save');

		this.widget.setMarginTop(12);
		this.widget.setMarginBottom(12);
		this.widget.setMarginStart(12);
		this.widget.setMarginEnd(12);
	}

	public show(save: Save | undefined): void {
		this.save = save;
		if (!save) {
			this.widget.setVisibleChildName('empty');
			return;
		}

		this.picture.setPaintable(screenshotTexture(save));
		this.picture.setVisible(!!save.screenshot);
		this.title.setLabel(save.label || save.name);
		const separator = text('card.separator');
		this.summary.setLabel([hoursAndMinutes(save.playTime), ...save.highlights].join(separator));
		this.slot.setLabel([save.name, shortDate(save.time)].join(separator));
		this.details.setLabel(
			Object.entries(save.details)
				.map(([key, value]) => `${key}: ${formatValue(value)}`)
				.join(separator)
		);
		for (const [action, button] of this.buttons) button.setVisible(action.canRun(save));
		this.widget.setVisibleChildName('save');
	}
}
