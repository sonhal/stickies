/** Epic progress and lists. Pure. */
import { PARENT_NOT_LOADED, appliesTo, closedKind, optionById, personName, statusOption, valueIds } from '$lib/fields/registry';
import type { FieldDef, FieldKey, FieldRegistry, OptionDef, WorkItem } from '$lib/fields/types';

export const isEpic = (i: WorkItem) => i.type.toLowerCase() === 'epic';

export interface Progress {
	closed: number;
	total: number;
	/** 'gitlab': rolled-up counts from GitLab (all children, also ones closed long ago);
	 *  'board': counted from the direct children the board fetched */
	source: 'gitlab' | 'board';
}

export function childrenOf(epic: WorkItem, items: WorkItem[]): WorkItem[] {
	return items.filter((i) => i.parentId === epic.id);
}

export function epicProgress(epic: WorkItem, items: WorkItem[], reg: FieldRegistry): Progress {
	if (epic.progress && epic.progress.total > 0) return { ...epic.progress, source: 'gitlab' };
	const kids = childrenOf(epic, items);
	return { closed: kids.filter((k) => closedKind(reg, k)).length, total: kids.length, source: 'board' };
}

export const pct = (p: Progress) => (p.total ? Math.round((p.closed / p.total) * 100) : 0);

/** The numeric id used in /epics/<id> URLs */
export const epicSlug = (id: string) => id.slice(id.lastIndexOf('/') + 1);

// ---- The epics list: rows, filter, sort, group, and its state in the URL ----------------------

export const EPIC_SORT_KEYS = ['title', 'progress', 'open', 'start', 'due'] as const;
export type EpicSortKey = (typeof EPIC_SORT_KEYS)[number];
export const EPIC_GROUP_KEYS = ['none', 'status', 'assignee', 'parent'] as const;
export type EpicGroupKey = (typeof EPIC_GROUP_KEYS)[number];
export type SortDir = 'asc' | 'desc';

/** Assignee filter values that are not a person id */
export const ASSIGNEE_ME = 'me';
export const ASSIGNEE_NONE = 'none';

/** What the user chose on the epics list. Lives in the URL, so reload and sharing keep it. */
export interface EpicListState {
	q: string;
	/** Status option ids. Empty = any. */
	status: string[];
	/** Person ids, ASSIGNEE_ME or ASSIGNEE_NONE. Empty = any. */
	assignee: string[];
	/** Label option ids. Empty = any. */
	label: string[];
	/** Also show epics that are done or canceled */
	closed: boolean;
	sort: EpicSortKey;
	dir: SortDir;
	group: EpicGroupKey;
}

export const EPIC_LIST_DEFAULTS: EpicListState = {
	q: '',
	status: [],
	assignee: [],
	label: [],
	closed: false,
	sort: 'due',
	dir: 'asc',
	group: 'none'
};

export interface EpicRow {
	e: WorkItem;
	progress: Progress;
	/** Direct children on the board that are not done or canceled */
	open: number;
	/** YYYY-MM-DD, or '' */
	start: string;
	due: string;
	closed: 'done' | 'canceled' | null;
	status: OptionDef | null;
	assignees: string[];
	labels: string[];
}

export interface EpicGroup {
	/** Unique within one grouping; '' for "nothing set" and for the single group of "no grouping" */
	key: string;
	label: string;
	rows: EpicRow[];
	/** Group by status: the option (null = no status) */
	status?: OptionDef | null;
	/** Group by assignee: the person (null = unassigned) */
	personId?: string | null;
}

/** The field, if this GitLab has it and it is enabled for epics. */
export function epicField(reg: FieldRegistry, key: FieldKey): FieldDef | null {
	const f = reg.fields.find((x) => x.key === key);
	return f && appliesTo(f, 'Epic') ? f : null;
}

const dateOf = (i: WorkItem, key: FieldKey): string => {
	const v = i.values[key];
	return v?.kind === 'date' ? v.value.slice(0, 10) : '';
};

/** One row per epic in `items`, in the items' order. */
export function epicRows(items: WorkItem[], reg: FieldRegistry): EpicRow[] {
	return items.filter(isEpic).map((e) => ({
		e,
		progress: epicProgress(e, items, reg),
		open: childrenOf(e, items).filter((k) => !closedKind(reg, k)).length,
		start: dateOf(e, 'native:startDate'),
		due: dateOf(e, 'native:dueDate'),
		closed: closedKind(reg, e),
		status: statusOption(reg, e),
		assignees: valueIds(e.values['native:assignees']),
		labels: valueIds(e.values['native:labels'])
	}));
}

/** Any of the picked values within one filter, all of the filters together. */
export function filterEpicRows(rows: EpicRow[], s: EpicListState, reg: FieldRegistry): EpicRow[] {
	const q = s.q.trim().toLowerCase();
	const people = new Set(s.assignee.map((a) => (a === ASSIGNEE_ME ? (reg.currentUserId ?? '') : a)));
	return rows.filter((r) => {
		if (!s.closed && r.closed) return false;
		if (q && !r.e.title.toLowerCase().includes(q) && !r.e.ref.toLowerCase().includes(q)) return false;
		if (s.status.length && !(r.status && s.status.includes(r.status.id))) return false;
		if (s.assignee.length) {
			const hit = r.assignees.length ? r.assignees.some((id) => people.has(id)) : people.has(ASSIGNEE_NONE);
			if (!hit) return false;
		}
		if (s.label.length && !r.labels.some((id) => s.label.includes(id))) return false;
		return true;
	});
}

/** True when search or a picker narrows the list (not the "recently closed" toggle, sort or grouping). */
export function hasEpicFilters(s: EpicListState): boolean {
	return !!s.q.trim() || s.status.length > 0 || s.assignee.length > 0 || s.label.length > 0;
}

/**
 * Sorted copy. Ties fall back to the title, so the order is the same after every reload.
 * Epics without a date go last in both directions: "no date" is not "earliest".
 */
export function sortEpicRows(rows: EpicRow[], sort: EpicSortKey, dir: SortDir): EpicRow[] {
	const sign = dir === 'desc' ? -1 : 1;
	const byTitle = (a: EpicRow, b: EpicRow) => a.e.title.localeCompare(b.e.title);
	const byDate = (x: string, y: string) => (x && y ? sign * x.localeCompare(y) : x ? -1 : y ? 1 : 0);
	const cmp = (a: EpicRow, b: EpicRow): number => {
		switch (sort) {
			case 'title':
				return sign * byTitle(a, b);
			case 'progress':
				return sign * (pct(a.progress) - pct(b.progress));
			case 'open':
				return sign * (a.open - b.open);
			case 'start':
				return byDate(a.start, b.start);
			case 'due':
				return byDate(a.due, b.due);
		}
	};
	return [...rows].sort((a, b) => cmp(a, b) || byTitle(a, b));
}

/**
 * Split rows into groups, keeping the rows' order inside each group. The "nothing set" group
 * goes last. An epic with several assignees is in each of their groups, so a row is only unique
 * together with its group key.
 */
export function groupEpicRows(rows: EpicRow[], group: EpicGroupKey, reg: FieldRegistry, items: WorkItem[] = []): EpicGroup[] {
	if (group === 'none') return [{ key: '', label: '', rows }];
	// '' can't clash with an id from GitLab.
	const NONE = '';
	const groups = new Map<string, EpicGroup>();
	const add = (key: string, row: EpicRow, make: () => Omit<EpicGroup, 'key' | 'rows'>) => {
		let g = groups.get(key);
		if (!g) groups.set(key, (g = { key, rows: [], ...make() }));
		g.rows.push(row);
	};
	let order = (a: EpicGroup, b: EpicGroup) => a.label.localeCompare(b.label);

	if (group === 'status') {
		for (const r of rows) add(r.status?.id ?? NONE, r, () => ({ label: r.status?.label ?? 'No status', status: r.status }));
		order = (a, b) => (a.status?.position ?? 0) - (b.status?.position ?? 0);
	} else if (group === 'assignee') {
		for (const r of rows) {
			if (!r.assignees.length) add(NONE, r, () => ({ label: 'Unassigned', personId: null }));
			for (const id of new Set(r.assignees)) add(id, r, () => ({ label: personName(reg, id), personId: id }));
		}
	} else {
		const titles = new Map(items.map((i) => [i.id, i.title]));
		const parents = reg.fields.find((f) => f.key === 'native:parent');
		for (const r of rows) {
			const id = r.e.parentId;
			add(id ?? NONE, r, () => ({
				label: id ? (titles.get(id) ?? (parents && optionById(parents, id)?.label) ?? PARENT_NOT_LOADED) : 'No parent epic'
			}));
		}
	}
	return [...groups.values()].sort((a, b) => Number(a.key === NONE) - Number(b.key === NONE) || order(a, b));
}

const MAX_Q = 200;
const MAX_PICKS = 50;

/**
 * Read the list state from the URL (?q= &status= &assignee= &label= &closed=1 &sort= &dir= &group=;
 * status, assignee and label can repeat). Anything unknown falls back to the default and nothing
 * throws: the URL can be hand-edited, old, or shared by someone who sees other fields.
 */
export function parseEpicListState(params: URLSearchParams, reg: FieldRegistry): EpicListState {
	const oneOf = <T extends string>(all: readonly T[], v: string | null, fallback: T): T =>
		all.includes(v as T) ? (v as T) : fallback;
	const picks = (name: string, ok: (id: string) => boolean) =>
		[...new Set(params.getAll(name))].filter(ok).slice(0, MAX_PICKS);

	const status = epicField(reg, 'native:status');
	const assignees = epicField(reg, 'native:assignees');
	const labels = epicField(reg, 'native:labels');
	const people = new Set(reg.people.map((p) => p.id));

	let group = oneOf(EPIC_GROUP_KEYS, params.get('group'), EPIC_LIST_DEFAULTS.group);
	if ((group === 'status' && !status) || (group === 'assignee' && !assignees)) group = 'none';

	return {
		q: (params.get('q') ?? '').slice(0, MAX_Q),
		status: picks('status', (id) => !!status && !!optionById(status, id)),
		assignee: picks(
			'assignee',
			(id) => !!assignees && (id === ASSIGNEE_NONE || (id === ASSIGNEE_ME ? !!reg.currentUserId : people.has(id)))
		),
		label: picks('label', (id) => !!labels && !!optionById(labels, id)),
		closed: params.get('closed') === '1',
		sort: oneOf(EPIC_SORT_KEYS, params.get('sort'), EPIC_LIST_DEFAULTS.sort),
		dir: oneOf(['asc', 'desc'] as const, params.get('dir'), EPIC_LIST_DEFAULTS.dir),
		group
	};
}

/** The query string for a state, without "?". Defaults are left out, so the plain list is just /epics. */
export function epicListQuery(s: EpicListState): string {
	const p = new URLSearchParams();
	if (s.q) p.set('q', s.q.slice(0, MAX_Q));
	for (const id of s.status) p.append('status', id);
	for (const id of s.assignee) p.append('assignee', id);
	for (const id of s.label) p.append('label', id);
	if (s.closed) p.set('closed', '1');
	if (s.sort !== EPIC_LIST_DEFAULTS.sort) p.set('sort', s.sort);
	if (s.dir !== EPIC_LIST_DEFAULTS.dir) p.set('dir', s.dir);
	if (s.group !== EPIC_LIST_DEFAULTS.group) p.set('group', s.group);
	return p.toString();
}

/** Clicking a column header: the same column flips direction, another column starts ascending. */
export function toggleEpicSort(s: EpicListState, key: EpicSortKey): EpicListState {
	return s.sort === key ? { ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { ...s, sort: key, dir: 'asc' };
}
