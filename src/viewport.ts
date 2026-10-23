import type { TimelineLayout } from './layout.js';
import type { TimelineNode } from './timeline.js';

export interface Point {
	x: number;
	y: number;
}

/** Maps a timeline layout onto a pannable, zoomable area of pixels. */
export class Viewport {
	/** Pixels per second of play time */
	public scale = 0.01;
	/** Play time at the left edge, in seconds */
	public left: number;
	/** Pixels scrolled down from the first lane */
	public top = 0;

	public width = 0;
	public height = 0;

	public margin = 32;
	public laneHeight = 48;
	public nodeRadius = 6;

	public constructor(public readonly layout: TimelineLayout) {
		this.left = layout.timeline.start;
	}

	/** Fit the whole timeline horizontally into the given size. */
	public fit(width: number, height: number): void {
		const { start, end } = this.layout.timeline;
		this.width = width;
		this.height = height;
		this.scale = (width - 2 * this.margin) / Math.max(end - start, 1);
		this.left = start;
		this.top = 0;
	}

	public x(playTime: number): number {
		return this.margin + (playTime - this.left) * this.scale;
	}

	public y(lane: number): number {
		return this.margin + lane * this.laneHeight - this.top;
	}

	public position(node: TimelineNode): Point {
		return { x: this.x(node.save.playTime), y: this.y(this.layout.lanes.get(node)!) };
	}

	/** Play time at a horizontal pixel position, in seconds. */
	public playTimeAt(x: number): number {
		return this.left + (x - this.margin) / this.scale;
	}

	/** Zoom by `factor`, keeping the play time under `anchor` in place. */
	public zoom(factor: number, anchor: number): void {
		const playTime = this.playTimeAt(anchor);
		this.scale *= factor;
		this.left = playTime - (anchor - this.margin) / this.scale;
	}

	/** Move the content by a pixel offset. */
	public pan(x: number, y: number): void {
		this.left -= x / this.scale;
		this.top = Math.max(0, this.top - y);
	}

	/** The node drawn at a pixel position, if any. */
	public hitTest(x: number, y: number): TimelineNode | undefined {
		const lane = Math.round((y + this.top - this.margin) / this.laneHeight);
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
