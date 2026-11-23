/**
 * Runs a bulk edit on the checked items and says what happened: shared by the bulk bar, the
 * command palette and the keyboard (I = assign to me).
 */
import { optionById, personName } from '$lib/fields/registry';
import type { FieldDef, WorkItem } from '$lib/fields/types';
import type { BoardState } from './board.svelte';
import { bulkChanges, countLabel, type BulkOp } from './bulk';

function optionName(board: BoardState, f: FieldDef, id: string): string {
	if (f.kind === 'people') return id === board.reg.currentUserId ? 'you' : personName(board.reg, id);
	if (f.key === 'native:parent') return board.byId.get(id)?.title ?? 'that parent';
	return optionById(f, id)?.label ?? id;
}

/** The toast (and undo) text for a bulk change: "Status: Done on 4 issues", "Added bug to 3 issues" */
export function bulkLabel(board: BoardState, items: WorkItem[], f: FieldDef, op: BulkOp): string {
	const what = countLabel(items);
	if (op.kind === 'add') return op.id === board.reg.currentUserId && f.kind === 'people' ? `Assigned you to ${what}` : `Added ${optionName(board, f, op.id)} to ${what}`;
	if (op.kind === 'remove') return `Removed ${optionName(board, f, op.id)} from ${what}`;
	return op.value === null ? `Cleared ${f.name} on ${what}` : `${f.name}: ${optionName(board, f, op.value)} on ${what}`;
}

export function applyBulk(board: BoardState, toast: (text: string) => void, items: WorkItem[], f: FieldDef, op: BulkOp) {
	const plan = bulkChanges(board.reg, board.byId, items, f, op);
	const skipNote = plan.skipped.length ? ` (skipped ${plan.skipped.length}: ${plan.skipped[0].reason}${plan.skipped.length > 1 ? ', …' : ''})` : '';
	if (!plan.changes.length) {
		toast(plan.skipped.length ? `Nothing to change${skipNote}` : 'Nothing to change: they all have that already');
		return;
	}
	board.updateMany(f.key, plan.changes, { label: bulkLabel(board, items, f, op) + skipNote });
}
