import { describe, expect, it } from 'vitest';
import { item, registry, selectField } from '$lib/testing/factory';
import { withEpics } from './epic';
import { groupItems } from '$lib/query/engine';
import type { WorkItem } from './types';

const epicOf = (i: WorkItem) => {
	const v = i.values['native:epic'];
	return v?.kind === 'ref' ? v.id : null;
};

describe('native:epic (nearest epic above an item)', () => {
	const epic = item({}, { type: 'Epic', title: 'Payments v2' });
	const issue = item({}, { parentId: epic.id });
	const task = item({}, { type: 'Task', parentId: issue.id });
	const loose = item();
	const looseTask = item({}, { type: 'Task', parentId: loose.id });
	const underOldEpic = item({}, { parentId: 'gid://gitlab/WorkItem/9999' });
	const underUnknown = item({}, { parentId: 'gid://gitlab/WorkItem/8888' });
	const epicField = selectField('native:epic', 'Epic', [], {
		kind: 'ref',
		options: [
			{ id: epic.id, label: 'Payments v2', position: 0 },
			{ id: 'gid://gitlab/WorkItem/9999', label: 'Old closed epic (closed)', position: 1 }
		]
	});
	const reg = registry([epicField]);
	const out = withEpics([epic, issue, task, loose, looseTask, underOldEpic, underUnknown], reg);
	const byId = new Map(out.map((i) => [i.id, i]));

	it('goes through the parent issue: a task gets its issue\'s epic', () => {
		expect(epicOf(byId.get(issue.id)!)).toBe(epic.id);
		expect(epicOf(byId.get(task.id)!)).toBe(epic.id);
	});

	it('leaves epics themselves, freestanding issues and their tasks without an epic', () => {
		expect(epicOf(byId.get(epic.id)!)).toBeNull();
		expect(epicOf(byId.get(loose.id)!)).toBeNull();
		expect(epicOf(byId.get(looseTask.id)!)).toBeNull();
	});

	it('uses an epic the board did not load when the registry knows it is an epic', () => {
		expect(epicOf(byId.get(underOldEpic.id)!)).toBe('gid://gitlab/WorkItem/9999');
		// an unloaded parent of unknown type is not assumed to be an epic
		expect(epicOf(byId.get(underUnknown.id)!)).toBeNull();
	});

	it('keeps the identity of items whose epic did not change', () => {
		expect(withEpics(out, reg).every((i, n) => i === out[n])).toBe(true);
	});

	it('moves the tasks too when an issue gets a new parent', () => {
		const moved = withEpics(out.map((i) => (i.id === issue.id ? { ...i, parentId: null } : i)), reg);
		expect(epicOf(moved.find((i) => i.id === task.id)!)).toBeNull();
	});

	it('"by epic" groups put the task with its issue under the epic', () => {
		const groups = groupItems(out.filter((i) => i.type !== 'Epic'), epicField, { rank: { reg, fieldSettings: [], defaultDirection: 'firstHighest' }, now: new Date(), closedDaysMax: 30 }, false);
		expect(groups.map((g) => [g.label, g.items.length])).toEqual([
			['Payments v2', 2],
			['Old closed epic (closed)', 1],
			['No epic', 3]
		]);
	});
});
