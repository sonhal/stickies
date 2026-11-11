/**
 * Board (kanban) moves: dropping a card from one column (or swimlane) into another becomes a
 * field write. Pure and unit-tested; the server validates the write again.
 */
import { appliesTo, valueIds } from '$lib/fields/registry';
import { toggleLabel, type WriteValue } from '$lib/fields/apply';
import type { FieldDef, FieldKey, WorkItem } from '$lib/fields/types';

export type DropResult = { key: FieldKey; value: WriteValue } | { error: string } | null;

/**
 * `from` / `to` are column values (option id, person id, item id), null for the "No …" column.
 * Multi-value fields (labels, multi-select, assignees) swap `from` for `to`, keeping other values,
 * since the card was shown in the `from` column because it had that value.
 */
export function dropWrite(item: WorkItem, field: FieldDef, from: string | null, to: string | null): DropResult {
	if (from === to) return null;
	if (!field.editable) return { error: `${field.name} can't be changed from the board` };
	if (!appliesTo(field, item.type)) return { error: `${field.name} doesn't apply to a ${item.type}` };
	if (field.kind === 'status' && to === null) return { error: "Status can't be empty" };
	if (field.key === 'native:parent' && to === item.id) return { error: "An item can't be its own parent" };

	switch (field.kind) {
		case 'singleSelect':
		case 'status':
		case 'ref':
			return { key: field.key, value: to };
		case 'people':
		case 'multiSelect': {
			let ids = valueIds(item.values[field.key]).filter((x) => x !== from);
			if (to && !ids.includes(to)) ids = field.key === 'native:labels' ? toggleLabel(field, ids, to) : [...ids, to];
			return { key: field.key, value: ids };
		}
		default:
			return { error: `${field.name} can't be used as board columns` };
	}
}
