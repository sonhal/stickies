/**
 * The query engine: filter → group → sort, over the viewer's own items, in the browser.
 * Pure and unit-tested. Never throws on a bad view: rules that reference a missing field or
 * option are reported (for the "field removed" chips) and ignored.
 */
import {
	closedAt,
	closedKind,
	formatValue,
	isEmptyValue,
	optionRank,
	orderedOptions,
	refLabel,
	resolveField,
	resolveOption,
	unknownOptionLabel,
	valueIds
} from '$lib/fields/registry';
import { STATUS_CATEGORIES, type FieldDef, type FieldRegistry, type OptionDef, type WorkItem } from '$lib/fields/types';
import { rankDirectionFor, type RankContext } from './rank';
import {
	COMPLETED_DAYS,
	isGroup,
	type CompletedWindow,
	type FilterGroup,
	type FilterRule,
	type OrderBy,
	type SubIssues,
	type ViewDefinition,
	type ViewScope
} from './types';

export interface EngineContext {
	rank: RankContext;
	now: Date;
	closedDaysMax: number;
}

const reg = (ctx: EngineContext): FieldRegistry => ctx.rank.reg;
const DAY_MS = 86_400_000;

// ---- Filters ------------------------------------------------------------------------------------

export interface RuleReport {
	rule: FilterRule;
	/** Index path inside the filter tree, for editing/removing the chip */
	path: number[];
	field: FieldDef | null;
	/** The rule is ignored: its field or every option it names is gone */
	broken: string | null;
	/** Some option values didn't resolve; the rest still apply */
	partial: string | null;
	/** Human summary, e.g. "Priority is High, Critical" */
	text: string;
}

type Pred = (item: WorkItem) => boolean;

const CMP_TEXT: Record<FilterRule['cmp'], string> = {
	is: 'is',
	isNot: 'is not',
	anyOf: 'is any of',
	noneOf: 'is none of',
	empty: 'is empty',
	notEmpty: 'is set',
	gt: '>',
	lt: '<',
	before: 'before',
	after: 'after',
	contains: 'contains'
};

const asList = (v: FilterRule['value']): string[] =>
	v === undefined ? [] : Array.isArray(v) ? v.map(String) : [String(v)];

/** `today`, `today+7`, `today-30`, or YYYY-MM-DD → UTC day start in ms */
export function parseDateValue(v: string, now: Date): number | null {
	const m = /^today\s*([+-])\s*(\d{1,4})$/.exec(v.trim()) ?? (v.trim() === 'today' ? ['', '+', '0'] : null);
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	if (m) return today + (m[1] === '-' ? -1 : 1) * Number(m[2]) * DAY_MS;
	if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
		const t = Date.parse(`${v.slice(0, 10)}T00:00:00Z`);
		return Number.isNaN(t) ? null : t;
	}
	return null;
}

const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Option-like values → the ids they mean. Returns resolved ids and the values that didn't resolve. */
function resolveIds(field: FieldDef, values: string[], r: FieldRegistry): { ids: Set<string>; missing: string[] } {
	const ids = new Set<string>();
	const missing: string[] = [];
	for (const v of values) {
		if (field.kind === 'people') {
			if (v === 'me') {
				if (r.currentUserId) ids.add(r.currentUserId);
				continue; // the kiosk has no "me": matches nobody, but isn't "removed"
			}
			const p = r.people.find((x) => x.id === v || x.username.toLowerCase() === v.toLowerCase());
			if (p) ids.add(p.id);
			else missing.push(v);
			continue;
		}
		if (field.kind === 'status' && v.startsWith('category:')) {
			const cat = v.slice(9);
			for (const o of field.options ?? []) if (o.category === cat) ids.add(o.id);
			if (!(STATUS_CATEGORIES as readonly string[]).includes(cat)) missing.push(v);
			continue;
		}
		const o = resolveOption(field, v);
		if (o) ids.add(o.id);
		else if (field.key === 'native:project' || field.key === 'native:parent') ids.add(v); // refs can point outside the option list
		else missing.push(v);
	}
	return { ids, missing };
}

function compileRule(rule: FilterRule, path: number[], ctx: EngineContext, reports: RuleReport[]): Pred | null {
	const r = reg(ctx);
	const field = resolveField(r, rule.field);
	const values = asList(rule.value);
	const report: RuleReport = { rule, path, field, broken: null, partial: null, text: '' };
	reports.push(report);
	if (!field) {
		report.broken = 'field removed';
		report.text = `${refLabel(rule.field)} (field removed)`;
		return null;
	}
	const key = field.key;
	const get = (i: WorkItem) => i.values[key];
	const valueText = (shown: string[]) => (shown.length ? ` ${shown.join(', ')}` : '');

	if (rule.cmp === 'empty' || rule.cmp === 'notEmpty') {
		report.text = `${field.name} ${CMP_TEXT[rule.cmp]}`;
		return rule.cmp === 'empty' ? (i) => isEmptyValue(get(i)) : (i) => !isEmptyValue(get(i));
	}

	switch (field.kind) {
		case 'singleSelect':
		case 'multiSelect':
		case 'status':
		case 'ref':
		case 'people': {
			const { ids, missing } = resolveIds(field, values, r);
			const labels = values
				.filter((v) => !missing.includes(v))
				.map((v) =>
					v === 'me'
						? 'me'
						: v.startsWith('category:')
							? v.slice(9)
							: field.kind === 'people'
								? (r.people.find((p) => p.id === v || p.username === v)?.name ?? v)
								: (resolveOption(field, v)?.label ?? v)
				);
			report.text = `${field.name} ${CMP_TEXT[rule.cmp]}${valueText(labels)}`;
			if (values.length && ids.size === 0 && missing.length === values.length) {
				report.broken = values.length === 1 ? 'option removed' : 'options removed';
				report.text = `${field.name} ${CMP_TEXT[rule.cmp]} ${values.join(', ')} (${report.broken})`;
				return null;
			}
			if (missing.length) report.partial = `${missing.join(', ')} no longer exist${missing.length === 1 ? 's' : ''}`;
			const hit = (i: WorkItem) => valueIds(get(i)).some((id) => ids.has(id));
			if (rule.cmp === 'is' || rule.cmp === 'anyOf' || rule.cmp === 'contains') return hit;
			if (rule.cmp === 'isNot' || rule.cmp === 'noneOf') return (i) => !hit(i);
			if (rule.cmp === 'gt' || rule.cmp === 'lt') {
				// option order comparisons (e.g. Priority > Medium), using the rank direction
				const dir = rankDirectionFor(ctx.rank, field);
				const pivot = [...ids][0];
				const pr = pivot ? optionRank(field, pivot, dir) : null;
				if (!pr) return null;
				return (i) =>
					valueIds(get(i)).some((id) => {
						const ir = optionRank(field, id, dir);
						return !!ir && (rule.cmp === 'gt' ? ir.rank > pr.rank : ir.rank < pr.rank);
					});
			}
			break;
		}
		case 'number': {
			const n = Number(values[0]);
			report.text = `${field.name} ${CMP_TEXT[rule.cmp]} ${values[0] ?? ''}`.trim();
			if (!Number.isFinite(n)) {
				report.broken = 'not a number';
				return null;
			}
			const num = (i: WorkItem) => {
				const v = get(i);
				return v?.kind === 'number' ? v.value : null;
			};
			if (rule.cmp === 'is') return (i) => num(i) === n;
			if (rule.cmp === 'isNot') return (i) => num(i) !== n;
			if (rule.cmp === 'gt') return (i) => (num(i) ?? -Infinity) > n;
			if (rule.cmp === 'lt') return (i) => (num(i) ?? Infinity) < n;
			break;
		}
		case 'date': {
			const t = values[0] !== undefined ? parseDateValue(values[0], ctx.now) : null;
			report.text = `${field.name} ${CMP_TEXT[rule.cmp]} ${values[0] ?? ''}`.trim();
			if (t === null) {
				report.broken = 'not a date';
				return null;
			}
			const day = (i: WorkItem) => {
				const v = get(i);
				return v?.kind === 'date' ? dayOf(v.value) : null;
			};
			if (rule.cmp === 'is') return (i) => day(i) === t;
			if (rule.cmp === 'isNot') return (i) => day(i) !== t;
			if (rule.cmp === 'before' || rule.cmp === 'lt') return (i) => (day(i) ?? Infinity) < t;
			if (rule.cmp === 'after' || rule.cmp === 'gt') return (i) => (day(i) ?? -Infinity) > t;
			break;
		}
		case 'text': {
			const needle = (values[0] ?? '').toLowerCase();
			report.text = `${field.name} ${CMP_TEXT[rule.cmp]} "${values[0] ?? ''}"`;
			const txt = (i: WorkItem) => formatValue(r, field, get(i)).toLowerCase();
			if (rule.cmp === 'contains') return (i) => txt(i).includes(needle);
			if (rule.cmp === 'is') return (i) => txt(i) === needle;
			if (rule.cmp === 'isNot') return (i) => txt(i) !== needle;
			break;
		}
	}
	report.broken = `"${CMP_TEXT[rule.cmp]}" doesn't work on ${field.name}`;
	return null;
}

function compileGroup(g: FilterGroup, path: number[], ctx: EngineContext, reports: RuleReport[], depth: number): Pred | null {
	if (depth > 6) return null;
	const preds = (g.rules ?? [])
		.map((r, i) =>
			isGroup(r) ? compileGroup(r, [...path, i], ctx, reports, depth + 1) : compileRule(r, [...path, i], ctx, reports)
		)
		.filter((p): p is Pred => !!p);
	if (preds.length === 0) return null;
	return g.op === 'or' ? (i) => preds.some((p) => p(i)) : (i) => preds.every((p) => p(i));
}

export function compileFilter(g: FilterGroup | undefined, ctx: EngineContext): { test: Pred; reports: RuleReport[] } {
	const reports: RuleReport[] = [];
	const p = g ? compileGroup(g, [], ctx, reports, 0) : null;
	return { test: p ?? (() => true), reports };
}

/** Free-text quick search over title and reference. */
export function matchesSearch(item: WorkItem, q: string): boolean {
	const s = q.trim().toLowerCase();
	if (!s) return true;
	return item.title.toLowerCase().includes(s) || item.ref.toLowerCase().includes(s);
}

/** Linear-style completed window: open items always pass. */
export function inCompletedWindow(item: WorkItem, w: CompletedWindow, ctx: EngineContext): boolean {
	if (!closedKind(reg(ctx), item)) return true;
	const days = Math.min(COMPLETED_DAYS[w], ctx.closedDaysMax);
	if (days <= 0) return false;
	return Date.parse(closedAt(item)) >= ctx.now.getTime() - days * DAY_MS;
}

/** Team (project) and epic scope. An epic scope includes the epic's whole subtree. */
export function inScope(item: WorkItem, scope: ViewScope | undefined, byId: Map<string, WorkItem>): boolean {
	if (!scope) return true;
	if (scope.projects?.length && !(item.projectId && scope.projects.includes(item.projectId))) return false;
	if (scope.epics?.length) {
		let cur: WorkItem | undefined = item;
		for (let d = 0; d < 8 && cur?.parentId; d++) {
			if (scope.epics.includes(cur.parentId)) return true;
			cur = byId.get(cur.parentId);
		}
		return false;
	}
	return true;
}

// ---- Sorting ----------------------------------------------------------------------------------

type SortKey = number | string | null;

function sortKeyFn(field: FieldDef, ctx: EngineContext): (i: WorkItem) => SortKey {
	const r = reg(ctx);
	const dir = rankDirectionFor(ctx.rank, field);
	return (i) => {
		const v = i.values[field.key];
		if (!v || isEmptyValue(v)) return null;
		switch (v.kind) {
			case 'option':
			case 'options':
			case 'ref': {
				if (field.ordered || field.kind === 'status') {
					const ranks = valueIds(v)
						.map((id) => optionRank(field, id, dir)?.rank)
						.filter((x): x is number => x !== undefined);
					return ranks.length ? Math.max(...ranks) : null;
				}
				return formatValue(r, field, v).toLowerCase();
			}
			case 'number':
				return v.value;
			case 'date':
				return Date.parse(v.value.length === 10 ? `${v.value}T00:00:00Z` : v.value);
			default:
				return formatValue(r, field, v).toLowerCase();
		}
	};
}

function cmpKeys(a: SortKey, b: SortKey): number {
	if (a === b) return 0;
	if (a === null) return 1; // empties last, whatever the direction
	if (b === null) return -1;
	if (typeof a === 'number' && typeof b === 'number') return a - b;
	return String(a).localeCompare(String(b));
}

export function sortItems(items: WorkItem[], orderBy: OrderBy[], ctx: EngineContext): WorkItem[] {
	const keys = orderBy
		.filter((o) => o.field !== 'manual')
		.map((o) => {
			const f = resolveField(reg(ctx), o.field as Exclude<OrderBy['field'], 'manual'>);
			return f ? { fn: sortKeyFn(f, ctx), dir: o.dir } : null;
		})
		.filter((k): k is { fn: (i: WorkItem) => SortKey; dir: 'asc' | 'desc' } => !!k);
	const r = reg(ctx);
	const decorated = items.map((item) => ({ item, ks: keys.map((k) => k.fn(item)), closed: closedKind(r, item) ? 1 : 0 }));
	decorated.sort((a, b) => {
		// Completed / canceled items go to the bottom of their group, like Linear.
		if (a.closed !== b.closed) return a.closed - b.closed;
		for (let k = 0; k < keys.length; k++) {
			const ka = a.ks[k];
			const kb = b.ks[k];
			if (ka === null || kb === null) {
				const c = cmpKeys(ka, kb);
				if (c) return c;
				continue;
			}
			const c = cmpKeys(ka, kb) * (keys[k].dir === 'desc' ? -1 : 1);
			if (c) return c;
		}
		return b.item.updatedAt.localeCompare(a.item.updatedAt) || a.item.iid - b.item.iid;
	});
	return decorated.map((d) => d.item);
}

// ---- Grouping ---------------------------------------------------------------------------------

export interface Row {
	item: WorkItem;
	depth: number;
}

export interface ItemGroup {
	key: string;
	label: string;
	/** null for the "No <field>" group and for "All" */
	value: string | null;
	field: FieldDef | null;
	option?: OptionDef;
	items: WorkItem[];
	rows: Row[];
	sub?: ItemGroup[];
}

function bucketKeys(item: WorkItem, field: FieldDef, ctx: EngineContext): string[] {
	const v = item.values[field.key];
	if (!v || isEmptyValue(v)) return [];
	switch (v.kind) {
		case 'option':
		case 'options':
		case 'ref':
		case 'people':
			return valueIds(v);
		case 'number':
			return [String(v.value)];
		case 'date':
			return [v.value.slice(0, 10)];
		default:
			return [formatValue(reg(ctx), field, v)];
	}
}

/** Group order: options in GitLab order (status by category), people by name, numbers/dates ascending. */
function groupOrder(field: FieldDef, keys: string[], ctx: EngineContext, showEmpty: boolean): { key: string; label: string; option?: OptionDef }[] {
	const r = reg(ctx);
	if (field.options && field.kind !== 'people') {
		const opts = orderedOptions(field);
		const known = new Set(opts.map((o) => o.id));
		const present = new Set(keys);
		const list: { key: string; label: string; option?: OptionDef }[] = opts
			.filter((o) => showEmpty || present.has(o.id))
			.map((o) => ({ key: o.id, label: o.label, option: o }));
		// Values pointing at options the registry doesn't know (e.g. an archived project): one group
		// per distinct value. `keys` has one entry per item, and duplicate group keys crash Svelte's
		// keyed {#each} and blank the whole page.
		for (const k of present) if (!known.has(k)) list.push({ key: k, label: unknownOptionLabel(field, k) });
		return list;
	}
	if (field.kind === 'people') {
		const people = showEmpty ? r.people.map((p) => p.id) : [...new Set(keys)];
		return people
			.map((id) => ({ key: id, label: r.people.find((p) => p.id === id)?.name ?? 'Unknown user' }))
			.sort((a, b) => a.label.localeCompare(b.label));
	}
	const uniq = [...new Set(keys)];
	if (field.kind === 'number') uniq.sort((a, b) => Number(a) - Number(b));
	else uniq.sort();
	return uniq.map((k) => ({ key: k, label: k }));
}

function emptyLabel(field: FieldDef): string {
	switch (field.key) {
		case 'native:assignees':
			return 'Unassigned';
		case 'native:parent':
			return 'No parent';
		case 'native:project':
			return 'No project';
		default:
			return `No ${field.name.toLowerCase()}`;
	}
}

export function groupItems(items: WorkItem[], field: FieldDef | null, ctx: EngineContext, showEmpty: boolean): ItemGroup[] {
	if (!field) return [{ key: 'all', label: 'All', value: null, field: null, items, rows: [] }];
	const buckets = new Map<string, WorkItem[]>();
	const none: WorkItem[] = [];
	const allKeys: string[] = [];
	for (const item of items) {
		const ks = bucketKeys(item, field, ctx);
		if (ks.length === 0) none.push(item);
		// An item with several values appears in each matching group, like Linear.
		for (const k of ks) {
			if (!buckets.has(k)) buckets.set(k, []);
			buckets.get(k)!.push(item);
			allKeys.push(k);
		}
	}
	const groups: ItemGroup[] = groupOrder(field, allKeys, ctx, showEmpty).map((g) => ({
		key: g.key,
		label: g.label,
		value: g.key,
		field,
		option: g.option,
		items: buckets.get(g.key) ?? [],
		rows: []
	}));
	if (none.length || showEmpty) groups.push({ key: '__none', label: emptyLabel(field), value: null, field, items: none, rows: [] });
	return groups;
}

/** Sub-issues: nested under their parent (when both are in the group), flat, or hidden. */
export function arrangeRows(items: WorkItem[], mode: SubIssues): Row[] {
	const ids = new Set(items.map((i) => i.id));
	const isSub = (i: WorkItem) => !!i.parentId && ids.has(i.parentId);
	if (mode === 'flat') return items.map((item) => ({ item, depth: 0 }));
	if (mode === 'hidden') return items.filter((i) => !isSub(i)).map((item) => ({ item, depth: 0 }));
	const children = new Map<string, WorkItem[]>();
	for (const i of items) if (isSub(i)) (children.get(i.parentId!) ?? children.set(i.parentId!, []).get(i.parentId!))!.push(i);
	const rows: Row[] = [];
	const seen = new Set<string>();
	const walk = (i: WorkItem, depth: number) => {
		if (seen.has(i.id) || depth > 6) return;
		seen.add(i.id);
		rows.push({ item: i, depth });
		for (const c of children.get(i.id) ?? []) walk(c, depth + 1);
	};
	for (const i of items) if (!isSub(i)) walk(i, 0);
	for (const i of items) if (!seen.has(i.id)) walk(i, 0); // cycles: never drop an item
	return rows;
}

// ---- The whole pipeline -----------------------------------------------------------------------

export interface ViewResult {
	/** Items after scope, filter, search and the completed window */
	items: WorkItem[];
	groups: ItemGroup[];
	reports: RuleReport[];
	/** Group-by field reference that didn't resolve */
	groupProblem: string | null;
	groupField: FieldDef | null;
	subGroupField: FieldDef | null;
}

export function runView(
	all: WorkItem[],
	view: ViewDefinition,
	ctx: EngineContext,
	opts: { search?: string; byId?: Map<string, WorkItem> } = {}
): ViewResult {
	const byId = opts.byId ?? new Map(all.map((i) => [i.id, i]));
	const { test, reports } = compileFilter(view.filter, ctx);
	const items = all.filter(
		(i) =>
			inScope(i, view.scope, byId) &&
			inCompletedWindow(i, view.display.completed, ctx) &&
			matchesSearch(i, opts.search ?? '') &&
			test(i)
	);
	const r = reg(ctx);
	const groupField = view.groupBy ? resolveField(r, view.groupBy) : null;
	const subGroupField = view.subGroupBy ? resolveField(r, view.subGroupBy) : null;
	const problems = [
		view.groupBy && !groupField ? `Group by "${refLabel(view.groupBy)}": field removed` : null,
		view.subGroupBy && !subGroupField ? `Sub-group by "${refLabel(view.subGroupBy)}": field removed` : null
	].filter(Boolean);

	const sorted = sortItems(items, view.orderBy, ctx);
	const groups = groupItems(sorted, groupField, ctx, view.display.showEmptyGroups);
	for (const g of groups) {
		g.rows = arrangeRows(g.items, view.display.subIssues);
		if (subGroupField) {
			g.sub = groupItems(g.items, subGroupField, ctx, false);
			for (const s of g.sub) s.rows = arrangeRows(s.items, view.display.subIssues);
		}
	}
	return { items, groups, reports, groupProblem: problems.join('; ') || null, groupField, subGroupField };
}
