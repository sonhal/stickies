/**
 * `?status=` on a prioritization board: a hand-written shorthand for the Status rules of the
 * board's filter, for links and wall screens (`/kiosk/<KEY>?status=!done,!canceled`). It isn't a
 * separate filter: it replaces the top-level Status rules of the filter (the config's, or the one in
 * `?f=`) with ordinary rules, which the filter bar shows and edits. The first edit in the filter bar
 * puts the whole filter in `?f=` and drops `?status=`, so the board only ever writes one param.
 *
 * - `?status=toDo,inProgress`  → Status is any of To do, In progress   (only these)
 * - `?status=!toDo,!done`      → Status is none of To do, Done         (everything but these)
 * - `?status=done,!Blocked`    → both rules (any done status, but not "Blocked")
 * - `?status=all` (or empty)   → no Status rule: every status, done and canceled included
 *
 * Values are status categories (`triage`, `toDo`, `inProgress`, `done`, `canceled`; case, spaces
 * and dashes don't matter, `cancelled` works too) or status names as GitLab shows them
 * ("In review"). Quote a name to keep it from being read as a category: `"Done"` is the status
 * called Done, `done` is any done status. A name that doesn't exist shows up in the filter bar as a
 * removed option.
 */
import { STATUS_CATEGORIES } from '$lib/fields/types';
import { isGroup, type FilterGroup, type FilterRule } from '$lib/query/types';

export const STATUS_PARAM = 'status';
const ALL = 'all';
const CATEGORY = 'category:';

/** What the param says. `null` from readStatusParam: no param. */
export interface StatusSelection {
	/** Filter values (`category:toDo` or a status name) the status must be one of */
	include: string[];
	/** Filter values the status must not be */
	exclude: string[];
}

const squash = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, '');
const CATEGORY_BY_SQUASHED = new Map<string, string>([
	...STATUS_CATEGORIES.map((c) => [squash(c), c] as [string, string]),
	['cancelled', 'canceled']
]);

/** A token from the URL → a filter value: a category becomes `category:<key>`, anything else is a name. */
function tokenToValue(token: string): string {
	if (token.length > 1 && token.startsWith('"') && token.endsWith('"')) return token.slice(1, -1);
	const cat = CATEGORY_BY_SQUASHED.get(squash(token));
	return cat ? `${CATEGORY}${cat}` : token;
}

/** The raw param as it should be passed on (kiosk redirect and rotation), or null when absent. */
export function statusParamValue(params: URLSearchParams): string | null {
	const v = params.get(STATUS_PARAM);
	return v === null ? null : v.slice(0, 500);
}

export function readStatusParam(params: URLSearchParams): StatusSelection | null {
	if (!params.has(STATUS_PARAM)) return null;
	const include: string[] = [];
	const exclude: string[] = [];
	for (const raw of (params.get(STATUS_PARAM) ?? '').split(',')) {
		const t = raw.trim();
		if (!t || t.toLowerCase() === ALL) continue;
		const not = t.startsWith('!');
		const name = (not ? t.slice(1) : t).trim();
		if (!name || name === '""') continue;
		const v = tokenToValue(name);
		const list = not ? exclude : include;
		if (!list.includes(v)) list.push(v);
		if (list.length + (not ? include : exclude).length >= 50) break; // a hand-typed URL, not a list of hundreds
	}
	return { include, exclude };
}

export function isStatusRule(r: FilterRule | FilterGroup): r is FilterRule {
	if (isGroup(r)) return false;
	return r.field.field === 'native:status' || (!r.field.field && r.field.name?.trim().toLowerCase() === 'status');
}

const INCLUDE_CMPS = new Set(['is', 'anyOf']);
const EXCLUDE_CMPS = new Set(['isNot', 'noneOf']);

/** A top-level Status rule that `?status=` replaces (is / any of / is not / none of). */
function expressible(r: FilterRule | FilterGroup): r is FilterRule {
	return isStatusRule(r) && (INCLUDE_CMPS.has(r.cmp) || EXCLUDE_CMPS.has(r.cmp));
}

/**
 * The filter with its top-level Status rules replaced by the selection's. Other rules are kept,
 * in their place; the new Status rules go where the first old one was (or at the end).
 */
export function withStatusSelection(filter: FilterGroup, sel: StatusSelection): FilterGroup {
	const next: FilterRule[] = [];
	if (sel.include.length) next.push({ field: { field: 'native:status' }, cmp: 'anyOf', value: [...sel.include] });
	if (sel.exclude.length) next.push({ field: { field: 'native:status' }, cmp: 'noneOf', value: [...sel.exclude] });
	if (filter.op !== 'and') {
		if (!next.length) return filter;
		// Keep the "or" group as one alternative-set, and the status rules alongside it.
		return { op: 'and', rules: filter.rules.length ? [filter, ...next] : next };
	}
	const at = filter.rules.findIndex(expressible);
	const rest = filter.rules.filter((r) => !expressible(r));
	const pos = at === -1 ? rest.length : filter.rules.slice(0, at).filter((r) => !expressible(r)).length;
	return { op: 'and', rules: [...rest.slice(0, pos), ...next, ...rest.slice(pos)] };
}
