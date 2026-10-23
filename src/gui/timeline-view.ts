import { connect } from 'girbind';
import * as Adw from '../../native/adw.js';
import * as Gdk from '../../native/gdk.js';
import * as Graphene from '../../native/graphene.js';
import * as Gsk from '../../native/gsk.js';
import * as Gtk from '../../native/gtk.js';
import { duration } from 'utilium/format';
import { layoutTimeline } from '../layout.js';
import type { Timeline, TimelineNode } from '../timeline.js';
import { Viewport, type Point } from '../viewport.js';

const kindColors: Record<string, string> = {
	manual: '#3584e4',
	auto: '#9a9996',
	quick: '#33d17a',
	'point of no return': '#e66100',
	'end game': '#c01c28',
};

function rgba(spec: string): Gdk.RGBA {
	const color = new Gdk.RGBA();
	color.parse(spec);
	return color;
}

function point({ x, y }: Point): Graphene.Point {
	return new Graphene.Point().init(x, y);
}

/** Draws one timeline and handles zooming, panning and hovering over it. */
export class TimelineView {
	public readonly widget = new Gtk.Picture();
	protected readonly viewport: Viewport;
	protected hovered?: TimelineNode;
	protected pointer: Point = { x: 0, y: 0 };
	protected dragged: Point = { x: 0, y: 0 };

	public constructor(public readonly timeline: Timeline) {
		this.viewport = new Viewport(layoutTimeline(timeline));
		this.widget.setHexpand(true);
		this.widget.setVexpand(true);

		const motion = new Gtk.EventControllerMotion();
		connect(motion, 'motion', (_, x, y) => {
			this.pointer = { x, y };
			this.hover(this.viewport.hitTest(x, y));
		});
		connect(motion, 'leave', () => this.hover(undefined));

		const scroll = new Gtk.EventControllerScroll(Gtk.EventControllerScrollFlags.vertical);
		connect(scroll, 'scroll', (_, _x, y) => {
			this.viewport.zoom(Math.pow(1.1, -y), this.pointer.x);
			this.render();
			return true;
		});

		const drag = new Gtk.GestureDrag();
		connect(drag, 'drag-begin', () => (this.dragged = { x: 0, y: 0 }));
		connect(drag, 'drag-update', (_, x, y) => {
			this.viewport.pan(x - this.dragged.x, y - this.dragged.y);
			this.dragged = { x, y };
			this.render();
		});

		for (const controller of [motion, scroll, drag]) this.widget.addController(controller);
	}

	protected hover(node: TimelineNode | undefined): void {
		if (node === this.hovered) return;
		this.hovered = node;
		this.render();
	}

	public render(): void {
		const width = this.widget.getWidth();
		const height = this.widget.getHeight();
		if (!width || !height) return;
		if (!this.viewport.width) this.viewport.fit(width, height);
		this.viewport.width = width;
		this.viewport.height = height;

		const foreground = rgba(Adw.StyleManager.getDefault().getDark() ? '#ffffff' : '#000000');
		const snapshot = new Gtk.Snapshot();
		this.drawBranches(snapshot, foreground);
		this.drawSaves(snapshot);
		if (this.hovered) this.drawLabel(snapshot, this.hovered, foreground);

		this.widget.setPaintable(snapshot.toPaintable(new Graphene.Size().init(width, height)));
	}

	protected drawBranches(snapshot: Gtk.Snapshot, color: Gdk.RGBA): void {
		const builder = new Gsk.PathBuilder();
		for (const node of this.timeline.nodes) {
			if (!node.parent) continue;
			const from = this.viewport.position(node.parent);
			const to = this.viewport.position(node);
			builder.moveTo(from.x, from.y);
			if (from.y != to.y) {
				const bend = Math.min(this.viewport.laneHeight, to.x - from.x);
				builder.cubicTo(from.x + bend / 2, from.y, from.x + bend / 2, to.y, from.x + bend, to.y);
			}
			builder.lineTo(to.x, to.y);
		}
		snapshot.appendStroke(builder.toPath(), new Gsk.Stroke(2), color);
	}

	protected drawSaves(snapshot: Gtk.Snapshot): void {
		const nodesByKind = Map.groupBy(this.timeline.nodes, node => node.save.kind);
		for (const [kind, nodes] of nodesByKind) {
			const builder = new Gsk.PathBuilder();
			for (const node of nodes) {
				const radius = this.viewport.nodeRadius * (node === this.hovered ? 1.5 : 1);
				builder.addCircle(point(this.viewport.position(node)), radius);
			}
			snapshot.appendFill(builder.toPath(), Gsk.FillRule.winding, rgba(kindColors[kind] ?? '#77767b'));
		}
	}

	protected drawLabel(snapshot: Gtk.Snapshot, node: TimelineNode, color: Gdk.RGBA): void {
		const { save } = node;
		const text = `${save.name}  ${duration(save.playTime)}\n${save.label}`;
		const position = this.viewport.position(node);
		snapshot.save();
		snapshot.translate(
			point({ x: position.x + this.viewport.nodeRadius * 2, y: position.y + this.viewport.nodeRadius })
		);
		snapshot.appendLayout(this.widget.createPangoLayout(text), color);
		snapshot.restore();
	}
}
