/** Shell-wide UI state: selection, panel, palette, toasts. Shared through context. */
import { getContext, setContext } from 'svelte';
import type { FieldKey } from '$lib/fields/types';

export interface Toast {
	id: number;
	text: string;
	kind: 'info' | 'error';
}

/** Values to pre-fill "create issue" from the current view's filters and group. */
export interface CreatePrefill {
	projectId?: string;
	parentId?: string;
	values?: Partial<Record<FieldKey, string>>;
	/** Work item type name to start with, e.g. 'Epic' for "New epic". Default: Issue. */
	type?: string;
}

let toastSeq = 0;

export class UiState {
	selectedId = $state<string | null>(null);
	panelOpen = $state(false);
	paletteOpen = $state(false);
	createOpen = $state<CreatePrefill | null>(null);
	toasts = $state<Toast[]>([]);
	/** Item ids in on-screen order, set by the active layout, for j/k */
	navOrder = $state<string[]>([]);
	/** Ask the detail panel to open an editor (keyboard s/a/l/w) */
	editRequest = $state<{ field: FieldKey; n: number } | null>(null);
	/** Current view's prefill for "create", set by the workspace */
	createDefaults = $state<CreatePrefill>({});
	/** Layout of the current view; the shell hides the side panel for the matrix (it has its own) */
	layout = $state<'list' | 'board' | 'matrix'>('list');
	/** Bumped by the `/` shortcut: the filter bar focuses its search box when this changes */
	searchRequest = $state(0);
	/** Bumped by the `F` shortcut: the filter bar opens its "add filter" picker when this changes */
	filterRequest = $state(0);
	/** Kiosk / read-only screen */
	readOnly = $state(false);

	open(id: string) {
		this.selectedId = id;
		this.panelOpen = true;
	}

	close() {
		this.panelOpen = false;
	}

	move(delta: 1 | -1) {
		const ids = this.navOrder;
		if (!ids.length) return;
		const i = this.selectedId ? ids.indexOf(this.selectedId) : -1;
		const next = i === -1 ? (delta === 1 ? 0 : ids.length - 1) : Math.min(ids.length - 1, Math.max(0, i + delta));
		this.selectedId = ids[next];
	}

	edit(field: FieldKey) {
		if (!this.selectedId || this.readOnly) return;
		this.panelOpen = true;
		this.editRequest = { field, n: (this.editRequest?.n ?? 0) + 1 };
	}

	toast(text: string, kind: Toast['kind'] = 'info') {
		const t = { id: ++toastSeq, text, kind };
		this.toasts = [...this.toasts, t];
		setTimeout(() => this.dismiss(t.id), kind === 'error' ? 7000 : 3500);
	}

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}
}

const KEY = Symbol('ui');
export const setUi = (u: UiState) => setContext(KEY, u);
export const getUi = () => getContext<UiState>(KEY);

/** True when a key press should go to a text field, not to a shortcut. */
export function isTyping(e: KeyboardEvent): boolean {
	const el = e.target as HTMLElement | null;
	if (!el) return false;
	return ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable;
}
