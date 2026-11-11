import { numericId } from './fields/registry';
import type { WorkItem } from './fields/types';

/**
 * Epic → color slot.
 *
 * The palette has 8 slots (CSS vars --series-1 … --series-8, with separate light and dark
 * steps in app.css). More than 8 hues stop being tellable apart, so epics beyond 8 share an
 * "Other epics" style rather than getting generated colors.
 *
 * Colors must follow the epic, not its rank, so a standup on Tuesday matches Monday:
 *  1. epics pinned in config keep their slot;
 *  2. every other epic prefers slot (id mod 8), taking the next free slot if that's used;
 *  3. epics are handled oldest-first (lowest id), so a newly created epic never steals
 *     a color from an existing one.
 *
 * "Epic" here is generic: an item's color comes from its top-most ancestor (epic → issue → task),
 * found by following parent ids. The id is the numeric part of the work item's global id.
 */
export const PALETTE_SIZE = 8;

export type ColorSlot = number | 'other' | 'none';

export interface EpicSwatch {
	key: string; // 'epic:<id>' | 'other' | 'none'
	epicId: number | null;
	title: string;
	url: string | null;
	slot: ColorSlot;
	count: number;
}

export function assignEpicSlots(epicIds: number[], pinned: Record<number, number> = {}): Map<number, ColorSlot> {
	const result = new Map<number, ColorSlot>();
	const taken = new Set<number>();
	const unique = [...new Set(epicIds)].sort((a, b) => a - b);

	for (const id of unique) {
		const slot = pinned[id];
		if (Number.isInteger(slot) && slot >= 1 && slot <= PALETTE_SIZE && !taken.has(slot)) {
			result.set(id, slot);
			taken.add(slot);
		}
	}
	for (const id of unique) {
		if (result.has(id)) continue;
		const preferred = (id % PALETTE_SIZE) + 1;
		let assigned: ColorSlot = 'other';
		for (let i = 0; i < PALETTE_SIZE; i++) {
			const s = ((preferred - 1 + i) % PALETTE_SIZE) + 1;
			if (!taken.has(s)) {
				assigned = s;
				taken.add(s);
				break;
			}
		}
		result.set(id, assigned);
	}
	return result;
}

export function slotVar(slot: ColorSlot): string {
	if (slot === 'none') return 'var(--no-epic)';
	if (slot === 'other') return 'var(--other-epic)';
	return `var(--series-${slot})`;
}

export interface EpicInfo {
	/** global id of the top-most ancestor */
	id: string;
	title: string;
	url: string | null;
}

/**
 * Top-most known ancestor of an item, or null if it has no parent.
 * If the parent isn't in the data (closed long ago, or not visible), the parent id itself is used,
 * titled from `parentLabel` when the registry knows it.
 */
export function epicOf(
	item: WorkItem,
	byId: Map<string, WorkItem>,
	parentLabel: (id: string) => string | null = () => null
): EpicInfo | null {
	if (!item.parentId) return null;
	let cur = item;
	for (let depth = 0; depth < 8 && cur.parentId; depth++) {
		const p = byId.get(cur.parentId);
		if (!p) return { id: cur.parentId, title: parentLabel(cur.parentId) ?? 'Parent not on the board', url: null };
		cur = p;
	}
	return { id: cur.id, title: cur.title, url: cur.url };
}

export class EpicColors {
	readonly byId: Map<string, WorkItem>;
	readonly slots: Map<number, ColorSlot>;
	private cache = new Map<string, EpicInfo | null>();

	constructor(
		items: WorkItem[],
		pinned: Record<number, number> = {},
		private parentLabel: (id: string) => string | null = () => null
	) {
		this.byId = new Map(items.map((i) => [i.id, i]));
		const roots = items.map((i) => this.epic(i)).filter((e): e is EpicInfo => !!e);
		this.slots = assignEpicSlots(
			roots.map((e) => numericId(e.id)),
			pinned
		);
	}

	epic(item: WorkItem): EpicInfo | null {
		if (!this.cache.has(item.id)) this.cache.set(item.id, epicOf(item, this.byId, this.parentLabel));
		return this.cache.get(item.id)!;
	}

	/** An epic colors itself and its whole tree */
	slotFor(item: WorkItem): ColorSlot {
		const e = this.epic(item);
		const id = e ? numericId(e.id) : this.slots.has(numericId(item.id)) ? numericId(item.id) : null;
		if (id === null) return 'none';
		return this.slots.get(id) ?? 'other';
	}

	swatchKey(item: WorkItem): string {
		const e = this.epic(item);
		if (!e) return 'none';
		const slot = this.slots.get(numericId(e.id)) ?? 'other';
		return slot === 'other' ? 'other' : `epic:${numericId(e.id)}`;
	}

	/** Legend entries: real epics first (by slot), then "Other epics", then "No epic". */
	swatches(items: WorkItem[]): EpicSwatch[] {
		const byKey = new Map<string, EpicSwatch>();
		for (const item of items) {
			const e = this.epic(item);
			const key = this.swatchKey(item);
			const existing = byKey.get(key);
			if (existing) {
				existing.count++;
				continue;
			}
			const slot = e ? (this.slots.get(numericId(e.id)) ?? 'other') : 'none';
			byKey.set(key, {
				key,
				epicId: slot === 'other' || !e ? null : numericId(e.id),
				title: !e ? 'No epic' : slot === 'other' ? 'Other epics' : e.title,
				url: slot === 'other' || !e ? null : e.url,
				slot,
				count: 1
			});
		}
		const order = (s: EpicSwatch) => (s.slot === 'none' ? 99 : s.slot === 'other' ? 98 : s.slot);
		return [...byKey.values()].sort((a, b) => order(a) - order(b));
	}
}
