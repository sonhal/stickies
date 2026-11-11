/**
 * The derived `native:epic` field: the nearest epic above an item.
 *
 * GitLab only gives each item its direct parent. A task's parent is an issue, and that issue's
 * parent is the epic, so grouping by `native:parent` puts tasks under their issue. Views that
 * mean "by epic" group by `native:epic` instead.
 *
 * The value is recomputed for the whole list whenever items change, because changing an issue's
 * parent also changes the epic of every task under it. It's cheap: a few hundred items.
 */
import type { FieldRegistry, WorkItem } from './types';

const MAX_DEPTH = 8;
const isEpic = (i: WorkItem) => i.type.toLowerCase() === 'epic';

/** Id of the nearest epic above `item`, or null (no epic, or the chain leaves the loaded data). */
export function epicIdOf(item: WorkItem, byId: Map<string, WorkItem>, knownEpics: Set<string>): string | null {
	if (isEpic(item)) return null;
	let parentId = item.parentId;
	for (let depth = 0; parentId && depth < MAX_DEPTH; depth++) {
		const parent = byId.get(parentId);
		if (!parent) return knownEpics.has(parentId) ? parentId : null; // e.g. an epic closed long ago
		if (isEpic(parent)) return parent.id;
		parentId = parent.parentId;
	}
	return null;
}

/**
 * Items with `values['native:epic']` set (or removed) to match the hierarchy. Items whose value
 * doesn't change keep their identity, so Svelte doesn't redraw them.
 */
export function withEpics(items: WorkItem[], reg: FieldRegistry): WorkItem[] {
	const byId = new Map(items.map((i) => [i.id, i]));
	const epicField = reg.fields.find((f) => f.key === 'native:epic');
	const knownEpics = new Set((epicField?.options ?? []).map((o) => o.id));
	return items.map((item) => {
		const id = epicIdOf(item, byId, knownEpics);
		const current = item.values['native:epic'];
		const currentId = current?.kind === 'ref' ? current.id : null;
		if (id === currentId) return item;
		const values = { ...item.values };
		if (id) values['native:epic'] = { kind: 'ref', id };
		else delete values['native:epic'];
		return { ...item, values };
	});
}
