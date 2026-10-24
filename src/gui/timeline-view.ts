import { connect } from 'girbind';
import * as Adw from '../../native/adw.js';
import * as Gdk from '../../native/gdk.js';
import * as Graphene from '../../native/graphene.js';
import * as Gsk from '../../native/gsk.js';
import * as Gtk from '../../native/gtk.js';
import * as Pango from '../../native/pango.js';
import { layoutTimeline } from '../layout.js';
import type { Timeline, TimelineNode } from '../timeline.js';
import { Viewport, type Point } from '../viewport.js';
import { hoursAndMinutes } from '../format.js';
import { escapeMarkup } from './format.js';
import { screenshotTexture } from './screenshots.js';

const kindColors: Record<string, string> = {
	manual: '#3584e4',
	auto: '#9a9996',
	quick: '#33d17a',
	'point of no return': '#e66100',
	'end game': '#c01c28',
};

/** Pango units per pixel */
const pangoScale = 1024;

const card = {
	width: 240,
	padding: 8,
	textHeight: 40,
	radius: 12,
	offset: 16,
};

function rgba(spec: string): Gdk.RGBA {
	const color = new Gdk.RGBA();
	color.parse(spec);
	return color;
}

function point({ x, y }: Point): Graphene.Point {
	return new Graphene.Point().init(x, y);
}

function rect(x: number, y: number, width: number, height: number): Graphene.Rect {
	return new Graphene.Rect().init(x, y, width, height);
}

function rounded(bounds: Graphene.Rect, radius: number): Gsk.RoundedRect {
	return new Gsk.RoundedRect().initFromRect(bounds, radius);
}

export interface Palette {
	foreground: Gdk.RGBA;
	branch: Gdk.RGBA;
	card: Gdk.RGBA;
	shadow: Gdk.RGBA;
	accent: Gdk.RGBA;
}

/** Colors for drawing over `widget`, following its theme. */
export function palette(widget: Gtk.Widget): Palette {
	const styles = Adw.StyleManager.getDefault();
	const dark = styles.getDark();
	const foreground = widget.getColor();
	const branch = foreground.copy();
	branch.alpha *= 0.6;
	return {
		foreground,
		branch,
		card: rgba(dark ? '#36363a' : '#ffffff'),
		shadow: rgba(dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 6, 0.25)'),
		accent: styles.getAccentColorRgba(),
	};
}

/** Draws one timeline and handles zooming, panning, hovering and selecting saves on it. */
export class TimelineView extends Gtk.Widget {
	public viewport: Viewport;

	public hovered?: TimelineNode;
	public selected?: TimelineNode;

	public onHover?: (node: TimelineNode | undefined) => void;
	public onSelect?: (node: TimelineNode | undefined) => void;
	public onContextMenu?: (node: TimelineNode, position: Point) => void;

	protected pointer: Point = { x: 0, y: 0 };
	protected dragged = 0;

	public constructor(public timeline: Timeline) {
		super();
		this.viewport = new Viewport(layoutTimeline(timeline));
		this.setHexpand(true);
		this.setVexpand(true);

		const motion = new Gtk.EventControllerMotion();
		connect(motion, 'motion', (_, x, y) => {
			this.pointer = { x, y };
			this.hover(this.viewport.hitTest(x, y));
		});
		connect(motion, 'leave', () => this.hover(undefined));

		const scroll = new Gtk.EventControllerScroll(Gtk.EventControllerScrollFlags.both_axes);
		connect(scroll, 'scroll', (_, x, y) => {
			if (y) this.viewport.zoom(Math.pow(1.1, -y), this.pointer.x);
			if (x) this.viewport.pan(-x * 20);
			this.render();
			return true;
		});

		const drag = new Gtk.GestureDrag();
		connect(drag, 'drag-begin', () => (this.dragged = 0));
		connect(drag, 'drag-update', (_, x) => {
			this.viewport.pan(x - this.dragged);
			this.dragged = x;
			this.render();
		});

		const click = new Gtk.GestureClick();
		click.setButton(0);
		connect(click, 'pressed', (self, _, x, y) => {
			const node = this.viewport.hitTest(x, y);
			if (self.getCurrentButton() == 3) {
				if (node) this.onContextMenu?.(node, { x, y });
				return;
			}
			if (node) this.select(node);
		});

		for (const controller of [motion, scroll, drag, click]) this.addController(controller);
	}

	public select(node: TimelineNode): void {
		if (node === this.selected) return;
		this.selected = node;
		this.onSelect?.(node);
		this.render();
	}

	/** Show an updated version of the timeline, keeping the zoom, hover and selection. */
	public setTimeline(timeline: Timeline): void {
		const previous = this.viewport;
		this.timeline = timeline;
		this.viewport = new Viewport(layoutTimeline(timeline));
		if (previous.width) {
			this.viewport.resize(previous.width, previous.height);
			this.viewport.match(previous);
		}
		this.hovered = this.hovered && timeline.find(this.hovered.save.id);
		this.selected = this.selected && timeline.find(this.selected.save.id);
		this.render();
	}

	public vfunc_measure(): [minimum: number, natural: number, minimumBaseline: number, naturalBaseline: number] {
		return [0, 0, -1, -1];
	}

	public vfunc_size_allocate(width: number, height: number): void {
		if (width != this.viewport.width || height != this.viewport.height) this.viewport.resize(width, height);
		// Popovers, like the context menu, are positioned by their parent.
		for (let child = this.getFirstChild(); child; child = child.getNextSibling()) {
			if (child instanceof Gtk.Popover) child.present();
		}
	}

	public vfunc_snapshot(snapshot: Gtk.Snapshot): void {
		const { width, height } = this.viewport;
		if (!width || !height) return;
		const colors = palette(this);
		this.drawBranches(snapshot, colors);
		this.drawSaves(snapshot, colors);
		if (this.hovered) this.drawCard(snapshot, this.hovered, colors);
	}

	protected hover(node: TimelineNode | undefined): void {
		if (node === this.hovered) return;
		this.hovered = node;
		this.onHover?.(node);
		this.render();
	}

	/** Draw the timeline again, such as after the theme changes */
	public render(): void {
		this.queueDraw();
	}

	protected drawBranches(snapshot: Gtk.Snapshot, colors: Palette): void {
		const builder = new Gsk.PathBuilder();
		for (const node of this.timeline.nodes) {
			if (!node.parent) continue;
			const from = this.viewport.position(node.parent);
			const to = this.viewport.position(node);
			builder.moveTo(from.x, from.y);
			const bend = Math.min(this.viewport.laneHeight, to.x - from.x);
			// GSK drops cubics narrower than about a pixel, so near-vertical branches are drawn straight.
			if (from.y != to.y && bend >= 1) {
				builder.cubicTo(from.x + bend / 2, from.y, from.x + bend / 2, to.y, from.x + bend, to.y);
			}
			builder.lineTo(to.x, to.y);
		}
		snapshot.appendStroke(builder.toPath(), new Gsk.Stroke(2), colors.branch);
	}

	protected drawSaves(snapshot: Gtk.Snapshot, colors: Palette): void {
		const nodesByKind = Map.groupBy(this.timeline.nodes, node => node.save.kind);
		for (const [kind, nodes] of nodesByKind) {
			const builder = new Gsk.PathBuilder();
			for (const node of nodes) {
				const radius = this.viewport.nodeRadius * (node === this.hovered ? 1.5 : 1);
				builder.addCircle(point(this.viewport.position(node)), radius);
			}
			snapshot.appendFill(builder.toPath(), Gsk.FillRule.winding, rgba(kindColors[kind] ?? '#77767b'));
		}

		if (!this.selected) return;
		const ring = new Gsk.PathBuilder();
		ring.addCircle(point(this.viewport.position(this.selected)), this.viewport.nodeRadius * 1.5 + 3);
		snapshot.appendStroke(ring.toPath(), new Gsk.Stroke(2), colors.accent);
	}

	/** Draws a card with the save's screenshot next to the node, kept inside the view. */
	protected drawCard(snapshot: Gtk.Snapshot, node: TimelineNode, colors: Palette): void {
		const { save } = node;
		const { width, height } = this.viewport;
		const position = this.viewport.position(node);
		const texture = screenshotTexture(save);
		const inner = card.width - card.padding * 2;
		const imageHeight = texture ? Math.round((inner * texture.getHeight()) / texture.getWidth()) : 0;
		const imageArea = texture ? imageHeight + card.padding : 0;
		const cardHeight = card.padding * 2 + imageArea + card.textHeight;
		const fitsRight = position.x + card.offset + card.width <= width - card.padding;
		const x = fitsRight ? position.x + card.offset : position.x - card.offset - card.width;
		const y = Math.max(card.padding, Math.min(position.y - cardHeight / 2, height - cardHeight - card.padding));

		const bounds = rect(x, y, card.width, cardHeight);
		snapshot.appendOutsetShadow(rounded(bounds, card.radius), colors.shadow, 0, 2, 0, 8);
		snapshot.pushRoundedClip(rounded(bounds, card.radius));
		snapshot.appendColor(colors.card, bounds);
		snapshot.pop();

		if (texture) {
			const image = rect(x + card.padding, y + card.padding, inner, imageHeight);
			snapshot.pushRoundedClip(rounded(image, card.radius - card.padding / 2));
			snapshot.appendTexture(texture, image);
			snapshot.pop();
		}

		const text = this.createPangoLayout(null);
		text.setMarkup(`<b>${escapeMarkup(save.label || save.name)}</b>\n${hoursAndMinutes(save.playTime)}`, -1);
		text.setWidth(inner * pangoScale);
		text.setEllipsize(Pango.EllipsizeMode.end);
		snapshot.save();
		snapshot.translate(point({ x: x + card.padding, y: y + card.padding + imageArea }));
		snapshot.appendLayout(text, colors.foreground);
		snapshot.restore();
	}
}
