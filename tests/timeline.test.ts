import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { parseTimestamp } from '../src/games/cyberpunk.js';
import { layoutTimeline } from '../src/layout.js';
import type { Save } from '../src/save.js';
import { Timeline } from '../src/timeline.js';
import { Viewport } from '../src/viewport.js';

const epoch = Temporal.ZonedDateTime.from('2026-01-01T00:00[UTC]');

/** @param day Days after the epoch the save was written */
function save(name: string, playTime: number, day: number, progress: string[] = [], playthrough = 'a'): Save {
	const time = epoch.add({ days: day, seconds: playTime });
	return {
		id: name,
		name,
		path: name,
		game: 'test',
		playthrough,
		playTime,
		time,
		kind: 'manual',
		label: '',
		progress: new Set(progress),
		details: {},
	};
}

function parentOf(timeline: Timeline, name: string): string | undefined {
	return timeline.find(name)?.parent?.save.name;
}

suite('Timeline', () => {
	test('saves in one session form a chain', () => {
		const timeline = new Timeline([save('one', 100, 0), save('two', 200, 0), save('three', 300, 0)]);
		assert.equal(parentOf(timeline, 'two'), 'one');
		assert.equal(parentOf(timeline, 'three'), 'two');
		assert.deepEqual(
			timeline.roots.map(root => root.save.name),
			['one']
		);
	});

	test('a save made after loading continues from the loaded save', () => {
		const timeline = new Timeline([save('start', 100, 0), save('later', 900, 0), save('reloaded', 150, 7)]);
		assert.equal(parentOf(timeline, 'reloaded'), 'start');
		assert.equal(timeline.find('start')!.children.length, 2);
	});

	test('a recent save in another session does not capture a reload', () => {
		const timeline = new Timeline([save('fork', 1000, 0), save('branch', 500, 30), save('reloaded', 1005, 40)]);
		assert.equal(parentOf(timeline, 'reloaded'), 'fork');
	});

	test('a save in the same session is preferred over a closer play time', () => {
		const timeline = new Timeline([
			save('fork', 100, 0),
			save('first visit', 150, 10),
			save('second visit', 120, 20),
			save('second visit, later', 160, 20),
		]);
		assert.equal(parentOf(timeline, 'second visit, later'), 'second visit');
	});

	test('saves with progress the descendant lacks are not ancestors', () => {
		const timeline = new Timeline([
			save('root', 100, 0, ['a']),
			save('other branch', 200, 0, ['a', 'b']),
			save('reloaded', 250, 5, ['a', 'c']),
		]);
		assert.equal(parentOf(timeline, 'reloaded'), 'root');
	});

	test('fromSaves splits playthroughs', () => {
		const timelines = Timeline.fromSaves([save('a1', 1, 0), save('b1', 1, 0, [], 'b'), save('a2', 2, 0)]);
		assert.deepEqual(
			timelines.map(timeline => timeline.nodes.length),
			[2, 1]
		);
	});
});

suite('layoutTimeline', () => {
	test('the furthest-reaching branch keeps its parent lane', () => {
		const timeline = new Timeline([save('root', 100, 0), save('main', 900, 0), save('side', 150, 7)]);
		const { lanes, laneCount } = layoutTimeline(timeline);
		assert.equal(laneCount, 2);
		assert.equal(lanes.get(timeline.find('main')!), lanes.get(timeline.find('root')!));
		assert.equal(lanes.get(timeline.find('side')!), 1);
	});

	test('branches share a lane unless their play time spans overlap', () => {
		const timeline = new Timeline([
			save('root', 100, 0),
			save('middle', 500, 0),
			save('end', 1000, 0),
			save('early branch', 150, 7),
			save('late branch', 550, 8),
			save('overlapping branch', 520, 9),
		]);
		const { lanes, laneCount } = layoutTimeline(timeline);
		assert.equal(lanes.get(timeline.find('early branch')!), 1);
		assert.equal(lanes.get(timeline.find('late branch')!), 1);
		assert.equal(lanes.get(timeline.find('overlapping branch')!), 2);
		assert.equal(laneCount, 3);
	});
});

suite('Viewport', () => {
	const timeline = new Timeline([save('one', 0, 0), save('two', 1000, 0)]);

	test('fit spans the whole timeline', () => {
		const viewport = new Viewport(layoutTimeline(timeline));
		viewport.fit(1064, 400);
		assert.equal(viewport.x(0), viewport.margin);
		assert.equal(viewport.x(1000), 1064 - viewport.margin);
	});

	test('zoom keeps the anchor in place', () => {
		const viewport = new Viewport(layoutTimeline(timeline));
		viewport.fit(1064, 400);
		const before = viewport.playTimeAt(300);
		viewport.zoom(2, 300);
		assert.ok(Math.abs(viewport.playTimeAt(300) - before) < 1e-9);
	});

	test('hitTest finds the node under the pointer', () => {
		const viewport = new Viewport(layoutTimeline(timeline));
		viewport.fit(1064, 400);
		const { x, y } = viewport.position(timeline.find('two')!);
		assert.equal(viewport.hitTest(x + 3, y + 3)?.save.name, 'two');
		assert.equal(viewport.hitTest(x, y + viewport.laneHeight), undefined);
	});
});

test('parseTimestamp reads Cyberpunk timestamps', () => {
	assert.equal(parseTimestamp('23:19:28, 5.09.2026').toPlainDateTime().toString(), '2026-09-05T23:19:28');
});
