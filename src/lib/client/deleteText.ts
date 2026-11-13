/**
 * The words of the "Delete…" confirmation. Pure, so the children wording is unit-tested.
 *
 * What happens to children: GitLab stores each parent link as its own record, removed together
 * with the parent, so issues and tasks under a deleted item stay, without a parent. Child EPICS
 * are less certain: older GitLab versions deleted an epic's child epics along with it, and the
 * board can't tell which rule your GitLab follows, so it says so rather than promise either way.
 * Only the children loaded on the board are counted.
 */
import type { WorkItem } from '$lib/fields/types';

const isEpic = (i: WorkItem) => i.type.toLowerCase() === 'epic';
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export interface DeleteText {
	heading: string;
	message: string;
	/** About the item's sub-items, or null when it has none on the board */
	note: string | null;
	confirmLabel: string;
}

export function deleteText(item: WorkItem, items: WorkItem[]): DeleteText {
	const noun = item.type.toLowerCase() || 'item';
	const children = items.filter((i) => i.parentId === item.id);
	const epics = children.filter(isEpic).length;
	const others = children.length - epics;
	const notes: string[] = [];
	if (others) notes.push(`Its ${others} ${plural(others, 'sub-item stays', 'sub-items stay')}, without this parent.`);
	if (epics)
		notes.push(
			`It has ${epics} child ${plural(epics, 'epic', 'epics')}: depending on your GitLab version, ${plural(epics, 'it', 'they')} may be deleted with it.`
		);
	return {
		heading: `Delete ${noun}`,
		message: `Delete ${item.ref} “${item.title}”? This can't be undone from the board.`,
		note: notes.length ? notes.join(' ') : null,
		confirmLabel: `Delete ${noun}`
	};
}
