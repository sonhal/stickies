/**
 * Personal views in localStorage (D4): key `board.views.v1.<gitlabUserId>`.
 *
 * - Only view definitions are stored, never issue data.
 * - Every access is wrapped in try/catch: in a private window or with storage blocked/full the
 *   board still works with config views and shows a note.
 * - Views are validated on load; corrupt entries are skipped (and logged), the rest still load.
 * - The kiosk has no personal views.
 */
import { parseViewList } from '$lib/query/schema';
import type { ViewDefinition } from '$lib/query/types';

export interface StoredState {
	views: ViewDefinition[];
	/** Sidebar order of all view ids (config + personal). Unknown ids are ignored. */
	order: string[];
}

/** The storage parts used, so tests can pass a fake. */
export interface KV {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
}

export const storageKey = (userId: string | number) => `board.views.v1.${userId}`;

export function loadStored(kv: KV | null, key: string): { state: StoredState; ok: boolean; skipped: number } {
	const empty = { views: [], order: [] };
	if (!kv) return { state: empty, ok: false, skipped: 0 };
	let raw: string | null;
	try {
		raw = kv.getItem(key);
	} catch {
		return { state: empty, ok: false, skipped: 0 };
	}
	if (!raw) return { state: empty, ok: true, skipped: 0 };
	try {
		const parsed = JSON.parse(raw) as { views?: unknown; order?: unknown };
		const { views, skipped } = parseViewList(parsed?.views);
		if (skipped) console.warn(`[views] skipped ${skipped} saved view(s) that failed validation`);
		const order = Array.isArray(parsed?.order) ? parsed.order.filter((x): x is string => typeof x === 'string').slice(0, 400) : [];
		return { state: { views, order }, ok: true, skipped };
	} catch {
		console.warn('[views] saved views are not valid JSON; starting fresh');
		return { state: empty, ok: true, skipped: 1 };
	}
}

export function saveStored(kv: KV | null, key: string, state: StoredState): boolean {
	if (!kv) return false;
	try {
		kv.setItem(key, JSON.stringify({ views: state.views, order: state.order }));
		return true;
	} catch {
		return false;
	}
}

function browserStorage(): KV | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function newViewId(): string {
	const rnd = Math.random().toString(36).slice(2, 8);
	return `u-${Date.now().toString(36)}-${rnd}`;
}

export class ViewStore {
	personal = $state<ViewDefinition[]>([]);
	order = $state<string[]>([]);
	/** false when storage is blocked or full: show "views can't be saved in this browser" */
	writable = $state(true);
	loaded = $state(false);

	readonly config: ViewDefinition[];
	private key: string | null;
	private kv: KV | null;

	constructor(config: ViewDefinition[], userId: string | number | null, kv: KV | null = browserStorage()) {
		this.config = config;
		this.key = userId === null ? null : storageKey(userId);
		this.kv = this.key ? kv : null;
	}

	/** Call in the browser (onMount): SSR has no storage. */
	load() {
		if (!this.key) {
			this.loaded = true;
			this.writable = false;
			return;
		}
		const { state, ok } = loadStored(this.kv, this.key);
		this.personal = state.views;
		this.order = state.order;
		this.writable = ok;
		this.loaded = true;
	}

	get canSave(): boolean {
		return !!this.key;
	}

	/** Config views first (in config order), then personal ones, honoring a saved order. */
	get all(): ViewDefinition[] {
		const list = [...this.config, ...this.personal];
		if (!this.order.length) return list;
		const pos = new Map(this.order.map((id, i) => [id, i]));
		return list
			.map((v, i) => ({ v, i }))
			.sort((a, b) => (pos.get(a.v.id) ?? 1000 + a.i) - (pos.get(b.v.id) ?? 1000 + b.i))
			.map((x) => x.v);
	}

	find(id: string): ViewDefinition | null {
		return this.config.find((v) => v.id === id) ?? this.personal.find((v) => v.id === id) ?? null;
	}

	isPersonal(id: string): boolean {
		return this.personal.some((v) => v.id === id);
	}

	private persist() {
		if (!this.key) return;
		this.writable = saveStored(this.kv, this.key, { views: $state.snapshot(this.personal) as ViewDefinition[], order: this.order });
	}

	/** Save a new personal view (from a draft, a duplicate, a share link or an import). */
	add(view: ViewDefinition, name?: string): ViewDefinition {
		const v = { ...plain(view), id: newViewId(), name: (name ?? view.name).slice(0, 100) };
		this.personal = [...this.personal, v];
		this.persist();
		return v;
	}

	/** Overwrite a personal view. Config views can't be changed here (they live in the repo). */
	update(view: ViewDefinition): boolean {
		if (!this.isPersonal(view.id)) return false;
		this.personal = this.personal.map((v) => (v.id === view.id ? plain(view) : v));
		this.persist();
		return true;
	}

	rename(id: string, name: string) {
		const v = this.personal.find((x) => x.id === id);
		if (v && name.trim()) this.update({ ...v, name: name.trim().slice(0, 100) });
	}

	remove(id: string) {
		this.personal = this.personal.filter((v) => v.id !== id);
		this.order = this.order.filter((x) => x !== id);
		this.persist();
	}

	/** Move a view up or down in the sidebar. */
	move(id: string, delta: -1 | 1) {
		const ids = this.all.map((v) => v.id);
		const i = ids.indexOf(id);
		const j = i + delta;
		if (i === -1 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		this.order = ids;
		this.persist();
	}

	exportJson(ids?: string[]): string {
		const views = this.all.filter((v) => !ids || ids.includes(v.id));
		return JSON.stringify({ format: 'board-views', version: 1, views }, null, 2);
	}

	/** Import views from JSON (a list or an export file). Returns how many were added / skipped. */
	importJson(text: string): { added: number; skipped: number } {
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch {
			return { added: 0, skipped: 1 };
		}
		const list = Array.isArray(raw) ? raw : (raw as { views?: unknown })?.views;
		const { views, skipped } = parseViewList(list);
		for (const v of views) this.add(v);
		return { added: views.length, skipped };
	}
}

/** A storable copy: no Svelte proxies, and no one-off migration marker (saving acknowledges it). */
function plain(view: ViewDefinition): ViewDefinition {
	const { migrated: _migrated, ...rest } = structuredClone($state.snapshot(view) as ViewDefinition);
	return rest;
}
