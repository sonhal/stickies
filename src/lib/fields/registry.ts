/**
 * Pure helpers over the FieldRegistry: resolve field and option references, rank options,
 * format values as text. Shared by the browser and the server (write validation).
 *
 * Nothing here knows a field name or option value (D2).
 */
import type { FieldDef, FieldRegistry, FieldValue, OptionDef, WorkItem } from './types';

/** How a field is referenced from a view: by key and/or by name. */
export interface FieldRef {
	field?: string;
	name?: string;
}

/**
 * "firstHighest": the first option in GitLab's order is the highest (e.g. Critical, High, Medium, Low).
 * "firstLowest": the first option is the lowest.
 */
export type RankDirection = 'firstHighest' | 'firstLowest';

const norm = (s: string) => s.trim().toLowerCase();

/** Resolve by key first, then by case-insensitive name (custom fields win a name clash). */
export function resolveField(reg: FieldRegistry, ref: FieldRef | null | undefined): FieldDef | null {
	if (!ref) return null;
	if (ref.field) {
		const byKey = reg.fields.find((f) => f.key === ref.field);
		if (byKey) return byKey;
	}
	if (ref.name) {
		const n = norm(ref.name);
		const matches = reg.fields.filter((f) => norm(f.name) === n);
		return matches.find((f) => f.key.startsWith('custom:')) ?? matches[0] ?? null;
	}
	return null;
}

/** A short text for a ref that did not resolve, e.g. in a "field removed" chip. */
export function refLabel(ref: FieldRef | null | undefined): string {
	return ref?.name ?? ref?.field ?? '?';
}

/** Option by id, then by case-insensitive label. */
export function resolveOption(field: FieldDef, idOrLabel: string): OptionDef | null {
	const opts = field.options ?? [];
	return opts.find((o) => o.id === idOrLabel) ?? opts.find((o) => norm(o.label) === norm(idOrLabel)) ?? null;
}

export function optionById(field: FieldDef, id: string): OptionDef | null {
	return field.options?.find((o) => o.id === id) ?? null;
}

/** Options in GitLab order (by position). */
export function orderedOptions(field: FieldDef): OptionDef[] {
	return [...(field.options ?? [])].sort((a, b) => a.position - b.position);
}

/**
 * Rank of an option where a bigger rank means "higher" (more important / more urgent).
 * Status always ranks by category order (triage lowest, canceled highest), so sorting by status
 * ascending reads like a workflow. Returns null for an unknown option.
 */
export function optionRank(
	field: FieldDef,
	optionId: string,
	dir: RankDirection
): { rank: number; count: number } | null {
	const opts = orderedOptions(field);
	const i = opts.findIndex((o) => o.id === optionId);
	if (i === -1) return null;
	const n = opts.length;
	if (field.kind === 'status' || dir === 'firstLowest') return { rank: i, count: n };
	return { rank: n - 1 - i, count: n };
}

/** 0…1, independent of how many options exist. A single option is 1. */
export function normalizedPosition(field: FieldDef, optionId: string, dir: RankDirection): number | null {
	const r = optionRank(field, optionId, dir);
	if (!r) return null;
	return r.count <= 1 ? 1 : r.rank / (r.count - 1);
}

/** The ids an item holds for an option-like field (single, multi, ref, people). */
export function valueIds(v: FieldValue | undefined): string[] {
	if (!v) return [];
	switch (v.kind) {
		case 'option':
		case 'ref':
			return [v.id];
		case 'options':
		case 'people':
			return v.ids;
		default:
			return [];
	}
}

export function isEmptyValue(v: FieldValue | undefined): boolean {
	if (!v) return true;
	switch (v.kind) {
		case 'options':
		case 'people':
			return v.ids.length === 0;
		case 'text':
		case 'date':
			return v.value === '';
		default:
			return false;
	}
}

/** Does this field apply to that work item type? Empty appliesTo = all types. */
export function appliesTo(field: FieldDef, type: string): boolean {
	return field.appliesTo.length === 0 || field.appliesTo.some((t) => norm(t) === norm(type));
}

export function personName(reg: FieldRegistry, id: string): string {
	return reg.people.find((p) => p.id === id)?.name ?? 'Unknown user';
}

/** Label for a parent the board knows nothing about (no title from GitLab, item not loaded). */
export const PARENT_NOT_LOADED = 'Parent not on the board';

/** Label for a value whose option the registry doesn't know. Never throws, never returns ''. */
export function unknownOptionLabel(field: FieldDef, id: string): string {
	if (field.key === 'native:project') return id;
	if (field.key === 'native:parent' || field.key === 'native:epic') return PARENT_NOT_LOADED;
	return '(removed option)';
}

/** Human text for a value. Unknown option ids show via unknownOptionLabel, never crash. */
export function formatValue(reg: FieldRegistry, field: FieldDef, v: FieldValue | undefined): string {
	if (!v || isEmptyValue(v)) return '';
	switch (v.kind) {
		case 'option':
		case 'ref':
			return optionById(field, v.id)?.label ?? unknownOptionLabel(field, v.id);
		case 'options':
			return v.ids.map((id) => optionById(field, id)?.label ?? unknownOptionLabel(field, id)).join(', ');
		case 'people':
			return v.ids.map((id) => personName(reg, id)).join(', ');
		case 'number':
			return String(v.value);
		case 'date':
			return v.value.length > 10 ? v.value.slice(0, 10) : v.value;
		case 'text':
			return v.value;
	}
}

export function statusOption(reg: FieldRegistry, item: WorkItem): OptionDef | null {
	const v = item.values['native:status'];
	if (v?.kind !== 'option') return null;
	const f = reg.fields.find((x) => x.key === 'native:status');
	return f ? optionById(f, v.id) : null;
}

/**
 * Completed / canceled, like Linear: decided by the status category. Items without a status
 * (older GitLab, or types without the status widget) count as completed when closed.
 */
export function closedKind(reg: FieldRegistry, item: WorkItem): 'done' | 'canceled' | null {
	const cat = statusOption(reg, item)?.category;
	if (cat === 'canceled') return 'canceled';
	if (cat === 'done') return 'done';
	return item.state === 'closed' ? 'done' : null;
}

/** When the item was completed, for the "completed in the past N days" window. */
export function closedAt(item: WorkItem): string {
	return item.closedAt ?? item.updatedAt;
}

/** Numeric part of a GitLab global id: gid://gitlab/WorkItem/123 → 123 */
export function numericId(gid: string): number {
	const n = Number(gid.slice(gid.lastIndexOf('/') + 1));
	return Number.isFinite(n) ? n : 0;
}
