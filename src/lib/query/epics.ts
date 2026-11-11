/** Epic progress and lists. Pure. */
import { closedKind } from '$lib/fields/registry';
import type { FieldRegistry, WorkItem } from '$lib/fields/types';

export const isEpic = (i: WorkItem) => i.type.toLowerCase() === 'epic';

export interface Progress {
	closed: number;
	total: number;
	/** 'gitlab': rolled-up counts from GitLab (all children, also ones closed long ago);
	 *  'board': counted from the direct children the board fetched */
	source: 'gitlab' | 'board';
}

export function childrenOf(epic: WorkItem, items: WorkItem[]): WorkItem[] {
	return items.filter((i) => i.parentId === epic.id);
}

export function epicProgress(epic: WorkItem, items: WorkItem[], reg: FieldRegistry): Progress {
	if (epic.progress && epic.progress.total > 0) return { ...epic.progress, source: 'gitlab' };
	const kids = childrenOf(epic, items);
	return { closed: kids.filter((k) => closedKind(reg, k)).length, total: kids.length, source: 'board' };
}

export const pct = (p: Progress) => (p.total ? Math.round((p.closed / p.total) * 100) : 0);

/** The numeric id used in /epics/<id> URLs */
export const epicSlug = (id: string) => id.slice(id.lastIndexOf('/') + 1);
