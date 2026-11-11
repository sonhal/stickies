import { describe, expect, it } from 'vitest';
import { assignEpicSlots, EpicColors } from './colors';
import { item } from '$lib/testing/factory';

describe('epic colors', () => {
	it('is stable when a newer epic appears', () => {
		const before = assignEpicSlots([10, 20, 30]);
		const after = assignEpicSlots([10, 20, 30, 41]);
		for (const id of [10, 20, 30]) expect(after.get(id)).toBe(before.get(id));
	});

	it('respects pins and folds the 9th epic into "other"', () => {
		const slots = assignEpicSlots([1, 2, 3, 4, 5, 6, 7, 8, 9], { 9: 1 });
		expect(slots.get(9)).toBe(1);
		const values = [...slots.values()];
		expect(values.filter((v) => v === 'other')).toHaveLength(1);
	});

	it('colors a whole tree by its top-most ancestor', () => {
		const epic = item({}, { type: 'Epic', title: 'Billing' });
		const issue = item({}, { parentId: epic.id });
		const task = item({}, { parentId: issue.id, type: 'Task' });
		const loose = item();
		const orphan = item({}, { parentId: 'gid://gitlab/WorkItem/999999' });
		const c = new EpicColors([epic, issue, task, loose, orphan], {}, () => 'Old epic');
		expect(c.slotFor(task)).toBe(c.slotFor(epic));
		expect(c.slotFor(issue)).toBe(c.slotFor(epic));
		expect(c.slotFor(loose)).toBe('none');
		expect(c.epic(orphan)?.title).toBe('Old epic');
		const sw = c.swatches([issue, task, loose]);
		expect(sw.map((s) => [s.title, s.count])).toEqual([
			['Billing', 2],
			['No epic', 1]
		]);
	});
});
