/**
 * `?status=` on a prioritization board: a readable shorthand for the Status rules of the board's
 * filter. It is not a separate filter: the param is turned into ordinary filter rules (shown and
 * editable in the filter bar), and editing those rules in the filter bar writes the param back.
 *
 * - `?status=toDo,inProgress`  → Status is any of To do, In progress   (only these)
 * - `?status=!toDo,!done`      → Status is none of To do, Done         (everything but these)
 * - `?status=done,!Blocked`    → both rules (any done status, but not "Blocked")
 * - `?status=all` (or empty)   → no Status rule: every status, done and canceled included
 * - no param                   → the board's own filter from prioritization.config.ts
 *
 * Values are status categories (`triage`, `toDo`, `inProgress`, `done`, `canceled`; case, spaces
 * and dashes don't matter, `cancelled` works too) or status names as GitLab shows them
 * ("In review"). Quote a name to keep it from being read as a category: `"Done"` is the status
 * called Done, `done` is any done status. A name that doesn't exist shows up in the filter bar as a
 * removed option.
 *
 * Only the top-level Status rules (`is`, `any of`, `is not`, `none of`) are in the param. A Status
 * rule inside an "or" alternative stays in the filter bar but isn't put in the URL.
 */
import { STATUS_CATEGORIES } from '$lib/fields/types';
import { isGroup, type FilterGroup, type FilterRule } from '$lib/query/types';

export const STATUS_PARAM = 'status';
const ALL = 'all';
const CATEGORY = 'category:';

/** What the param says. `null` from readStatusParam: no param (use the board's own filter). */
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

/** A filter value → the token shown in the URL. `label` turns an option id into a status name. */
function valueToToken(value: string, label: (id: string) => string | null): string {
	if (value.startsWith(CATEGORY)) return value.slice(CATEGORY.length);
	const name = label(value) ?? value;
	return CATEGORY_BY_SQUASHED.has(squash(name)) || name.toLowerCase() === ALL ? `"${name}"` : name;
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
const listOf = (v: FilterRule['value']) => (v === undefined ? [] : Array.isArray(v) ? v : [String(v)]);

/** The top-level Status rules of a filter that the param can express. */
function expressible(r: FilterRule | FilterGroup): r is FilterRule {
	return isStatusRule(r) && (INCLUDE_CMPS.has(r.cmp) || EXCLUDE_CMPS.has(r.cmp));
}

/** The Status part of an "and" filter, as a selection. An "or" filter's rules are alternatives, not this. */
export function statusSelectionOf(filter: FilterGroup): StatusSelection {
	const sel: StatusSelection = { include: [], exclude: [] };
	if (filter.op !== 'and') return sel;
	for (const r of filter.rules) {
		if (!expressible(r)) continue;
		const list = INCLUDE_CMPS.has(r.cmp) ? sel.include : sel.exclude;
		for (const v of listOf(r.value)) if (!list.includes(v)) list.push(v);
	}
	return sel;
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
		// Keep the "or" group as one alternative-set, and the status rules alongside it.
		return { op: 'and', rules: filter.rules.length ? [filter, ...next] : next };
	}
	const at = filter.rules.findIndex(expressible);
	const rest = filter.rules.filter((r) => !expressible(r));
	const pos = at === -1 ? rest.length : filter.rules.slice(0, at).filter((r) => !expressible(r)).length;
	return { op: 'and', rules: [...rest.slice(0, pos), ...next, ...rest.slice(pos)] };
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The param value for a filter, or null when its Status part is the board's default (no param).
 * `label` maps a status option id to its name, so the URL stays readable.
 */
export function statusParamFor(
	filter: FilterGroup,
	base: FilterGroup,
	label: (id: string) => string | null
): string | null {
	const sel = statusSelectionOf(filter);
	const def = statusSelectionOf(base);
	if (sameSet(sel.include, def.include) && sameSet(sel.exclude, def.exclude)) return null;
	const tokens = [
		...sel.include.map((v) => valueToToken(v, label)),
		...sel.exclude.map((v) => `!${valueToToken(v, label)}`)
	];
	return tokens.length ? tokens.join(',') : ALL;
}
