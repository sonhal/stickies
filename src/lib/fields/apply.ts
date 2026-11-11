/**
 * The write format shared by the browser and the server, and how a write changes an item locally
 * (for optimistic updates). The server never trusts this: it re-validates every write against the
 * FieldRegistry (src/lib/server/write/validate.ts).
 *
 * Write values per field kind:
 *  - single select, status, milestone, iteration, parent: an option/item id, or null to clear
 *  - multi select, labels, people: the full new list of ids
 *  - number: a number, or null
 *  - text: a string, or null
 *  - date: "YYYY-MM-DD", or null
 *  - title: a string
 */
import { optionById } from './registry';
import type { FieldDef, FieldKey, FieldValue, WorkItem } from './types';

export type WriteValue = string | string[] | number | null;
export type WriteField = FieldKey | 'title';

/** `area::backend` → `area`; `a::b::c` → `a::b` (GitLab: the scope is everything before the last `::`). */
export function labelScope(title: string): string | null {
	const i = title.lastIndexOf('::');
	return i > 0 ? title.slice(0, i).toLowerCase() : null;
}

/**
 * Toggle a label, keeping GitLab's rule that only one label per `scope::` can be set:
 * adding `area::web` removes `area::api`.
 */
export function toggleLabel(field: FieldDef, current: string[], id: string): string[] {
	if (current.includes(id)) return current.filter((x) => x !== id);
	const scope = labelScope(optionById(field, id)?.label ?? '');
	const kept = scope
		? current.filter((x) => labelScope(optionById(field, x)?.label ?? '') !== scope)
		: current;
	return [...kept, id];
}

/** Two labels sharing a scope? Returns the scope, or null when the set is fine. */
export function scopedConflict(field: FieldDef, ids: string[]): string | null {
	const seen = new Set<string>();
	for (const id of ids) {
		const s = labelScope(optionById(field, id)?.label ?? '');
		if (!s) continue;
		if (seen.has(s)) return s;
		seen.add(s);
	}
	return null;
}

/** The FieldValue a write produces, or undefined to clear the value. */
export function writeToValue(field: FieldDef, value: WriteValue): FieldValue | undefined {
	if (value === null) return undefined;
	switch (field.kind) {
		case 'singleSelect':
		case 'status':
			return typeof value === 'string' ? { kind: 'option', id: value } : undefined;
		case 'ref':
			return typeof value === 'string' ? { kind: 'ref', id: value } : undefined;
		case 'multiSelect':
			return Array.isArray(value) ? { kind: 'options', ids: value } : undefined;
		case 'people':
			return Array.isArray(value) ? { kind: 'people', ids: value } : undefined;
		case 'number':
			return typeof value === 'number' ? { kind: 'number', value } : undefined;
		case 'date':
			return typeof value === 'string' ? { kind: 'date', value } : undefined;
		case 'text':
			return typeof value === 'string' ? { kind: 'text', value } : undefined;
	}
}

/** Apply a write to a copy of the item (optimistic UI). */
export function applyWrite(item: WorkItem, field: FieldDef | null, key: WriteField, value: WriteValue): WorkItem {
	if (key === 'title') return typeof value === 'string' ? { ...item, title: value } : item;
	if (!field) return item;
	const values = { ...item.values };
	const v = writeToValue(field, value);
	if (v) values[field.key] = v;
	else delete values[field.key];
	const next: WorkItem = { ...item, values };
	if (field.key === 'native:parent') next.parentId = typeof value === 'string' ? value : null;
	if (field.key === 'native:status') {
		// Done / canceled statuses close the item in GitLab; mirror that until the server answers.
		const cat = typeof value === 'string' ? optionById(field, value)?.category : undefined;
		if (cat === 'done' || cat === 'canceled') {
			next.state = 'closed';
			next.closedAt = new Date().toISOString();
		} else if (cat) {
			next.state = 'open';
			next.closedAt = null;
		}
	}
	return next;
}

/** The write value that restores `before`'s value of this field (used to roll back). */
export function currentWriteValue(item: WorkItem, key: WriteField): WriteValue {
	if (key === 'title') return item.title;
	const v = item.values[key];
	if (!v) return null;
	switch (v.kind) {
		case 'option':
		case 'ref':
			return v.id;
		case 'options':
		case 'people':
			return v.ids;
		default:
			return v.value;
	}
}
