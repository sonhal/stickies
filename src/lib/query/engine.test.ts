import { describe, expect, it } from 'vitest';
import { registry, selectField, item, opt, num, date, people, many } from '$lib/testing/factory';
import { arrangeRows, compileFilter, groupItems, inCompletedWindow, inScope, parseDateValue, runView, sortItems, type EngineContext } from './engine';
import { and, or, rule } from './define';
import type { FieldDef } from '$lib/fields/types';
import { PARENT_NOT_LOADED } from '$lib/fields/registry';
import type { ViewDefinition } from './types';

const prio = selectField('custom:7', 'Priority', ['Critical', 'High', 'Medium', 'Low']);
const P = (l: string) => opt(prio.options!.find((o) => o.label === l)!.id);
const NOW = new Date('2026-11-10T12:00:00Z');

function ctx(fields: FieldDef[] = [prio], extra = {}): EngineContext {
	return { rank: { reg: registry(fields, extra), fieldSettings: [], defaultDirection: 'firstHighest' }, now: NOW, closedDaysMax: 30 };
}

const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

describe('filters', () => {
	const a = item({ 'custom:7': P('Critical'), 'native:assignees': people('u1'), 'native:weight': num(5), 'native:status': opt('s-doing') });
	const b = item({ 'custom:7': P('Low'), 'native:assignees': people('u2'), 'native:weight': num(1), 'native:dueDate': date('2026-11-12') });
	const c = item({ 'native:labels': many('l-bug', 'l-be'), 'native:status': opt('s-todo') });
	const all = [a, b, c];
	const run = (g: Parameters<typeof compileFilter>[0], cx = ctx()) => {
		const f = compileFilter(g, cx);
		return { ids: ids(all.filter(f.test)), reports: f.reports };
	};

	it('matches options by id or by label', () => {
		expect(run(and(rule('Priority', 'anyOf', ['critical']))).ids).toEqual([a.id]);
		expect(run(and(rule('custom:7', 'is', prio.options![3].id))).ids).toEqual([b.id]);
		expect(run(and(rule('Priority', 'noneOf', ['Critical']))).ids).toEqual([b.id, c.id]);
	});

	it('supports me, empty, numbers, dates, category and or-groups', () => {
		expect(run(and(rule('native:assignees', 'anyOf', ['me']))).ids).toEqual([a.id]);
		expect(run(and(rule('native:assignees', 'empty'))).ids).toEqual([c.id]);
		expect(run(and(rule('native:weight', 'gt', 2))).ids).toEqual([a.id]);
		expect(run(and(rule('native:dueDate', 'before', 'today+7'))).ids).toEqual([b.id]);
		expect(run(and(rule('native:status', 'anyOf', ['category:inProgress']))).ids).toEqual([a.id]);
		expect(run(or(rule('Priority', 'is', 'Low'), rule('native:labels', 'anyOf', ['bug']))).ids).toEqual([b.id, c.id]);
	});

	it('compares option order with the rank direction', () => {
		expect(run(and(rule('Priority', 'gt', 'Medium'))).ids).toEqual([a.id]);
	});

	it('ignores a rule whose field was removed, and reports it', () => {
		const r = run(and(rule('Effort', 'is', 'Large'), rule('native:weight', 'gt', 2)));
		expect(r.ids).toEqual([a.id]);
		expect(r.reports[0].broken).toBe('field removed');
		expect(r.reports[0].text).toContain('Effort');
	});

	it('ignores a rule whose options were all removed; keeps the rest when some are', () => {
		const gone = run(and(rule('Priority', 'is', 'Urgent!!')));
		expect(gone.ids).toEqual(ids(all));
		expect(gone.reports[0].broken).toBe('option removed');
		const part = run(and(rule('Priority', 'anyOf', ['Urgent!!', 'Low'])));
		expect(part.ids).toEqual([b.id]);
		expect(part.reports[0].partial).toMatch(/Urgent!!/);
	});

	it('the kiosk has no "me": the rule matches nobody, but is not broken', () => {
		const r = run(and(rule('native:assignees', 'anyOf', ['me'])), ctx([prio], { currentUserId: null }));
		expect(r.ids).toEqual([]);
		expect(r.reports[0].broken).toBeNull();
	});

	it('reports a comparison that does not fit the field', () => {
		const r = run(and(rule('native:weight', 'gt', 'abc')));
		expect(r.reports[0].broken).toBe('not a number');
		expect(r.ids).toEqual(ids(all));
	});

	it('parses relative dates', () => {
		expect(parseDateValue('today', NOW)).toBe(Date.parse('2026-11-10T00:00:00Z'));
		expect(parseDateValue('today-3', NOW)).toBe(Date.parse('2026-11-07T00:00:00Z'));
		expect(parseDateValue('nope', NOW)).toBeNull();
	});
});

describe('completed window and scope', () => {
	const cx = ctx();
	const done1 = item({ 'native:status': opt('s-done') }, { state: 'closed', closedAt: '2026-11-09T20:00:00Z' });
	const done10 = item({ 'native:status': opt('s-done') }, { state: 'closed', closedAt: '2026-10-31T00:00:00Z' });
	const canceled = item({ 'native:status': opt('s-nope') }, { state: 'closed', closedAt: '2026-11-08T00:00:00Z' });
	const open = item({ 'native:status': opt('s-todo') });

	it('filters completed and canceled items like Linear', () => {
		const pass = (w: Parameters<typeof inCompletedWindow>[1]) => [done1, done10, canceled, open].filter((i) => inCompletedWindow(i, w, cx)).length;
		expect(pass('none')).toBe(1);
		expect(pass('day')).toBe(2);
		expect(pass('week')).toBe(3);
		expect(pass('month')).toBe(4);
		expect(pass('all')).toBe(4);
		expect([done10].filter((i) => inCompletedWindow(i, 'all', { ...cx, closedDaysMax: 5 }))).toHaveLength(0);
	});

	it('scopes to a team (project) and to an epic subtree', () => {
		const epic = item({}, { type: 'Epic', projectId: null });
		const child = item({}, { parentId: epic.id, projectId: 'g/web' });
		const grandchild = item({}, { parentId: child.id });
		const byId = new Map([epic, child, grandchild].map((i) => [i.id, i]));
		expect(inScope(child, { projects: ['g/web'] }, byId)).toBe(true);
		expect(inScope(grandchild, { projects: ['g/web'] }, byId)).toBe(false);
		expect(inScope(grandchild, { epics: [epic.id] }, byId)).toBe(true);
		expect(inScope(epic, { epics: [epic.id] }, byId)).toBe(false);
	});
});

describe('grouping', () => {
	const cx = ctx();
	const reg = cx.rank.reg;
	const f = (k: string) => reg.fields.find((x) => x.key === k)!;

	it('groups by options in GitLab order, with a "No …" group last', () => {
		const items = [item({ 'custom:7': P('Low') }), item({ 'custom:7': P('Critical') }), item()];
		const g = groupItems(items, prio, cx, false);
		expect(g.map((x) => [x.label, x.items.length])).toEqual([['Critical', 1], ['Low', 1], ['No priority', 1]]);
		expect(groupItems(items, prio, cx, true).map((x) => x.label)).toEqual(['Critical', 'High', 'Medium', 'Low', 'No priority']);
	});

	it('puts multi-value items in every matching group', () => {
		const x = item({ 'native:assignees': people('u1', 'u2') });
		const g = groupItems([x, item()], f('native:assignees'), cx, false);
		expect(g.map((y) => [y.label, y.items.length])).toEqual([['Alex', 1], ['Sam', 1], ['Unassigned', 1]]);
	});

	it('groups status by category order and keeps removed options visible', () => {
		const items = [item({ 'native:status': opt('s-done') }), item({ 'native:status': opt('s-triage') }), item({ 'native:status': opt('gone') })];
		expect(groupItems(items, f('native:status'), cx, false).map((g) => g.label)).toEqual(['Triage', 'Done', '(removed option)']);
	});

	it('nests, flattens or hides sub-issues', () => {
		const parent = item();
		const child = item({}, { parentId: parent.id });
		const orphan = item({}, { parentId: 'elsewhere' });
		expect(arrangeRows([child, parent, orphan], 'nested').map((r) => [r.item.id, r.depth])).toEqual([
			[parent.id, 0],
			[child.id, 1],
			[orphan.id, 0]
		]);
		expect(arrangeRows([child, parent, orphan], 'hidden').map((r) => r.item.id)).toEqual([parent.id, orphan.id]);
		expect(arrangeRows([child, parent], 'flat')).toHaveLength(2);
	});
});

describe('sorting', () => {
	const cx = ctx();
	it('sorts by option rank, empties last, completed at the bottom', () => {
		const low = item({ 'custom:7': P('Low') });
		const crit = item({ 'custom:7': P('Critical') });
		const none = item();
		const doneCrit = item({ 'custom:7': P('Critical'), 'native:status': opt('s-done') }, { state: 'closed' });
		const desc = sortItems([low, none, doneCrit, crit], [{ field: { name: 'Priority' }, dir: 'desc' }], cx);
		expect(ids(desc)).toEqual([crit.id, low.id, none.id, doneCrit.id]);
		const asc = sortItems([low, none, crit], [{ field: { name: 'Priority' }, dir: 'asc' }], cx);
		expect(ids(asc)).toEqual([low.id, crit.id, none.id]);
	});

	it('sorts numbers and dates, and ignores a removed sort field', () => {
		const a = item({ 'native:weight': num(1), 'native:dueDate': date('2026-12-01') });
		const b = item({ 'native:weight': num(8), 'native:dueDate': date('2026-11-15') });
		expect(ids(sortItems([a, b], [{ field: { field: 'native:weight' }, dir: 'desc' }], cx))).toEqual([b.id, a.id]);
		expect(ids(sortItems([a, b], [{ field: { field: 'native:dueDate' }, dir: 'asc' }], cx))).toEqual([b.id, a.id]);
		expect(sortItems([a, b], [{ field: { name: 'Gone' }, dir: 'asc' }], cx)).toHaveLength(2);
	});
});

describe('runView', () => {
	it('runs a whole view and reports a removed group-by field', () => {
		const view: ViewDefinition = {
			version: 1,
			id: 'v',
			name: 'V',
			layout: 'list',
			filter: and(rule('native:type', 'noneOf', ['Epic'])),
			groupBy: { name: 'Effort' },
			subGroupBy: { field: 'native:status' },
			orderBy: [],
			display: { properties: [], subIssues: 'nested', showEmptyGroups: false, completed: 'week' }
		};
		const items = [item({ 'native:status': opt('s-todo') }), item({}, { type: 'Epic' })];
		const r = runView(items, view, ctx());
		expect(r.items).toHaveLength(1);
		expect(r.groupProblem).toMatch(/Effort/);
		expect(r.groups).toHaveLength(1);
		expect(r.groups[0].sub!.map((s) => s.label)).toEqual(['To do']);
	});
});

describe('grouping by values the registry does not know (review H1)', () => {
	const parentField = selectField('native:parent', 'Parent', ['Loaded epic'], { kind: 'ref' });
	const loaded = parentField.options![0].id;
	const ref = (id: string) => ({ kind: 'ref' as const, id });
	const cx = ctx([parentField]);

	it('makes one group per distinct unknown value, not one per item', () => {
		const items = [
			item({ 'native:parent': ref('gid://gitlab/WorkItem/999') }),
			item({ 'native:parent': ref('gid://gitlab/WorkItem/999') }),
			item({ 'native:parent': ref('gid://gitlab/WorkItem/998') }),
			item({ 'native:parent': ref(loaded) })
		];
		const groups = groupItems(items, parentField, cx, false);
		const keys = groups.map((g) => g.key);
		// Duplicate keys crash Svelte's keyed {#each} and blank the page.
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toEqual([loaded, 'gid://gitlab/WorkItem/999', 'gid://gitlab/WorkItem/998']);
		expect(groups[1].items).toHaveLength(2);
		expect(groups[1].label).toBe(PARENT_NOT_LOADED);
	});

	it('keeps unknown projects as their own groups too', () => {
		const projectField = selectField('native:project', 'Project', ['api'], { kind: 'ref' });
		const items = [item({ 'native:project': ref('acme/archived') }), item({ 'native:project': ref('acme/archived') })];
		const groups = groupItems(items, projectField, ctx([projectField]), false);
		expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([['acme/archived', 'acme/archived', 2]]);
	});
});
