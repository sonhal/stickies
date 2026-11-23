import { describe, expect, it } from 'vitest';
import { registry, item, many, opt as one } from '$lib/testing/factory';
import { bulkChanges, bulkEditable, countLabel, optionCounts, rangeIds } from './bulk';
import type { FieldDef, WorkItem } from '$lib/fields/types';

const reg = registry();
const f = (key: string) => reg.fields.find((x) => x.key === key)!;
const epic = item({}, { id: 'e1', type: 'Epic', ref: 'g&1' });
const a = item({ 'native:labels': many('l-bug', 'l-be'), 'native:status': one('s-todo'), 'native:parent': { kind: 'ref', id: 'e1' } }, { id: 'a', ref: 'g/api#1', parentId: 'e1' });
const b = item({ 'native:labels': many('l-fe') }, { id: 'b', ref: 'g/api#2' });
const task = item({}, { id: 't', type: 'Task', ref: 'g/api#3', parentId: 'a' });
const all = [epic, a, b, task];
const byId = new Map(all.map((i) => [i.id, i]));
const run = (items: WorkItem[], key: string, op: Parameters<typeof bulkChanges>[4]) => bulkChanges(reg, byId, items, f(key), op);

describe('bulkChanges', () => {
	it('sets a single value on every item it applies to, skipping types it does not', () => {
		const r = run([a, b, epic], 'native:status', { kind: 'set', value: 's-done' });
		expect(r.changes).toEqual([
			{ id: 'a', value: 's-done' },
			{ id: 'b', value: 's-done' }
		]);
		// STATUS applies to Issue and Task only
		expect(r.skipped.map((s) => [s.item.id, s.reason])).toEqual([['e1', "Status doesn't apply to a Epic"]]);
	});

	it('leaves items that already have the value alone', () => {
		const r = run([a, b], 'native:status', { kind: 'set', value: 's-todo' });
		expect(r.changes).toEqual([{ id: 'b', value: 's-todo' }]);
		expect(r.unchanged).toBe(1);
	});

	it('adds a label to each item, keeping its other labels', () => {
		const r = run([a, b], 'native:labels', { kind: 'add', id: 'l-bug' });
		expect(r.changes).toEqual([{ id: 'b', value: ['l-fe', 'l-bug'] }]);
		expect(r.unchanged).toBe(1);
	});

	it('adding a scoped label replaces the item’s label of that scope', () => {
		const r = run([a, b], 'native:labels', { kind: 'add', id: 'l-fe' });
		expect(r.changes).toEqual([{ id: 'a', value: ['l-bug', 'l-fe'] }]);
	});

	it('removes a value only from items that have it', () => {
		const r = run([a, b], 'native:labels', { kind: 'remove', id: 'l-bug' });
		expect(r.changes).toEqual([{ id: 'a', value: ['l-be'] }]);
		expect(r.unchanged).toBe(1);
	});

	it('adds and removes people', () => {
		const withSam = item({ 'native:assignees': { kind: 'people', ids: ['u2'] } }, { id: 'c' });
		expect(run([withSam, b], 'native:assignees', { kind: 'add', id: 'u1' }).changes).toEqual([
			{ id: 'c', value: ['u2', 'u1'] },
			{ id: 'b', value: ['u1'] }
		]);
		expect(run([withSam, b], 'native:assignees', { kind: 'remove', id: 'u2' }).changes).toEqual([{ id: 'c', value: [] }]);
	});

	it('only offers parents GitLab allows, and never a cycle', () => {
		// Issues go under an epic; a task can't
		const r = run([b, task], 'native:parent', { kind: 'set', value: 'e1' });
		expect(r.changes).toEqual([{ id: 'b', value: 'e1' }]);
		expect(r.skipped.map((s) => s.item.id)).toEqual(['t']);
		// An epic can't go under itself
		const epic2 = item({}, { id: 'e2', type: 'Epic', parentId: 'e1' });
		const ids = new Map([...byId, ['e2', epic2]]);
		const c = bulkChanges(reg, ids, [epic, epic2], f('native:parent'), { kind: 'set', value: 'e2' });
		expect(c.changes).toEqual([]);
		expect(c.skipped.map((s) => s.reason)).toEqual(["an item can't be its own parent", "an item can't be its own parent"]);
	});

	it('clears a value with set null', () => {
		expect(run([a, b], 'native:parent', { kind: 'set', value: null }).changes).toEqual([{ id: 'a', value: null }]);
	});

	it('skips everything for a read-only field', () => {
		const ro: FieldDef = { ...f('native:milestone'), editable: false };
		const r = bulkChanges(reg, byId, [a, b], ro, { kind: 'set', value: 'm1' });
		expect(r.changes).toEqual([]);
		expect(r.skipped).toHaveLength(2);
	});
});

describe('bulk helpers', () => {
	it('knows which fields the bulk bar can edit', () => {
		expect(bulkEditable(f('native:status'))).toBe(true);
		expect(bulkEditable(f('native:labels'))).toBe(true);
		expect(bulkEditable(f('native:assignees'))).toBe(true);
		expect(bulkEditable(f('native:parent'))).toBe(true);
		expect(bulkEditable(f('native:milestone'))).toBe(true);
		expect(bulkEditable(f('native:weight'))).toBe(false);
		expect(bulkEditable(f('native:project'))).toBe(false);
	});

	it('counts how many items have each option', () => {
		expect(optionCounts([a, b], f('native:labels'))).toEqual(
			new Map([
				['l-bug', 1],
				['l-be', 1],
				['l-fe', 1]
			])
		);
	});

	it('selects a range in screen order, either direction', () => {
		const order = ['1', '2', '3', '4', '5'];
		expect(rangeIds(order, '2', '4')).toEqual(['2', '3', '4']);
		expect(rangeIds(order, '4', '2')).toEqual(['2', '3', '4']);
		expect(rangeIds(order, null, '3')).toEqual(['3']);
		expect(rangeIds(order, 'gone', '3')).toEqual(['3']);
		expect(rangeIds(order, '2', 'hidden')).toEqual(['hidden']);
	});

	it('names what is selected', () => {
		expect(countLabel([a, b])).toBe('2 issues');
		expect(countLabel([a])).toBe('1 issue');
		expect(countLabel([a, epic])).toBe('2 items');
	});
});
