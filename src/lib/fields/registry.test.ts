import { describe, expect, it } from 'vitest';
import { registry, selectField, item, opt } from '$lib/testing/factory';
import {
	appliesTo,
	canParent,
	childTypesOf,
	closedKind,
	formatValue,
	normalizedPosition,
	optionRank,
	resolveField,
	resolveOption
} from './registry';

const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low']);

describe('resolveField', () => {
	it('resolves by key first, then by case-insensitive name', () => {
		const reg = registry([prio]);
		expect(resolveField(reg, { field: 'custom:7' })?.name).toBe('Priority');
		expect(resolveField(reg, { name: '  priority ' })?.key).toBe('custom:7');
		expect(resolveField(reg, { field: 'native:status' })?.kind).toBe('status');
	});

	it('follows a renamed field by its id', () => {
		const reg = registry([{ ...prio, name: 'Importance' }]);
		expect(resolveField(reg, { field: 'custom:7', name: 'Priority' })?.name).toBe('Importance');
	});

	it('falls back to the name when the id changed (e.g. another GitLab instance)', () => {
		const reg = registry([{ ...prio, key: 'custom:99' }]);
		expect(resolveField(reg, { field: 'custom:7', name: 'Priority' })?.key).toBe('custom:99');
	});

	it('returns null for a removed field, never throws', () => {
		const reg = registry([]);
		expect(resolveField(reg, { field: 'custom:7', name: 'Priority' })).toBeNull();
		expect(resolveField(reg, {})).toBeNull();
		expect(resolveField(reg, null)).toBeNull();
	});

	it('prefers a custom field when a name clashes with a native one', () => {
		const reg = registry([selectField('custom:3', 'Status', ['A'])]);
		expect(resolveField(reg, { name: 'status' })?.key).toBe('custom:3');
		expect(resolveField(reg, { field: 'native:status' })?.key).toBe('native:status');
	});
});

describe('options', () => {
	it('resolves options by id, then label', () => {
		expect(resolveOption(prio, 'custom:7/o2')?.label).toBe('High');
		expect(resolveOption(prio, 'HIGH')?.id).toBe('custom:7/o2');
		expect(resolveOption(prio, 'Gone')).toBeNull();
	});

	it('ranks by GitLab order and rank direction', () => {
		expect(optionRank(prio, 'custom:7/o1', 'firstHighest')).toEqual({ rank: 3, count: 4 });
		expect(optionRank(prio, 'custom:7/o1', 'firstLowest')).toEqual({ rank: 0, count: 4 });
		expect(normalizedPosition(prio, 'custom:7/o4', 'firstHighest')).toBe(0);
		expect(normalizedPosition(prio, 'custom:7/o1', 'firstHighest')).toBe(1);
		expect(optionRank(prio, 'nope', 'firstHighest')).toBeNull();
	});

	it('follows reordered options without any code change', () => {
		const reordered = { ...prio, options: prio.options!.map((o) => ({ ...o, position: 3 - o.position })) };
		// "Low" is now first, so with firstHighest it is the highest
		expect(optionRank(reordered, 'custom:7/o4', 'firstHighest')!.rank).toBe(3);
	});

	it('formats removed options and unknown people without crashing', () => {
		const reg = registry([prio]);
		expect(formatValue(reg, prio, opt('custom:7/o9'))).toBe('(removed option)');
		const assignees = reg.fields.find((f) => f.key === 'native:assignees')!;
		expect(formatValue(reg, assignees, { kind: 'people', ids: ['u1', 'u404'] })).toBe('Alex, Unknown user');
	});

	it('treats an unknown field type as text', () => {
		const reg = registry([]);
		const f = { key: 'custom:12' as const, name: 'Confidence', kind: 'text' as const, ordered: false, editable: false, appliesTo: [], rawType: 'RATING' };
		expect(formatValue(reg, f, { kind: 'text', value: '4/5' })).toBe('4/5');
	});
});

describe('closedKind', () => {
	const reg = registry();
	it('uses the status category, then the closed state', () => {
		expect(closedKind(reg, item({ 'native:status': opt('s-done') }))).toBe('done');
		expect(closedKind(reg, item({ 'native:status': opt('s-nope') }, { state: 'closed' }))).toBe('canceled');
		expect(closedKind(reg, item({ 'native:status': opt('s-doing') }))).toBeNull();
		expect(closedKind(reg, item({}, { state: 'closed' }))).toBe('done');
	});
	it('checks appliesTo', () => {
		expect(appliesTo(prio, 'Epic')).toBe(true);
		expect(appliesTo({ ...prio, appliesTo: ['Issue'] }, 'epic')).toBe(false);
		expect(appliesTo({ ...prio, appliesTo: ['Issue'] }, 'issue')).toBe(true);
	});
});

describe('work item hierarchy', () => {
	it("falls back to GitLab's documented hierarchy: Epic → Epic | Issue, Issue → Task, Task → none", () => {
		const reg = registry();
		expect(childTypesOf(reg, 'Epic')).toEqual(['Epic', 'Issue']);
		expect(childTypesOf(reg, 'issue')).toEqual(['Task']);
		expect(childTypesOf(reg, 'Task')).toEqual([]);
		expect(canParent(reg, 'Issue', 'Task')).toBe(true);
		expect(canParent(reg, 'Issue', 'Issue')).toBe(false);
		expect(canParent(reg, 'Epic', 'Task')).toBe(false);
	});
	it("uses GitLab's allowedChildTypes when it reported them, and only types the group has", () => {
		const reg = registry([], {
			types: [
				{ id: 't1', name: 'Issue', childTypes: ['Task', 'Incident'] },
				{ id: 't5', name: 'Task', childTypes: [] },
				{ id: 't8', name: 'Epic', childTypes: ['epic', 'Issue', 'Objective'] }
			]
		});
		expect(childTypesOf(reg, 'Epic')).toEqual(['Epic', 'Issue']); // spelled as the group spells them; Objective isn't in the group
		expect(childTypesOf(reg, 'Issue')).toEqual(['Task']);
		expect(childTypesOf(reg, 'Unknown type')).toEqual([]);
	});
});
