import { describe, expect, it } from 'vitest';
import { registry, item, opt, date, people, many } from '$lib/testing/factory';
import type { FieldRegistry, FieldValue, WorkItem } from '$lib/fields/types';
import {
	EPIC_LIST_DEFAULTS,
	epicField,
	epicListQuery,
	epicProgress,
	epicRows,
	epicSlug,
	filterEpicRows,
	groupEpicRows,
	hasEpicFilters,
	parseEpicListState,
	pct,
	sortEpicRows,
	toggleEpicSort,
	type EpicListState
} from './epics';

describe('epic progress', () => {
	const reg = registry();
	it('prefers GitLab rolled-up counts', () => {
		const e = item({}, { type: 'Epic', progress: { total: 10, closed: 4 } });
		expect(epicProgress(e, [], reg)).toEqual({ total: 10, closed: 4, source: 'gitlab' });
	});
	it('falls back to the direct children on the board', () => {
		const e = item({}, { type: 'Epic' });
		const kids = [
			item({ 'native:status': opt('s-done') }, { parentId: e.id, state: 'closed' }),
			item({ 'native:status': opt('s-nope') }, { parentId: e.id, state: 'closed' }),
			item({ 'native:status': opt('s-todo') }, { parentId: e.id })
		];
		const p = epicProgress(e, kids, reg);
		expect(p).toEqual({ total: 3, closed: 2, source: 'board' });
		expect(pct(p)).toBe(67);
		expect(pct({ total: 0, closed: 0, source: 'board' })).toBe(0);
		expect(epicSlug('gid://gitlab/WorkItem/900')).toBe('900');
	});
});

/** The factory's status field is for issues and tasks only; this registry also has it on epics. */
function epicRegistry(extra: Partial<FieldRegistry> = {}): FieldRegistry {
	const reg = registry([], extra);
	return { ...reg, fields: reg.fields.map((f) => (f.key === 'native:status' ? { ...f, appliesTo: ['Issue', 'Task', 'Epic'] } : f)) };
}
const epic = (title: string, values: Partial<Record<string, FieldValue>> = {}, extra: Partial<WorkItem> = {}) =>
	item(values, { type: 'Epic', title, ...extra });
const state = (s: Partial<EpicListState> = {}): EpicListState => ({ ...EPIC_LIST_DEFAULTS, ...s });
const titles = (rows: { e: WorkItem }[]) => rows.map((r) => r.e.title);

describe('epic list rows', () => {
	const reg = epicRegistry();
	it('builds one row per epic with dates, open count, status and people', () => {
		const e = epic('Payments', {
			'native:status': opt('s-doing'),
			'native:assignees': people('u1', 'u2'),
			'native:labels': many('l-bug'),
			'native:startDate': date('2026-10-01'),
			'native:dueDate': date('2026-12-24T00:00:00Z')
		});
		const items = [
			e,
			item({ 'native:status': opt('s-todo') }, { parentId: e.id }),
			item({ 'native:status': opt('s-done') }, { parentId: e.id }),
			item({}, {})
		];
		const rows = epicRows(items, reg);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ open: 1, start: '2026-10-01', due: '2026-12-24', closed: null, assignees: ['u1', 'u2'], labels: ['l-bug'] });
		expect(rows[0].status?.id).toBe('s-doing');
		expect(rows[0].progress).toEqual({ total: 2, closed: 1, source: 'board' });
	});

	it('knows whether a field is enabled for epics', () => {
		expect(epicField(reg, 'native:status')?.key).toBe('native:status');
		expect(epicField(registry(), 'native:status')).toBeNull();
		expect(epicField(registry(), 'native:assignees')?.key).toBe('native:assignees');
		expect(epicField(reg, 'custom:nope')).toBeNull();
	});
});

describe('epic list filter', () => {
	const reg = epicRegistry();
	const a = epic('Payments v2', { 'native:status': opt('s-doing'), 'native:assignees': people('u1'), 'native:labels': many('l-bug', 'l-be') });
	const b = epic('Onboarding', { 'native:status': opt('s-todo'), 'native:assignees': people('u2'), 'native:labels': many('l-fe') }, { ref: 'g&77' });
	const c = epic('Observability', {});
	const d = epic('Old stuff', { 'native:status': opt('s-done') }, { state: 'closed' });
	const rows = epicRows([a, b, c, d], reg);
	const run = (s: Partial<EpicListState>, r = reg) => titles(filterEpicRows(rows, state(s), r));

	it('hides closed epics unless asked', () => {
		expect(run({})).toEqual(['Payments v2', 'Onboarding', 'Observability']);
		expect(run({ closed: true })).toHaveLength(4);
	});
	it('searches title and reference, ignoring case', () => {
		expect(run({ q: ' PAY ' })).toEqual(['Payments v2']);
		expect(run({ q: 'g&77' })).toEqual(['Onboarding']);
		expect(run({ q: 'zzz' })).toEqual([]);
	});
	it('filters by status, assignee and label', () => {
		expect(run({ status: ['s-todo', 's-doing'] })).toEqual(['Payments v2', 'Onboarding']);
		expect(run({ assignee: ['u2'] })).toEqual(['Onboarding']);
		expect(run({ assignee: ['me'] })).toEqual(['Payments v2']);
		expect(run({ assignee: ['none'] })).toEqual(['Observability']);
		expect(run({ assignee: ['me', 'none'] })).toEqual(['Payments v2', 'Observability']);
		expect(run({ label: ['l-fe', 'l-be'] })).toEqual(['Payments v2', 'Onboarding']);
		expect(run({ label: ['l-bug'], assignee: ['u2'] })).toEqual([]);
	});
	it('"me" matches nobody when no one is signed in', () => {
		expect(run({ assignee: ['me'] }, epicRegistry({ currentUserId: null }))).toEqual([]);
	});
	it('tells filters apart from sort, grouping and the closed toggle', () => {
		expect(hasEpicFilters(state({ sort: 'title', group: 'status', closed: true }))).toBe(false);
		expect(hasEpicFilters(state({ q: 'x' }))).toBe(true);
		expect(hasEpicFilters(state({ label: ['l-bug'] }))).toBe(true);
	});
});

describe('epic list sort', () => {
	const reg = epicRegistry();
	const a = epic('Beta', { 'native:dueDate': date('2026-12-01'), 'native:startDate': date('2026-09-01') }, { progress: { total: 4, closed: 3 } });
	const b = epic('alpha', { 'native:dueDate': date('2026-11-20') }, { progress: { total: 4, closed: 1 } });
	const c = epic('Delta', {}, { progress: { total: 4, closed: 1 } });
	const d = epic('Charlie', {});
	const kids = [item({}, { parentId: d.id }), item({}, { parentId: d.id }), item({}, { parentId: a.id })];
	const rows = epicRows([a, b, c, d, ...kids], reg);
	const run = (...args: [Parameters<typeof sortEpicRows>[1], Parameters<typeof sortEpicRows>[2]]) => titles(sortEpicRows(rows, ...args));

	it('default: due date, then title, undated last', () => {
		expect(run(EPIC_LIST_DEFAULTS.sort, EPIC_LIST_DEFAULTS.dir)).toEqual(['alpha', 'Beta', 'Charlie', 'Delta']);
	});
	it('keeps undated epics last when descending too', () => {
		expect(run('due', 'desc')).toEqual(['Beta', 'alpha', 'Charlie', 'Delta']);
		expect(run('start', 'asc')).toEqual(['Beta', 'alpha', 'Charlie', 'Delta']);
		expect(run('start', 'desc')).toEqual(['Beta', 'alpha', 'Charlie', 'Delta']);
	});
	it('sorts by title, progress and open count, ties by title', () => {
		expect(run('title', 'asc')).toEqual(['alpha', 'Beta', 'Charlie', 'Delta']);
		expect(run('title', 'desc')).toEqual(['Delta', 'Charlie', 'Beta', 'alpha']);
		expect(run('progress', 'desc')).toEqual(['Beta', 'alpha', 'Delta', 'Charlie']);
		expect(run('progress', 'asc')).toEqual(['Charlie', 'alpha', 'Delta', 'Beta']);
		expect(run('open', 'desc')).toEqual(['Charlie', 'Beta', 'alpha', 'Delta']);
	});
	it('does not change its input', () => {
		const before = titles(rows);
		sortEpicRows(rows, 'title', 'desc');
		expect(titles(rows)).toEqual(before);
	});
	it('a header click flips the direction, another column starts ascending', () => {
		expect(toggleEpicSort(state(), 'due')).toMatchObject({ sort: 'due', dir: 'desc' });
		expect(toggleEpicSort(state({ dir: 'desc' }), 'due')).toMatchObject({ sort: 'due', dir: 'asc' });
		expect(toggleEpicSort(state({ dir: 'desc' }), 'title')).toMatchObject({ sort: 'title', dir: 'asc' });
	});
});

describe('epic list grouping', () => {
	const reg = epicRegistry();
	const parent = epic('Platform', { 'native:status': opt('s-doing'), 'native:assignees': people('u2', 'u1') });
	const a = epic('Payments', { 'native:status': opt('s-todo'), 'native:assignees': people('u1') }, { parentId: parent.id });
	const b = epic('Billing', { 'native:status': opt('s-doing') }, { parentId: parent.id });
	const c = epic('Elsewhere', {}, { parentId: 'e1' });
	const lost = epic('Lost', {}, { parentId: 'gid://gitlab/WorkItem/unknown' });
	const items = [parent, a, b, c, lost];
	const rows = sortEpicRows(epicRows(items, reg), 'title', 'asc');
	const shape = (g: ReturnType<typeof groupEpicRows>) => g.map((x) => [x.label, titles(x.rows)]);

	it('no grouping is one unnamed group', () => {
		expect(groupEpicRows(rows, 'none', reg, items)).toEqual([{ key: '', label: '', rows }]);
	});
	it('by status: in workflow order, "No status" last, rows keep their order', () => {
		expect(shape(groupEpicRows(rows, 'status', reg, items))).toEqual([
			['To do', ['Payments']],
			['In progress', ['Billing', 'Platform']],
			['No status', ['Elsewhere', 'Lost']]
		]);
	});
	it('by assignee: an epic is under each of its assignees, unassigned last', () => {
		const groups = groupEpicRows(rows, 'assignee', reg, items);
		expect(shape(groups)).toEqual([
			['Alex', ['Payments', 'Platform']],
			['Sam', ['Platform']],
			['Unassigned', ['Billing', 'Elsewhere', 'Lost']]
		]);
		// What the page keys rows by must be unique even though "Platform" is there twice.
		const keys = groups.flatMap((g) => g.rows.map((r) => `${g.key}|${r.e.id}`));
		expect(new Set(keys).size).toBe(keys.length);
		expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
	});
	it('by parent epic: loaded title, then the registry label, then a placeholder', () => {
		expect(shape(groupEpicRows(rows, 'parent', reg, items))).toEqual([
			['Epic one', ['Elsewhere']],
			['Parent not on the board', ['Lost']],
			['Platform', ['Billing', 'Payments']],
			['No parent epic', ['Platform']]
		]);
	});
	it('gives no groups for no rows', () => {
		expect(groupEpicRows([], 'status', reg, items)).toEqual([]);
	});
});

describe('epic list state in the URL', () => {
	const reg = epicRegistry();
	const parse = (qs: string, r = reg) => parseEpicListState(new URLSearchParams(qs), r);

	it('an empty URL is the default, and the default is an empty URL', () => {
		expect(parse('')).toEqual(EPIC_LIST_DEFAULTS);
		expect(epicListQuery(EPIC_LIST_DEFAULTS)).toBe('');
	});
	it('round-trips every setting', () => {
		const s = state({
			q: 'pay & more',
			status: ['s-todo', 's-doing'],
			assignee: ['me', 'none', 'u2'],
			label: ['l-bug'],
			closed: true,
			sort: 'progress',
			dir: 'desc',
			group: 'assignee'
		});
		expect(parse(epicListQuery(s))).toEqual(s);
	});
	it('falls back to defaults for unknown values', () => {
		expect(parse('sort=bogus&dir=sideways&group=__proto__&closed=yes')).toEqual(EPIC_LIST_DEFAULTS);
		expect(parse('sort=constructor&status=&assignee=&label=%00')).toEqual(EPIC_LIST_DEFAULTS);
	});
	it('drops picks the registry does not know, and duplicates', () => {
		expect(parse('status=s-todo&status=gone&status=s-todo&assignee=u9&assignee=u2&label=l-bug&label=nope')).toMatchObject({
			status: ['s-todo'],
			assignee: ['u2'],
			label: ['l-bug']
		});
	});
	it('drops "me" for the kiosk, and status when epics have none', () => {
		expect(parse('assignee=me&assignee=none', epicRegistry({ currentUserId: null })).assignee).toEqual(['none']);
		const noStatus = parse('status=s-todo&group=status&sort=title', registry());
		expect(noStatus).toMatchObject({ status: [], group: 'none', sort: 'title' });
	});
	it('caps the search text', () => {
		expect(parse(`q=${'x'.repeat(500)}`).q).toHaveLength(200);
	});
});
