import type { Timeline, TimelineNode } from './timeline.js';

export interface TimelineLayout {
	timeline: Timeline;
	/** Vertical position of each node, counted in lanes from the top */
	lanes: Map<TimelineNode, number>;
	laneCount: number;
}

/** Play time spans, in seconds */
type Spans = [start: number, end: number][];

/** Give each branch the nearest lane below its parent that is free for the play time the branch spans. */
export function layoutTimeline(timeline: Timeline): TimelineLayout {
	const lanes = new Map<TimelineNode, number>();
	const occupied: Spans[] = [];

	const isFree = (lane: number, start: number, end: number) =>
		!occupied[lane]?.some(([otherStart, otherEnd]) => start <= otherEnd && otherStart <= end);

	for (const { node, isBranchStart } of timeline.walk()) {
		if (!isBranchStart) {
			lanes.set(node, lanes.get(node.parent!)!);
			continue;
		}

		const start = node.parent?.save.playTime ?? node.save.playTime;
		const end = timeline.reachOf(node);
		let lane = node.parent ? lanes.get(node.parent)! + 1 : 0;
		while (!isFree(lane, start, end)) lane++;

		(occupied[lane] ??= []).push([start, end]);
		lanes.set(node, lane);
	}

	return { timeline, lanes, laneCount: occupied.length };
}
