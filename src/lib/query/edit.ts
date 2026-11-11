/** Pure helpers for changing a view from the UI. Every change returns a new view. */
import { resolveField, resolveOption } from '$lib/fields/registry';
import type { FieldDef, FieldKey, FieldRegistry } from '$lib/fields/types';
import type { WriteValue } from '$lib/fields/apply';
import { isGroup, type FieldRef, type FilterGroup, type FilterRule, type ViewDefinition } from './types';

/** How the UI stores a field reference: by key, with the name as a fallback (see §3.2). */
export const refOf = (f: FieldDef): FieldRef => ({ field: f.key, name: f.name });

export function removeRuleAt(g: FilterGroup, path: number[]): FilterGroup {
	if (path.length === 0) return g;
	const [i, ...rest] = path;
	const rules = g.rules.flatMap((r, j) => {
		if (j !== i) return [r];
		if (rest.length === 0) return [];
		return isGroup(r) ? [removeRuleAt(r, rest)] : [r];
	});
	return { ...g, rules };
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
