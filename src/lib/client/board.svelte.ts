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

export class BoardState {
	data = $state<BoardData>() as BoardData;
	items = $state<WorkItem[]>([]);
	/** Items with a write in flight (drawn dimmed) */
	pending = new SvelteSet<string>();

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
	 */
	async update(id: string, key: WriteField, value: WriteValue): Promise<boolean> {
		const before = this.byId.get(id);
		if (!before) return false;
		const field = key === 'title' ? null : (this.fieldsByKey.get(key) ?? null);
		this.replace(applyWrite(before, field, key, value));
		this.pending.add(id);
		const rollback = () => {
			const now = this.byId.get(id);
			if (now) this.replace(applyWrite(now, field, key, currentWriteValue(before, key)));
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
				this.notify(body?.error ?? `Couldn't save (HTTP ${res.status})`, 'error');
				return false;
			}
			this.ownWrites.set(id, body.item.updatedAt);
			this.replace(body.item);
			return true;
		} catch {
			rollback();
			this.notify("Couldn't reach the board server. Your change was undone.", 'error');
			return false;
		} finally {
			this.pending.delete(id);
		}
	}

	async create(input: {
		title: string;
		projectId: string;
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
				this.notify(body?.error ?? `Couldn't create the issue (HTTP ${res.status})`, 'error');
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
