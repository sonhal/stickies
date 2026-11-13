/**
 * Client-side board state: the viewer's items and FieldRegistry, plus derived helpers.
 * One instance per page, shared through Svelte context.
 */
import { getContext, setContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { applyWrite, currentWriteValue, type WriteField, type WriteValue } from '$lib/fields/apply';
import { EpicColors } from '$lib/colors';
import { withEpics } from '$lib/fields/epic';
import { formatValue, optionById, resolveField, statusOption } from '$lib/fields/registry';
import type { BoardData, FieldDef, FieldKey, FieldRegistry, OptionDef, WorkItem } from '$lib/fields/types';
import type { RankContext } from '$lib/query/rank';
import type { ViewDefinition } from '$lib/query/types';
import { settings } from '$lib/views.config';

/** How many changes Ctrl/Cmd+Z can take back */
const UNDO_MAX = 20;

export class BoardState {
	data = $state<BoardData>() as BoardData;
	items = $state<WorkItem[]>([]);
	/** Items with a write in flight (drawn dimmed) */
	pending = new SvelteSet<string>();
	/** In-flight writes per item: `pending` only clears when the last one finishes */
	private inflight = new Map<string, number>();
	/** Latest write started per item+field, with its value (review M3: out-of-order responses) */
	private latest = new Map<string, { seq: number; id: string; key: WriteField; value: WriteValue }>();
	private seq = 0;
	/** The item as GitLab last confirmed it (load, refresh or a successful write): rollback target */
	private confirmed = new Map<string, WorkItem>();
	/**
	 * Field changes made from this tab (saved, or still saving), oldest first, with the value that
	 * takes each back. Writing the value that is already there is not a step.
	 */
	private undoStack: { id: string; key: WriteField; previous: WriteValue; ref: string }[] = [];

	reg: FieldRegistry = $derived(this.data.registry);
	byId: Map<string, WorkItem> = $derived(new Map(this.items.map((i) => [i.id, i])));
	fieldsByKey: Map<FieldKey, FieldDef> = $derived(new Map(this.reg.fields.map((f) => [f.key, f])));
	colors: EpicColors = $derived(
		new EpicColors(this.items, settings.epicColors, (id) => {
			const f = this.fieldsByKey.get('native:parent');
			return f ? (optionById(f, id)?.label ?? null) : null;
		})
	);

	/** updatedAt of each item as returned by this browser's own last write (for conflict notices) */
	ownWrites = new SvelteMap<string, string>();
	/** Set by the shell: shows a toast */
	notify: (text: string, kind?: 'info' | 'error') => void = () => {};

	constructor(data: BoardData) {
		this.setData(data);
	}

	setData(data: BoardData) {
		this.data = data;
		for (const i of data.items) if (!this.pending.has(i.id)) this.confirmed.set(i.id, i);
		// Keep optimistic values for items with a write still in flight.
		const items = this.pending.size ? data.items.map((i) => (this.pending.has(i.id) ? (this.byId.get(i.id) ?? i) : i)) : data.items;
		this.items = withEpics(items, data.registry);
	}

	private replace(item: WorkItem) {
		const i = this.items.findIndex((x) => x.id === item.id);
		const items = i === -1 ? [item, ...this.items] : this.items.map((x) => (x.id === item.id ? item : x));
		// Recompute for everyone: a new parent on an issue also moves the tasks under it.
		this.items = withEpics(items, this.reg);
	}

	/**
	 * Optimistic write: show the change at once, send { itemId, field, value } to the server,
	 * then take the server's item. On failure, roll back just this field and show a toast.
	 *
	 * Responses can arrive out of order (review M3). Each write gets a sequence number per
	 * item+field, and a response only touches the screen if its write is still the latest for that
	 * field: a slow failure can't undo a newer success, and a late success can't overwrite a newer
	 * value. Newer writes to other fields of the same item are re-applied on top of a response.
	 */
	async update(id: string, key: WriteField, value: WriteValue): Promise<boolean> {
		return this.write(id, key, value, true);
	}

	/**
	 * Take back the last change that was saved from this tab (Ctrl/Cmd+Z): writes the field's
	 * previous value. Says what happened in a toast. The undo itself is not remembered, so a second
	 * undo goes one change further back instead of redoing.
	 */
	async undo(): Promise<boolean> {
		let entry = this.undoStack.pop();
		// Skip changes to items that are no longer loaded (closed long ago, moved out of the group).
		while (entry && !this.byId.has(entry.id)) entry = this.undoStack.pop();
		if (!entry) {
			this.notify('Nothing to undo');
			return false;
		}
		const ok = await this.write(entry.id, entry.key, entry.previous, false);
		if (ok) this.notify(`Undone: ${entry.ref}`);
		// Not saved (write() said why): keep it, so undo can be tried again.
		else this.undoStack.push(entry);
		return ok;
	}

	private async write(id: string, key: WriteField, value: WriteValue, undoable: boolean): Promise<boolean> {
		const before = this.byId.get(id);
		if (!before) return false;
		// Remembered at once, not when GitLab answers: Ctrl+Z right after a change takes back that
		// change even while it is still saving. Dropped again if the save fails.
		const previous = currentWriteValue(before, key);
		const undoEntry = undoable && JSON.stringify(previous) !== JSON.stringify(value) ? { id, key, previous, ref: before.ref } : null;
		if (undoEntry) {
			this.undoStack.push(undoEntry);
			if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
		}
		const forget = () => {
			if (undoEntry) this.undoStack = this.undoStack.filter((u) => u !== undoEntry);
		};
		const field = key === 'title' ? null : (this.fieldsByKey.get(key) ?? null);
		const slot = `${id}\u0000${key}`;
		const mySeq = ++this.seq;
		this.latest.set(slot, { seq: mySeq, id, key, value });
		if (!this.confirmed.has(id)) this.confirmed.set(id, before);
		this.replace(applyWrite(before, field, key, value));
		this.begin(id);
		const isLatest = () => this.latest.get(slot)?.seq === mySeq;
		const rollback = () => {
			if (!isLatest()) return; // a newer write to this field decides what's shown
			this.latest.delete(slot);
			const now = this.byId.get(id);
			const base = this.confirmed.get(id) ?? before;
			if (now) this.replace(applyWrite(now, field, key, currentWriteValue(base, key)));
		};
		try {
			const res = await fetch('/api/items/update', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId: id, field: key, value })
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; item?: WorkItem; error?: string } | null;
			if (!res.ok || !body?.ok || !body.item) {
				rollback();
				forget();
				this.notify(body?.error ?? `Couldn't save (HTTP ${res.status})`, 'error');
				return false;
			}
			this.ownWrites.set(id, body.item.updatedAt);
			this.confirmed.set(id, body.item);
			if (isLatest()) {
				this.latest.delete(slot);
				this.replace(this.withNewerWrites(body.item, mySeq));
			}
			return true;
		} catch {
			rollback();
			forget();
			this.notify("Couldn't reach the board server. Your change was undone.", 'error');
			return false;
		} finally {
			this.end(id);
		}
	}

	/** Re-apply writes to this item that started after `seq` (still in flight or not yet confirmed). */
	private withNewerWrites(item: WorkItem, seq: number): WorkItem {
		let out = item;
		for (const w of this.latest.values()) {
			if (w.id !== item.id || w.seq <= seq) continue;
			out = applyWrite(out, w.key === 'title' ? null : (this.fieldsByKey.get(w.key) ?? null), w.key, w.value);
		}
		return out;
	}

	private begin(id: string) {
		this.inflight.set(id, (this.inflight.get(id) ?? 0) + 1);
		this.pending.add(id);
	}

	private end(id: string) {
		const n = (this.inflight.get(id) ?? 1) - 1;
		if (n > 0) return void this.inflight.set(id, n);
		this.inflight.delete(id);
		this.pending.delete(id);
	}

	async create(input: {
		title: string;
		/** Not needed for an Epic: the server creates it in the board's group */
		projectId?: string;
		type?: string;
		parentId?: string | null;
		description?: string;
		values?: Record<string, WriteValue>;
	}): Promise<WorkItem | null> {
		try {
			const res = await fetch('/api/items/create', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(input)
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; item?: WorkItem; error?: string } | null;
			if (!res.ok || !body?.ok || !body.item) {
				const what = input.type?.toLowerCase() === 'epic' ? 'epic' : 'issue';
				this.notify(body?.error ?? `Couldn't create the ${what} (HTTP ${res.status})`, 'error');
				return null;
			}
			this.ownWrites.set(body.item.id, body.item.updatedAt);
			this.replace(body.item);
			this.notify(`Created ${body.item.ref}`);
			return body.item;
		} catch {
			this.notify("Couldn't reach the board server.", 'error');
			return null;
		}
	}

	field(key: FieldKey): FieldDef | undefined {
		return this.fieldsByKey.get(key);
	}

	status(item: WorkItem): OptionDef | null {
		return statusOption(this.reg, item);
	}

	text(item: WorkItem, key: FieldKey): string {
		const f = this.fieldsByKey.get(key);
		return f ? formatValue(this.reg, f, item.values[key]) : '';
	}

	epicTitle(item: WorkItem): string {
		return this.colors.epic(item)?.title ?? 'No epic';
	}

	rankContext(view?: ViewDefinition): RankContext {
		return {
			reg: this.reg,
			fieldSettings: settings.fieldSettings,
			defaultDirection: settings.defaultRankDirection,
			viewDirection: view?.rankDirection
		};
	}

	resolve(ref: Parameters<typeof resolveField>[1]) {
		return resolveField(this.reg, ref);
	}
}

const KEY = Symbol('board');
export const setBoard = (b: BoardState) => setContext(KEY, b);
export const getBoard = () => getContext<BoardState>(KEY);
