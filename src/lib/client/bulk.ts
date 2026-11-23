/**
 * Bulk edits: what "set / add / remove" on a selection means for each item. Pure; unit-tested.
 *
 * A write always carries an item's full new value (see $lib/fields/apply), so a bulk edit of a
 * multi-value field (labels, assignees, multi-select) can't send one list to everyone: adding a
 * label keeps each item's other labels. So every change has its own value, and the server checks
 * each one like a single edit (planBulk).
 */
import { appliesTo, canParent, optionById, valueIds } from '$lib/fields/registry';
import { currentWriteValue, labelScope, type WriteValue } from '$lib/fields/apply';
import type { FieldDef, FieldRegistry, WorkItem } from '$lib/fields/types';

export type BulkOp =
	/** Single-value fields: this option (or item, for parent) on every item; null clears it */
	| { kind: 'set'; value: string | null }
	/** Multi-value fields: add this option to items that don't have it yet */
	| { kind: 'add'; id: string }
	/** Multi-value fields: take it off items that have it */
	| { kind: 'remove'; id: string };

export interface BulkChange {
	id: string;
	value: WriteValue;
}

export interface BulkChanges {
	changes: BulkChange[];
	/** Items the change can't apply to, with the reason (shown in the toast) */
	skipped: { item: WorkItem; reason: string }[];
	/** Items that already have the value */
	unchanged: number;
}

/** Fields with a value the bulk bar can set by picking options. */
export function isMulti(field: FieldDef): boolean {
	return field.kind === 'multiSelect' || field.kind === 'people';
}

export function bulkEditable(field: FieldDef): boolean {
	if (!field.editable) return false;
	if (field.key === 'native:parent') return true;
	return field.kind === 'status' || field.kind === 'singleSelect' || field.kind === 'multiSelect' || field.kind === 'people';
}

/** Is `candidate` the item itself, or somewhere below it? (It can't become the item's parent.) */
function isSelfOrBelow(byId: Map<string, WorkItem>, candidate: string, itemId: string): boolean {
	let cur = byId.get(candidate);
	for (let d = 0; cur && d < 10; d++) {
		if (cur.id === itemId) return true;
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return false;
}

const same = (a: WriteValue, b: WriteValue) => JSON.stringify(a) === JSON.stringify(b);

export function bulkChanges(reg: FieldRegistry, byId: Map<string, WorkItem>, items: WorkItem[], field: FieldDef, op: BulkOp): BulkChanges {
	const out: BulkChanges = { changes: [], skipped: [], unchanged: 0 };
	for (const item of items) {
		if (!field.editable) {
			out.skipped.push({ item, reason: `${field.name} can't be edited from the board` });
			continue;
		}
		if (!appliesTo(field, item.type)) {
			out.skipped.push({ item, reason: `${field.name} doesn't apply to a ${item.type}` });
			continue;
		}
		let value: WriteValue;
		if (op.kind === 'set') {
			value = op.value;
			if (field.key === 'native:parent' && value !== null) {
				const parent = byId.get(value);
				if (!parent || !canParent(reg, parent.type, item.type)) {
					out.skipped.push({ item, reason: `a ${item.type} can't go under ${parent ? `a ${parent.type}` : 'that item'}` });
					continue;
				}
				if (isSelfOrBelow(byId, value, item.id)) {
					out.skipped.push({ item, reason: "an item can't be its own parent" });
					continue;
				}
			}
		} else {
			const cur = valueIds(item.values[field.key]);
			const has = cur.includes(op.id);
			if (op.kind === 'add') {
				if (has) {
					out.unchanged++;
					continue;
				}
				// GitLab allows one label per scope: adding `area::web` takes `area::api` off.
				const scope = field.key === 'native:labels' ? labelScope(optionById(field, op.id)?.label ?? '') : null;
				const kept = scope ? cur.filter((x) => labelScope(optionById(field, x)?.label ?? '') !== scope) : cur;
				value = [...kept, op.id];
			} else {
				if (!has) {
					out.unchanged++;
					continue;
				}
				value = cur.filter((x) => x !== op.id);
			}
		}
		if (same(currentWriteValue(item, field.key), value)) {
			out.unchanged++;
			continue;
		}
		out.changes.push({ id: item.id, value });
	}
	return out;
}

/** How many of the items have each option (or person) set: drives ✓ (all) and "n of m" in the pickers. */
export function optionCounts(items: WorkItem[], field: FieldDef): Map<string, number> {
	const counts = new Map<string, number>();
	for (const item of items) for (const id of valueIds(item.values[field.key])) counts.set(id, (counts.get(id) ?? 0) + 1);
	return counts;
}

/**
 * Shift+click: the ids from the anchor to `id`, in on-screen order (either direction). Without an
 * anchor on screen, just `id`.
 */
export function rangeIds(order: string[], anchor: string | null, id: string): string[] {
	const b = order.indexOf(id);
	const a = anchor ? order.indexOf(anchor) : -1;
	if (b === -1) return [id];
	if (a === -1) return [id];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** "3 issues", "1 epic", "4 items" (mixed types) */
export function countLabel(items: WorkItem[]): string {
	const types = new Set(items.map((i) => i.type.toLowerCase()));
	const noun = types.size === 1 ? [...types][0] : 'item';
	return `${items.length} ${noun}${items.length === 1 ? '' : 's'}`;
}
