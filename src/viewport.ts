import type { TimelineLayout } from './layout.js';
import type { TimelineNode } from './timeline.js';

export interface Point {
	x: number;
	y: number;
}

/** Maps a timeline layout onto an area of pixels that can be zoomed and panned along the play time axis. */
export class Viewport {
	/** Pixels per second of play time */
	public scale = 1;
	/** Play time at the left edge of the content, in seconds */
	public left: number;
	/** Vertical position of the first lane */
	public top = 0;
	public laneHeight = 48;

	public width = 0;
	public height = 0;

	public padding = 32;
	public nodeRadius = 6;
	public minLaneHeight = 32;
	public maxLaneHeight = 96;

	public constructor(public readonly layout: TimelineLayout) {
		this.left = layout.timeline.start;
	}

	/** The scale at which the whole timeline fits horizontally, in pixels per second */
	public get fitScale(): number {
		const { start, end } = this.layout.timeline;
		return Math.max(this.width - 2 * this.padding, 1) / Math.max(end - start, 1);
	}

	public get isZoomedOut(): boolean {
		return this.scale <= this.fitScale * 1.0001;
	}

	/** Resize the area, keeping the zoom unless the whole timeline was visible. */
	public resize(width: number, height: number): void {
		const wasZoomedOut = !this.width || this.isZoomedOut;
		this.width = width;
		this.height = height;

		const gaps = Math.max(this.layout.laneCount - 1, 1);
		const fittedHeight = (height - 2 * this.padding) / gaps;
		this.laneHeight = Math.min(this.maxLaneHeight, Math.max(this.minLaneHeight, fittedHeight));
		const contentHeight = (this.layout.laneCount - 1) * this.laneHeight;
		this.top = Math.max(this.padding, (height - contentHeight) / 2);

		if (wasZoomedOut) this.scale = this.fitScale;
		this.zoom(1, width / 2);
	}

	public x(playTime: number): number {
		return this.padding + (playTime - this.left) * this.scale;
	}

	public y(lane: number): number {
		return this.top + lane * this.laneHeight;
	}

	public position(node: TimelineNode): Point {
		return { x: this.x(node.save.playTime), y: this.y(this.layout.lanes.get(node)!) };
	}

	/** Play time at a horizontal pixel position, in seconds. */
	public playTimeAt(x: number): number {
		return this.left + (x - this.padding) / this.scale;
	}

	/** Zoom by `factor`, keeping the play time under `anchor` in place, but never further out than fitting the whole timeline. */
	public zoom(factor: number, anchor: number): void {
		const playTime = this.playTimeAt(anchor);
		this.scale = Math.max(this.fitScale, this.scale * factor);
		this.left = playTime - (anchor - this.padding) / this.scale;
		this.clamp();
	}

	/** Show the same play time span as another viewport, unless it showed the whole timeline. */
	public match(other: Viewport): void {
		if (other.isZoomedOut) return;
		this.scale = Math.max(this.fitScale, other.scale);
		this.left = other.left;
		this.clamp();
	}

	/** Move the content horizontally by a pixel offset. */
	public pan(x: number): void {
		this.left -= x / this.scale;
		this.clamp();
	}

	/** Keep the timeline's ends from scrolling past the edges. */
	protected clamp(): void {
		const { start, end } = this.layout.timeline;
		const visible = (this.width - 2 * this.padding) / this.scale;
		this.left = Math.min(Math.max(this.left, start), Math.max(start, end - visible));
	}

	/** The node drawn at a pixel position, if any. */
	public hitTest(x: number, y: number): TimelineNode | undefined {
		const lane = Math.round((y - this.top) / this.laneHeight);
		const reach = this.nodeRadius * 2;
		let closest: TimelineNode | undefined;
		let closestDistance = reach;

		for (const [node, nodeLane] of this.layout.lanes) {
			if (nodeLane != lane) continue;
			const distance = Math.abs(this.x(node.save.playTime) - x);
			if (distance >= closestDistance) continue;
			closest = node;
			closestDistance = distance;
		}

		return closest;
	}
}
