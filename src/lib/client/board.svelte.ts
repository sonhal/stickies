/**
 * Client-side board state: the viewer's items and FieldRegistry, plus derived helpers.
 * One instance per page, shared through Svelte context.
 */
import { getContext, setContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { applyWrite, currentWriteValue, type WriteField, type WriteValue } from '$lib/fields/apply';
import { EpicColors } from '$lib/colors';
import { withEpics } from '$lib/fields/epic';
import { canParent, formatValue, optionById, resolveField, statusOption } from '$lib/fields/registry';
import type { BoardData, FieldDef, FieldKey, FieldRegistry, OptionDef, WorkItem } from '$lib/fields/types';
import type { Comment, CommentThread } from '$lib/comments';
import type { RankContext } from '$lib/query/rank';
import type { ViewDefinition } from '$lib/query/types';
import { settings } from '$lib/views.config';

/** How many changes Ctrl/Cmd+Z can take back */
const UNDO_MAX = 20;
/** Most changes per bulk request (the server's BULK_MAX); a bigger selection goes in several */
const BULK_CHUNK = 50;

/** One undo step: a single edit, or a whole bulk edit (one field on many items), taken back together */
interface UndoEntry {
	key: WriteField;
	steps: { id: string; previous: WriteValue }[];
	/** What the toast names: "g/api#12", or "8 issues" */
	ref: string;
}

/** A write shown on screen and waiting for GitLab's answer (see stage/settle/rollback) */
interface Staged {
	id: string;
	key: WriteField;
	value: WriteValue;
	field: FieldDef | null;
	slot: string;
	seq: number;
	before: WorkItem;
	previous: WriteValue;
}

type BulkResult = { itemId: string; ok: true; item: WorkItem } | { itemId: string; ok: false; error: string };

const same = (a: WriteValue, b: WriteValue) => JSON.stringify(a) === JSON.stringify(b);

export class BoardState {
	data = $state<BoardData>() as BoardData;
	items = $state<WorkItem[]>([]);
	/** Items with a write in flight (drawn dimmed) */
	pending = new SvelteSet<string>();
	/** In-flight writes per item: `pending` only clears when the last one finishes */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- private bookkeeping, never read by a template
	private inflight = new Map<string, number>();
	/** Latest write started per item+field, with its value (review M3: out-of-order responses) */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- private bookkeeping, never read by a template
	private latest = new Map<string, { seq: number; id: string; key: WriteField; value: WriteValue }>();
	private seq = 0;
	/** The item as GitLab last confirmed it (load, refresh or a successful write): rollback target */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- private bookkeeping, never read by a template
	private confirmed = new Map<string, WorkItem>();
	/**
	 * Field changes made from this tab (saved, or still saving), oldest first, with the value that
	 * takes each back. Writing the value that is already there is not a step.
	 */
	private undoStack: UndoEntry[] = [];

	reg: FieldRegistry = $derived(this.data.registry);
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt by $derived, never mutated
	byId: Map<string, WorkItem> = $derived(new Map(this.items.map((i) => [i.id, i])));
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- rebuilt by $derived, never mutated
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
		if (this.removed.size) data = { ...data, items: data.items.filter((i) => !this.removed.has(i.id)) };
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
	 * previous value. A bulk edit is taken back as a whole. Says what happened in a toast. The undo
	 * itself is not remembered, so a second undo goes one change further back instead of redoing.
	 */
	async undo(): Promise<boolean> {
		let entry = this.undoStack.pop();
		// Skip changes to items that are no longer loaded (closed long ago, moved out of the group).
		const loaded = (e: UndoEntry) => e.steps.filter((s) => this.byId.has(s.id));
		while (entry && !loaded(entry).length) entry = this.undoStack.pop();
		if (!entry) {
			this.notify('Nothing to undo');
			return false;
		}
		const steps = loaded(entry);
		if (steps.length === 1 && entry.steps.length === 1) {
			const ok = await this.write(steps[0].id, entry.key, steps[0].previous, false);
			if (ok) this.notify(`Undone: ${entry.ref}`);
			// Not saved (write() said why): keep it, so undo can be tried again.
			else this.undoStack.push(entry);
			return ok;
		}
		const r = await this.updateMany(
			entry.key,
			steps.map((s) => ({ id: s.id, value: s.previous })),
			{ undoable: false, quiet: true }
		);
		if (r.failed.length) {
			// Keep what couldn't be taken back, so undo can be tried again for those.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping, never read by a template
			const failed = new Set(r.failed);
			this.undoStack.push({ ...entry, steps: steps.filter((s) => failed.has(s.id)) });
			this.notify(`Undone on ${r.done} of ${steps.length}. ${r.error ?? ''}`.trim(), 'error');
			return false;
		}
		this.notify(`Undone: ${entry.ref}`);
		return true;
	}

	private pushUndo(entry: UndoEntry) {
		this.undoStack.push(entry);
		if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
	}

	/** Drop steps from an undo entry (their save failed); the entry goes when none is left. */
	private forgetSteps(entry: UndoEntry | null, ids: Set<string>) {
		if (!entry || !ids.size) return;
		entry.steps = entry.steps.filter((s) => !ids.has(s.id));
		if (!entry.steps.length) this.undoStack = this.undoStack.filter((u) => u !== entry);
	}

	/**
	 * Show a write at once and remember what it replaced. Each write gets a sequence number per
	 * item+field, so a late answer can't overwrite a newer value (review M3). Call settle() or
	 * rollback(), then end().
	 */
	private stage(id: string, key: WriteField, value: WriteValue): Staged | null {
		const before = this.byId.get(id);
		if (!before) return null;
		const previous = currentWriteValue(before, key);
		const field = key === 'title' ? null : (this.fieldsByKey.get(key) ?? null);
		const slot = `${id}\u0000${key}`;
		const seq = ++this.seq;
		this.latest.set(slot, { seq, id, key, value });
		if (!this.confirmed.has(id)) this.confirmed.set(id, before);
		this.replace(applyWrite(before, field, key, value));
		this.begin(id);
		return { id, key, value, field, slot, seq, before, previous };
	}

	private isLatest(s: Staged) {
		return this.latest.get(s.slot)?.seq === s.seq;
	}

	/** GitLab took it: keep its item, with newer writes to the same item still shown on top. */
	private settle(s: Staged, item: WorkItem) {
		this.ownWrites.set(s.id, item.updatedAt);
		this.confirmed.set(s.id, item);
		if (this.isLatest(s)) {
			this.latest.delete(s.slot);
			this.replace(this.withNewerWrites(item, s.seq));
		}
	}

	/** GitLab refused: put this field back as GitLab last confirmed it (unless a newer write decides). */
	private rollback(s: Staged) {
		if (!this.isLatest(s)) return;
		this.latest.delete(s.slot);
		const now = this.byId.get(s.id);
		const base = this.confirmed.get(s.id) ?? s.before;
		if (now) this.replace(applyWrite(now, s.field, s.key, currentWriteValue(base, s.key)));
	}

	private async write(id: string, key: WriteField, value: WriteValue, undoable: boolean): Promise<boolean> {
		const s = this.stage(id, key, value);
		if (!s) return false;
		// Remembered at once, not when GitLab answers: Ctrl+Z right after a change takes back that
		// change even while it is still saving. Dropped again if the save fails.
		const undoEntry: UndoEntry | null = undoable && !same(s.previous, value) ? { key, steps: [{ id, previous: s.previous }], ref: s.before.ref } : null;
		if (undoEntry) this.pushUndo(undoEntry);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping, never read by a template
		const forget = () => this.forgetSteps(undoEntry, new Set([id]));
		try {
			const res = await fetch('/api/items/update', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId: id, field: key, value })
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; item?: WorkItem; error?: string } | null;
			if (!res.ok || !body?.ok || !body.item) {
				this.rollback(s);
				forget();
				this.notify(body?.error ?? `Couldn't save (HTTP ${res.status})`, 'error');
				return false;
			}
			this.settle(s, body.item);
			return true;
		} catch {
			this.rollback(s);
			forget();
			this.notify("Couldn't reach the board server. Your change was undone.", 'error');
			return false;
		} finally {
			this.end(id);
		}
	}

	/**
	 * Bulk edit: one field on many items, each with its own value (see $lib/client/bulk). Optimistic
	 * like `update`: everything shows at once, and items GitLab refuses roll back on their own. One
	 * Ctrl/Cmd+Z takes back the whole change. Sent in requests of up to BULK_CHUNK items; the server
	 * checks each change like a single edit and refuses a request whole if one is invalid.
	 */
	async updateMany(
		key: WriteField,
		changes: { id: string; value: WriteValue }[],
		opts: { undoable?: boolean; label?: string; quiet?: boolean } = {}
	): Promise<{ done: number; failed: string[]; error: string | null }> {
		const staged = changes.map((c) => this.stage(c.id, key, c.value)).filter((s): s is Staged => !!s);
		if (!staged.length) return { done: 0, failed: [], error: null };
		const steps = staged.filter((s) => !same(s.previous, s.value)).map((s) => ({ id: s.id, previous: s.previous }));
		const undoEntry: UndoEntry | null =
			opts.undoable !== false && steps.length
				? { key, steps, ref: opts.label ?? (staged.length === 1 ? staged[0].before.ref : `${staged.length} items`) }
				: null;
		if (undoEntry) this.pushUndo(undoEntry);

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping, never read by a template
		const failed = new Set<string>();
		let firstError: string | null = null;
		const refuse = (s: Staged, error: string) => {
			this.rollback(s);
			failed.add(s.id);
			firstError ??= error;
		};
		try {
			for (let i = 0; i < staged.length; i += BULK_CHUNK) {
				const chunk = staged.slice(i, i + BULK_CHUNK);
				try {
					const res = await fetch('/api/items/bulk', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ field: key, changes: chunk.map((s) => ({ itemId: s.id, value: s.value })) })
					});
					const body = (await res.json().catch(() => null)) as { ok?: boolean; results?: BulkResult[]; error?: string } | null;
					if (!res.ok || !body?.ok || !Array.isArray(body.results)) {
						for (const s of chunk) refuse(s, body?.error ?? `Couldn't save (HTTP ${res.status})`);
						continue;
					}
					// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local bookkeeping, never read by a template
					const byItem = new Map(body.results.map((r) => [r.itemId, r]));
					for (const s of chunk) {
						const r = byItem.get(s.id);
						if (r?.ok) this.settle(s, r.item);
						else refuse(s, r ? `${s.before.ref}: ${r.error}` : `${s.before.ref}: no answer from the server`);
					}
				} catch {
					for (const s of chunk) refuse(s, "Couldn't reach the board server. Your change was undone.");
				}
			}
		} finally {
			for (const s of staged) this.end(s.id);
		}
		this.forgetSteps(undoEntry, failed);
		const done = staged.length - failed.size;
		if (!opts.quiet) {
			if (failed.size) this.notify(done ? `Changed ${done} of ${staged.length}. ${firstError}` : (firstError ?? "Couldn't save"), 'error');
			else if (opts.label) this.notify(opts.label);
		}
		return { done, failed: [...failed], error: firstError };
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

	/** The full Markdown description and its version, for the editor. */
	async loadDescription(id: string): Promise<{ ok: true; description: string; version: string; editable: boolean } | { ok: false; error: string }> {
		try {
			const res = await fetch(`/api/items/description?id=${encodeURIComponent(id)}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
			const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; version?: string; editable?: boolean; error?: string } | null;
			if (!res.ok || !body?.ok || typeof body.description !== 'string' || typeof body.version !== 'string') {
				return { ok: false, error: body?.error ?? `Couldn't load the description (HTTP ${res.status})` };
			}
			return { ok: true, description: body.description, version: body.version, editable: body.editable !== false };
		} catch {
			return { ok: false, error: "Couldn't reach the board server." };
		}
	}

	/** An item's comments (GitLab notes), oldest thread first. Loaded on demand, never cached. */
	async loadComments(id: string): Promise<{ ok: true; threads: CommentThread[]; more: boolean } | { ok: false; error: string }> {
		try {
			const res = await fetch(`/api/items/comments?id=${encodeURIComponent(id)}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
			const body = (await res.json().catch(() => null)) as { ok?: boolean; threads?: CommentThread[]; more?: boolean; error?: string } | null;
			if (!res.ok || !body?.ok || !Array.isArray(body.threads)) return { ok: false, error: body?.error ?? `Couldn't load the comments (HTTP ${res.status})` };
			return { ok: true, threads: body.threads, more: body.more === true };
		} catch {
			return { ok: false, error: "Couldn't reach the board server." };
		}
	}

	/**
	 * Add a comment, or a reply to a thread. Not optimistic: the editor keeps the text until GitLab
	 * has it, so a failure never loses what was typed.
	 */
	async addComment(
		itemId: string,
		body: string,
		discussionId: string | null = null
	): Promise<{ ok: true; comment: Comment; discussionId: string } | { ok: false; error: string }> {
		try {
			const res = await fetch('/api/items/comments', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId, body, discussionId })
			});
			const r = (await res.json().catch(() => null)) as { ok?: boolean; comment?: Comment; discussionId?: string; error?: string } | null;
			if (!res.ok || !r?.ok || !r.comment || typeof r.discussionId !== 'string') return { ok: false, error: r?.error ?? `Couldn't save the comment (HTTP ${res.status})` };
			return { ok: true, comment: r.comment, discussionId: r.discussionId };
		} catch {
			return { ok: false, error: "Couldn't reach the board server." };
		}
	}

	/** Edit a comment's text. Not optimistic: the editor keeps the text until GitLab has it. */
	async editComment(itemId: string, noteId: string, body: string): Promise<{ ok: true; comment: Comment } | { ok: false; error: string }> {
		const r = await this.commentRequest('PATCH', { itemId, noteId, body });
		return r.ok && r.comment ? { ok: true, comment: r.comment } : { ok: false, error: r.error ?? "Couldn't save the comment" };
	}

	/** Delete a comment (the UI asks first). */
	async deleteComment(itemId: string, noteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
		const r = await this.commentRequest('DELETE', { itemId, noteId });
		return r.ok ? { ok: true } : { ok: false, error: r.error ?? "Couldn't delete the comment" };
	}

	private async commentRequest(method: 'PATCH' | 'DELETE', payload: object): Promise<{ ok: boolean; comment?: Comment; error?: string }> {
		try {
			const res = await fetch('/api/items/comments', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
			const r = (await res.json().catch(() => null)) as { ok?: boolean; comment?: Comment; error?: string } | null;
			if (!res.ok || !r?.ok) return { ok: false, error: r?.error ?? `GitLab didn't take the change (HTTP ${res.status})` };
			return { ok: true, comment: r.comment };
		} catch {
			return { ok: false, error: "Couldn't reach the board server." };
		}
	}

	/**
	 * Save a description. Not optimistic, unlike field edits: the editor keeps the text until GitLab
	 * has it, so a failure never loses what was typed. `baseVersion` is the version the editor
	 * started from; the server refuses (conflict) if GitLab's text changed since. Not undoable:
	 * undo restores values the board holds, and the board only holds a plain-text copy.
	 */
	async updateDescription(
		id: string,
		text: string,
		baseVersion: string
	): Promise<{ ok: true } | { ok: false; error: string; conflict: boolean }> {
		if (!this.byId.has(id)) return { ok: false, error: 'That item is no longer on the board.', conflict: false };
		const mySeq = ++this.seq;
		this.begin(id);
		try {
			const res = await fetch('/api/items/update', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId: id, field: 'description', value: text, baseVersion })
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; item?: WorkItem; error?: string; conflict?: boolean } | null;
			if (!res.ok || !body?.ok || !body.item) {
				return { ok: false, error: body?.error ?? `Couldn't save (HTTP ${res.status})`, conflict: !!body?.conflict };
			}
			this.ownWrites.set(id, body.item.updatedAt);
			this.confirmed.set(id, body.item);
			// Field edits started meanwhile are still in flight: keep showing them on top
			this.replace(this.withNewerWrites(body.item, mySeq));
			return { ok: true };
		} catch {
			return { ok: false, error: "Couldn't reach the board server. Your text has not been saved.", conflict: false };
		} finally {
			this.end(id);
		}
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

	/**
	 * Delete an item in GitLab. Not optimistic, unlike `update`: a delete can't be taken back, so
	 * the item stays on screen (drawn as pending) until GitLab confirms, and stays put if it refuses.
	 * Not undoable either: nothing goes on the undo stack, and the item's earlier changes leave it.
	 * Only ever called after the user confirmed (ConfirmDialog).
	 */
	async remove(id: string): Promise<boolean> {
		const it = this.byId.get(id);
		if (!it) return false;
		this.begin(id);
		try {
			const res = await fetch('/api/items/delete', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ itemId: id })
			});
			const body = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
			if (!res.ok || !body?.ok) {
				this.notify(body?.error ?? `Couldn't delete ${it.ref} (HTTP ${res.status})`, 'error');
				return false;
			}
			this.forgetItem(id);
			this.onremove(id);
			this.notify(`Deleted ${it.ref}`);
			return true;
		} catch {
			this.notify(`Couldn't reach the board server. ${it.ref} was not deleted.`, 'error');
			return false;
		} finally {
			this.end(id);
		}
	}

	/** Set by the shell: a deleted item must stop being selected */
	onremove: (id: string) => void = () => {};
	/** Deleted from this tab: a refresh that was already on its way must not bring them back */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- private bookkeeping, never read by a template
	private removed = new Set<string>();

	private forgetItem(id: string) {
		this.removed.add(id);
		this.undoStack = this.undoStack
			.map((u) => ({ ...u, steps: u.steps.filter((st) => st.id !== id) }))
			.filter((u) => u.steps.length > 0);
		this.confirmed.delete(id);
		this.ownWrites.delete(id);
		for (const [slot, w] of this.latest) if (w.id === id) this.latest.delete(slot);
		// GitLab drops the parent links with the parent: its sub-items stay, without a parent. Also
		// in `confirmed`, so a failed edit on a sub-item can't roll its parent back.
		const orphan = (x: WorkItem): WorkItem => {
			const values = { ...x.values };
			delete values['native:parent'];
			return { ...x, parentId: null, values };
		};
		for (const [cid, c] of this.confirmed) if (c.parentId === id) this.confirmed.set(cid, orphan(c));
		const items = this.items.filter((x) => x.id !== id).map((x) => (x.parentId === id ? orphan(x) : x));
		// Nor is it offered as a parent or epic any more.
		const reg = this.data.registry;
		const fields = reg.fields.map((f) =>
			(f.key === 'native:parent' || f.key === 'native:epic') && f.options?.some((o) => o.id === id)
				? { ...f, options: f.options.filter((o) => o.id !== id) }
				: f
		);
		this.data = { ...this.data, items: this.data.items.filter((x) => x.id !== id), registry: { ...reg, fields } };
		this.items = withEpics(items, this.data.registry);
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

	/**
	 * Items that an item of `childType` may sit under, following GitLab's hierarchy (Epic → Epic |
	 * Issue, Issue → Task, as GitLab reports it): a task's parent is an issue, an issue's an epic.
	 * `keep` (the current parent) stays in the list even when it isn't loaded, so it can be shown.
	 */
	parentChoices(childType: string, keep?: string | null): OptionDef[] {
		const out: OptionDef[] = this.items
			.filter((i) => canParent(this.reg, i.type, childType))
			.sort((a, b) => a.title.localeCompare(b.title))
			.map((i, n) => ({ id: i.id, label: i.title, hint: i.ref, position: n }));
		if (keep && !out.some((o) => o.id === keep)) {
			const f = this.fieldsByKey.get('native:parent');
			const o = f ? optionById(f, keep) : undefined;
			if (o) out.push({ ...o, position: out.length });
		}
		return out;
	}
}

const KEY = Symbol('board');
export const setBoard = (b: BoardState) => setContext(KEY, b);
export const getBoard = () => getContext<BoardState>(KEY);
