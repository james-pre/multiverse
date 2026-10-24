import type { Save } from './save.js';

export interface TimelineNode {
	save: Save;
	parent?: TimelineNode;
	children: TimelineNode[];
}

export interface TimelineStep {
	node: TimelineNode;
	/** Whether the node starts a new branch rather than continuing its parent's */
	isBranchStart: boolean;
	/** How many branches deep the node is */
	depth: number;
}

export interface InferenceOptions {
	/** How far wall-clock time may fall short of play time before a save can't be a descendant, in seconds */
	tolerance?: number;
	/** The most unaccounted time between two saves made in the same session, in seconds */
	sessionGap?: number;
}

function isSubset(subset: ReadonlySet<string>, superset: ReadonlySet<string>): boolean {
	for (const item of subset) if (!superset.has(item)) return false;
	return true;
}

/** Whether `ancestor` could have come before `save`, given that progress only accumulates. */
function isProgressBefore(ancestor: Save, save: Save): boolean {
	if (!isSubset(ancestor.progress, save.progress)) return false;
	for (const [name, count] of Object.entries(ancestor.counters ?? {})) {
		const later = save.counters?.[name];
		if (later !== undefined && count > later) return false;
	}
	return true;
}

/** Wall-clock time between two saves that play time doesn't account for, in seconds. */
export function unaccountedTime(ancestor: Save, save: Save): number {
	const wallTime = ancestor.time.until(save.time).total('seconds');
	return wallTime - (save.playTime - ancestor.playTime);
}

/**
 * The save that `save` most likely continues from.
 * This is the latest save made earlier in the same session, or otherwise the latest save that could have been loaded.
 */
export function findParent(save: Save, candidates: Iterable<Save>, options: InferenceOptions = {}): Save | undefined {
	const tolerance = options.tolerance ?? 60;
	const sessionGap = options.sessionGap ?? 3600;
	let continuation: Save | undefined;
	let loaded: Save | undefined;

	for (const candidate of candidates) {
		if (candidate === save || candidate.playTime >= save.playTime) continue;
		if (!isProgressBefore(candidate, save)) continue;

		const gap = unaccountedTime(candidate, save);
		if (gap < -tolerance) continue;

		if (gap <= sessionGap && (!continuation || candidate.playTime > continuation.playTime))
			continuation = candidate;
		if (!loaded || candidate.playTime > loaded.playTime) loaded = candidate;
	}

	return continuation ?? loaded;
}

/** The saves of one playthrough, arranged into the tree of branches they were played along. */
export class Timeline {
	public readonly game: string;
	public readonly playthrough: string;
	public readonly roots: TimelineNode[] = [];
	/** Sorted by play time */
	public readonly nodes: TimelineNode[];

	/** The latest play time reached in each node's subtree, in seconds */
	protected readonly reach = new Map<TimelineNode, number>();
	protected readonly byId = new Map<string, TimelineNode>();

	/** @param saves Saves from a single playthrough */
	public constructor(saves: Save[], options?: InferenceOptions) {
		const [first] = saves;
		if (!first) throw new Error('Can not build a timeline without saves');
		this.game = first.game;
		this.playthrough = first.playthrough;

		this.nodes = saves
			.toSorted((a, b) => a.playTime - b.playTime)
			.map((save): TimelineNode => ({ save, children: [] }));

		const bySave = new Map(this.nodes.map(node => [node.save, node]));
		for (const node of this.nodes) {
			this.byId.set(node.save.id, node);
			const parentSave = findParent(node.save, saves, options);
			const parent = parentSave && bySave.get(parentSave);
			if (!parent) {
				this.roots.push(node);
				continue;
			}
			node.parent = parent;
			parent.children.push(node);
		}

		for (const node of this.nodes.toReversed()) {
			const childReach = node.children.map(child => this.reach.get(child)!);
			this.reach.set(node, Math.max(node.save.playTime, ...childReach));
		}
	}

	/** Group saves by game and playthrough, then build a timeline for each. */
	public static fromSaves(saves: Iterable<Save>, options?: InferenceOptions): Timeline[] {
		const groups = Map.groupBy(saves, save => `${save.game}\0${save.playthrough}`);
		return Array.from(groups.values(), group => new Timeline(group, options));
	}

	/** In seconds */
	public get start(): number {
		return this.nodes[0].save.playTime;
	}

	/** In seconds */
	public get end(): number {
		return Math.max(...this.roots.map(root => this.reach.get(root)!));
	}

	public find(id: string): TimelineNode | undefined {
		return this.byId.get(id);
	}

	/** The latest play time reached in the node's subtree, in seconds. */
	public reachOf(node: TimelineNode): number {
		return this.reach.get(node)!;
	}

	/** Nodes ordered so the branch that reaches furthest comes first. */
	public byReach(nodes: TimelineNode[]): TimelineNode[] {
		return nodes.toSorted((a, b) => this.reach.get(b)! - this.reach.get(a)!);
	}

	/** Visit nodes depth-first, with the furthest-reaching child continuing its parent's branch. */
	public *walk(): Generator<TimelineStep> {
		const stack = this.byReach(this.roots)
			.toReversed()
			.map((node): TimelineStep => ({ node, isBranchStart: true, depth: 0 }));

		while (stack.length) {
			const step = stack.pop()!;
			yield step;

			const [main, ...branches] = this.byReach(step.node.children);
			if (main) stack.push({ node: main, isBranchStart: false, depth: step.depth });
			for (const branch of branches.toReversed()) {
				stack.push({ node: branch, isBranchStart: true, depth: step.depth + 1 });
			}
		}
	}
}
