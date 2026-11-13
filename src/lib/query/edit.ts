/** Pure helpers for changing a view from the UI. Every change returns a new view. */
import { resolveField, resolveOption } from '$lib/fields/registry';
import type { FieldDef, FieldKey, FieldRegistry } from '$lib/fields/types';
import type { WriteValue } from '$lib/fields/apply';
import { MAX_DEPTH, MAX_RULES, countRules } from './schema';
import { isGroup, type FieldRef, type FilterGroup, type FilterRule, type ViewDefinition } from './types';

/** How the UI stores a field reference: by key, with the name as a fallback (see §3.2). */
export const refOf = (f: FieldDef): FieldRef => ({ field: f.key, name: f.name });

type Op = FilterGroup['op'];

/** The group at a path ([] is the top level), or null when the path doesn't lead to a group. */
export function groupAt(g: FilterGroup, path: number[]): FilterGroup | null {
	let at: FilterRule | FilterGroup | undefined = g;
	for (const i of path) {
		if (!at || !isGroup(at)) return null;
		at = at.rules[i];
	}
	return at && isGroup(at) ? at : null;
}

/** Replace the group at a path with fn(group). A path that doesn't lead to a group changes nothing. */
function updateGroupAt(g: FilterGroup, path: number[], fn: (g: FilterGroup) => FilterGroup): FilterGroup {
	if (path.length === 0) return fn(g);
	const [i, ...rest] = path;
	return {
		...g,
		rules: g.rules.map((r, j) => (j === i && isGroup(r) ? updateGroupAt(r, rest, fn) : r))
	};
}

/** A top level with fewer than two entries shows no operator, so it is always "and". */
const tidyRoot = (g: FilterGroup): FilterGroup => (g.rules.length < 2 && g.op !== 'and' ? { ...g, op: 'and' } : g);

function prune(g: FilterGroup, path: number[]): FilterGroup {
	const [i, ...rest] = path;
	const rules = g.rules.flatMap((r, j) => {
		if (j !== i) return [r];
		if (rest.length === 0) return [];
		if (!isGroup(r)) return [r];
		const child = prune(r, rest);
		if (child.rules.length === 0) return [];
		if (child.rules.length > 1) return [child];
		// One entry left: the group collapses into this one. If that entry is a group with the
		// same operator as this one it merges in, so "a and (b and c)" doesn't stay around.
		const only = child.rules[0];
		return isGroup(only) && only.op === g.op ? only.rules : [only];
	});
	return { ...g, rules };
}

/**
 * Remove the rule (or group) at a path and tidy up after it: a group left with one rule collapses
 * into its parent, an empty group disappears, and a top level that only holds one group becomes
 * that group.
 */
export function removeRuleAt(g: FilterGroup, path: number[]): FilterGroup {
	if (path.length === 0) return g;
	let root = prune(g, path);
	if (root.rules.length === 1 && isGroup(root.rules[0])) root = root.rules[0];
	return tidyRoot(root);
}

export function replaceRuleAt(g: FilterGroup, path: number[], rule: FilterRule): FilterGroup {
	const [i, ...rest] = path;
	return {
		...g,
		rules: g.rules.map((r, j) => (j !== i ? r : rest.length === 0 ? rule : isGroup(r) ? replaceRuleAt(r, rest, rule) : r))
	};
}

/** Add a rule at the top level. If the top level is an OR, wrap it so the new rule narrows. */
export function addRule(g: FilterGroup, rule: FilterRule): FilterGroup {
	if (g.op === 'and') return { ...g, rules: [...g.rules, rule] };
	return { op: 'and', rules: [g, rule] };
}

/**
 * Append a rule to the group at a path ([] is the top level), with that group's own operator.
 * This is what "+ Filter" does now that the operator is visible; addRule always narrows.
 */
export function appendRule(g: FilterGroup, rule: FilterRule, groupPath: number[] = []): FilterGroup {
	if (groupPath.length === 0) return { ...tidyRoot(g), rules: [...g.rules, rule] };
	return updateGroupAt(g, groupPath, (grp) => ({
		...grp,
		rules: [...grp.rules, rule]
	}));
}

/** Set the operator of the group at a path ([] is the top level). */
export function setOpAt(g: FilterGroup, path: number[], op: Op): FilterGroup {
	return updateGroupAt(g, path, (grp) => (grp.op === op ? grp : { ...grp, op }));
}

/** Flip the group at a path between "and" and "or". */
export function toggleOpAt(g: FilterGroup, path: number[]): FilterGroup {
	return updateGroupAt(g, path, (grp) => ({
		...grp,
		op: grp.op === 'and' ? 'or' : 'and'
	}));
}

/**
 * Combine the rule at a path with a new rule: "this or that" (or "this and that"). If the rule
 * already sits in a group with that operator (the top level included), the new rule joins that
 * group; otherwise the rule is replaced by a new group of the two.
 */
export function combineRuleAt(g: FilterGroup, path: number[], rule: FilterRule, op: Op = 'or'): FilterGroup {
	if (path.length === 0) return g;
	const i = path[path.length - 1];
	return updateGroupAt(g, path.slice(0, -1), (parent) => {
		const target = parent.rules[i];
		if (!target) return parent;
		if (parent.op === op) return { ...parent, rules: [...parent.rules, rule] };
		return {
			...parent,
			rules: parent.rules.map((r, j) => (j === i ? { op, rules: [target, rule] } : r))
		};
	});
}

const TOO_MANY = `A view can have at most ${MAX_RULES} filters`;
const TOO_DEEP = "Filters can't be nested any deeper";

/** Why one more rule can't be added (the schema would reject the view), or null. */
export function appendProblem(g: FilterGroup): string | null {
	return countRules(g) >= MAX_RULES ? TOO_MANY : null;
}

/** Why combineRuleAt can't be used on the rule at a path, or null. */
export function combineProblem(g: FilterGroup, path: number[], op: Op = 'or'): string | null {
	if (countRules(g) >= MAX_RULES) return TOO_MANY;
	const parent = groupAt(g, path.slice(0, -1));
	if (path.length === 0 || !parent?.rules[path[path.length - 1]]) return 'This filter is gone';
	// The parent group is path.length levels deep (the top level is 1); a new group goes one below.
	if (parent.op !== op && path.length + 1 > MAX_DEPTH) return TOO_DEEP;
	return null;
}

export const withFilter = (v: ViewDefinition, filter: FilterGroup): ViewDefinition => ({ ...v, filter });

export const canGroupBy = (f: FieldDef) =>
	['singleSelect', 'multiSelect', 'status', 'people', 'ref'].includes(f.kind) ||
	(f.kind === 'number' && f.key !== 'native:createdAt');

export const canSortBy = (f: FieldDef) => f.ordered || f.kind === 'text' || f.kind === 'people' || f.kind === 'ref' || f.kind === 'singleSelect';

export const canFilter = (_f: FieldDef) => true;

/** Board columns: any single-select field, status, or a ref field (project/parent). */
export const canBeColumns = (f: FieldDef) => ['singleSelect', 'status', 'ref', 'people'].includes(f.kind);

export const canBeAxis = (f: FieldDef) => f.ordered && ['singleSelect', 'status', 'number', 'date', 'multiSelect'].includes(f.kind);

/** Fields in a stable, readable menu order: status, custom fields, then the other native fields. */
export function menuFields(reg: FieldRegistry, pred: (f: FieldDef) => boolean = () => true): FieldDef[] {
	const rank = (f: FieldDef) => (f.key === 'native:status' ? 0 : f.key.startsWith('custom:') ? 1 : 2);
	return reg.fields.filter(pred).sort((a, b) => rank(a) - rank(b));
}

/**
 * Field values implied by the view's filter (top-level AND "is"/"anyOf" with exactly one value),
 * used to pre-fill "create issue", like Linear.
 */
export function impliedValues(view: ViewDefinition, reg: FieldRegistry): Partial<Record<FieldKey, string>> {
	const out: Partial<Record<FieldKey, string>> = {};
	if (view.filter.op !== 'and') return out;
	for (const r of view.filter.rules) {
		if (isGroup(r) || !(r.cmp === 'is' || r.cmp === 'anyOf')) continue;
		const vals = Array.isArray(r.value) ? r.value : r.value === undefined ? [] : [String(r.value)];
		if (vals.length !== 1) continue;
		const f = resolveField(reg, r.field);
		if (!f) continue;
		if (f.kind === 'people') {
			const v = vals[0] === 'me' ? reg.currentUserId : reg.people.find((p) => p.id === vals[0] || p.username === vals[0])?.id;
			if (v) out[f.key] = v;
		} else if (f.options) {
			const o = resolveOption(f, vals[0]);
			if (o) out[f.key] = o.id;
		}
	}
	return out;
}

/**
 * A prefilled create value (always a string: an option id from a group or filter) in the shape the
 * server expects for that field (review M8): a number for number fields, a list for multi-value
 * fields and people, the string itself for single choices, dates and text. Null for fields that
 * can't be set on create, or a value that doesn't fit, so the dialog leaves it out.
 */
export function prefillToWrite(field: FieldDef, raw: string): WriteValue {
	if (!field.editable || raw === '') return null;
	switch (field.kind) {
		case 'number': {
			const n = Number(raw);
			return Number.isFinite(n) ? n : null;
		}
		case 'multiSelect':
		case 'people':
			return [raw];
		case 'date':
			return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
		case 'singleSelect':
		case 'status':
		case 'ref':
		case 'text':
			return raw;
	}
}
