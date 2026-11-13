<script lang="ts">
	import { afterNavigate, goto, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, untrack } from 'svelte';
	import { BoardState, setBoard } from '$lib/client/board.svelte';
	import { UiState, setUi, isTyping } from '$lib/client/ui.svelte';
	import { ViewStore } from '$lib/client/viewStore.svelte';
	import { setViews } from '$lib/client/views-context';
	import { setTools } from '$lib/client/tools-context';
	import { prioritizationTools } from '$lib/prioritization.config';
	import { toolType } from '$lib/prioritization/tools';
	import { defaultViews, settings } from '$lib/views.config';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import ItemPanel from '$lib/components/ItemPanel.svelte';
	import CreateDialog from '$lib/components/CreateDialog.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import ShortcutSheet from '$lib/components/ShortcutSheet.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import { deleteText } from '$lib/client/deleteText';
	import { readSidebarParam, withSidebarParam } from '$lib/client/urlState';
	import type { Command } from '$lib/client/commands';
	import type { NavDir } from '$lib/client/boardNav';
	import { appliesTo, closedKind } from '$lib/fields/registry';
	import type { BoardData, FieldKey, WorkItem } from '$lib/fields/types';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// svelte-ignore state_referenced_locally
	const board = new BoardState(data.board);
	setBoard(board);
	// Only data.board is a dependency: setData reads items/pending, which must not re-trigger this.
	$effect(() => {
		const next = data.board;
		untrack(() => board.setData(next));
	});

	const ui = new UiState();
	// svelte-ignore state_referenced_locally
	ui.readOnly = data.viewer?.kind !== 'user';
	setUi(ui);
	board.notify = (text, kind) => ui.toast(text, kind);
	board.onremove = (id) => ui.forget(id);

	// svelte-ignore state_referenced_locally
	const kioskIds = data.kiosk?.views ?? null;
	const kioskViews = kioskIds ? defaultViews.filter((v) => kioskIds.includes(v.id)) : null;
	// The kiosk uses config views only: no personal views, nothing in storage.
	// svelte-ignore state_referenced_locally
	const views = new ViewStore(kioskViews ?? defaultViews, data.viewer?.kind === 'user' ? data.viewer.id : null);
	setViews(views);

	// Prioritization tools. KIOSK_VIEWS can list tool ids and view ids, in the order to show them.
	const tools = kioskIds ? prioritizationTools.filter((t) => kioskIds.includes(t.id)) : prioritizationTools;
	/** Kiosk pages in KIOSK_VIEWS order: what "/" shows first and what rotation cycles through */
	const kioskPages = kioskIds
		? kioskIds.flatMap((id) =>
				tools.some((t) => t.id === id) ? [`/p/${id}`] : kioskViews!.some((v) => v.id === id) ? [`/v/${id}`] : []
			)
		: null;
	const firstKiosk = kioskPages?.[0];
	setTools({
		list: tools,
		home: firstKiosk?.startsWith('/p/')
			? { kind: 'tool', id: firstKiosk.slice(3) }
			: firstKiosk
				? { kind: 'view', id: firstKiosk.slice(3) }
				: null
	});

	const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const selected = $derived(ui.selectedId ? (board.byId.get(ui.selectedId) ?? null) : null);
	let navOpen = $state(false);
	/**
	 * Desktop: sidebar hidden completely for more room. Remembered per browser when you toggle it
	 * yourself. A URL with ?sidebar=hidden (e.g. a kiosk screen) hides it without saving that.
	 */
	let navHidden = $state(false);
	/**
	 * The sidebar is hidden because the URL said so. The param then stays in the address bar
	 * (through kiosk rotation and in-app navigation) so a reload keeps it hidden, until you
	 * toggle the sidebar yourself.
	 */
	let navHiddenByUrl = $state(false);
	const NAV_KEY = 'board-nav-hidden';
	function storedNavHidden(): boolean {
		try {
			return localStorage.getItem(NAV_KEY) === '1';
		} catch {
			return false; // storage blocked
		}
	}
	function setNavHidden(hidden: boolean) {
		navHidden = hidden;
		navHiddenByUrl = false;
		try {
			if (hidden) localStorage.setItem(NAV_KEY, '1');
			else localStorage.removeItem(NAV_KEY);
		} catch {
			/* storage blocked: the choice just isn't remembered */
		}
	}

	// ---- Refresh -------------------------------------------------------------------------------
	let refreshing = $state(false);
	let now = $state<number | null>(null);
	/** The board server didn't answer the last refresh: the data on screen is kept and marked as old */
	let offline = $state(false);

	/**
	 * Fetches the board as JSON rather than re-running the page load: if the board server is
	 * restarting or the network drops, this is skipped and tried again on the next tick. A failed
	 * SvelteKit navigation would swap the whole page for the browser's error screen.
	 */
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			const res = await fetch('/api/board', { headers: { accept: 'application/json' }, cache: 'no-store' });
			if (res.status === 401) {
				// Session ended: a full navigation, so the sign-in page loads fresh.
				location.assign(`/signin?returnTo=${encodeURIComponent(page.url.pathname + page.url.search)}`);
				return;
			}
			const body = res.ok ? ((await res.json()) as { board?: BoardData }) : null;
			if (!body?.board) throw new Error(`HTTP ${res.status}`);
			board.setData(body.board);
			offline = false;
		} catch {
			offline = true;
		} finally {
			refreshing = false;
		}
	}

	$effect(() => {
		if (!settings.refreshSeconds) return;
		const t = setInterval(() => {
			// Don't poll GitLab from a background tab, or while a write is in flight.
			if (document.visibilityState === 'visible' && board.pending.size === 0) refresh();
		}, settings.refreshSeconds * 1000);
		return () => clearInterval(t);
	});

	// ---- Kiosk rotation ------------------------------------------------------------------------
	$effect(() => {
		const secs = data.kiosk?.rotateSeconds ?? 0;
		if (!kioskPages || kioskPages.length < 2 || secs <= 0) return;
		const t = setInterval(() => {
			const i = kioskPages.indexOf(page.url.pathname);
			goto(kioskPages[(i + 1) % kioskPages.length]); // "/" (i = -1) counts as the first page
		}, secs * 1000);
		return () => clearInterval(t);
	});

	function ago(iso: string | null, nowMs: number | null): string {
		if (!iso || nowMs === null) return '';
		const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
		if (s < 10) return 'just now';
		if (s < 60) return `${s}s ago`;
		const m = Math.round(s / 60);
		return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
	}

	// ---- Theme ------------------------------------------------------------------------------------
	type Theme = 'auto' | 'light' | 'dark';
	let theme = $state<Theme>('auto');

	function applyTheme(t: Theme) {
		if (t === 'auto') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = t;
		try {
			localStorage.setItem('board-theme', t);
		} catch {
			/* storage blocked: theme just won't be remembered */
		}
	}

	function cycleTheme() {
		theme = theme === 'auto' ? 'dark' : theme === 'dark' ? 'light' : 'auto';
		applyTheme(theme);
	}

	onMount(() => {
		views.load();
		// Lets tests (and nothing else) know the app is hydrated.
		document.documentElement.dataset.ready = '1';
		now = Date.now();
		const clock = setInterval(() => (now = Date.now()), 10_000);
		try {
			const saved = localStorage.getItem('board-theme');
			if (saved === 'light' || saved === 'dark') {
				theme = saved;
				applyTheme(saved);
			}
		} catch {
			/* ignore */
		}
		return () => clearInterval(clock);
	});

	// ---- Keyboard ---------------------------------------------------------------------------------
	let gPending = false;
	let gTimer: ReturnType<typeof setTimeout> | undefined;

	/** A dialog, popover, palette or the shortcut sheet is up: it owns the keyboard. */
	function overlayOpen(e: KeyboardEvent): boolean {
		if (ui.paletteOpen || ui.createOpen || ui.shortcutsOpen || ui.deleteRequest) return true;
		if ((e.target as HTMLElement | null)?.closest('[role="dialog"], dialog')) return true;
		return !!document.querySelector('[role="dialog"], dialog[open]');
	}

	/**
	 * Every key listed in $lib/client/shortcuts.ts is handled here, apart from the matrix walk-through
	 * (MatrixLayout) and Alt+arrows on a focused card (BoardLayout). Keep the two in step.
	 */
	function onKey(e: KeyboardEvent) {
		const mod = e.metaKey || e.ctrlKey;
		// Ctrl/Cmd+K works from anywhere, text fields included, like Linear.
		if (mod && !e.altKey && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			ui.paletteOpen = !ui.paletteOpen;
			return;
		}
		if (e.defaultPrevented || isTyping(e) || overlayOpen(e)) return;

		if (mod) {
			// In a text field the browser's own undo runs instead (isTyping above).
			if (!e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && !ui.readOnly) {
				e.preventDefault();
				board.undo();
			}
			// Mod+Backspace / Mod+Delete: only opens the confirmation, never deletes by itself.
			if (!e.altKey && !e.shiftKey && (e.key === 'Backspace' || e.key === 'Delete') && !ui.readOnly && ui.selectedId) {
				e.preventDefault();
				const item = board.byId.get(ui.selectedId);
				if (item) askDelete(item);
			}
			return;
		}
		if (e.altKey) {
			if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey && !ui.readOnly && ui.layout !== 'matrix') {
				if (ui.nav?.shift?.(e.key === 'ArrowRight' ? 1 : -1)) e.preventDefault();
			}
			return;
		}

		// Letters are matched in lower case (Caps Lock); Shift+letter keeps its capital (Shift+H/L).
		const key = e.key.length === 1 && !e.shiftKey ? e.key.toLowerCase() : e.key;

		if (gPending) {
			gPending = false;
			clearTimeout(gTimer);
			const n = Number(key);
			const go = n >= 1 && n <= 9 && views.all[n - 1] ? `/v/${views.all[n - 1].id}` : key === 'e' ? '/epics' : key === 'h' ? '/' : null;
			if (go) {
				e.preventDefault();
				goto(go);
				return;
			}
			// Not a G sequence after all: the key does what it normally does.
		}

		if (key === '?') {
			e.preventDefault();
			ui.shortcutsOpen = true;
			return;
		}
		if (key === '[') {
			e.preventDefault();
			setNavHidden(!navHidden);
			return;
		}
		// The filter bar watches these counters: `/` focuses its search, F opens "add filter".
		if (key === '/') {
			e.preventDefault();
			ui.searchRequest++;
			return;
		}
		if (key === 'f') {
			e.preventDefault();
			ui.filterRequest++;
			return;
		}
		if (key === 'Escape') {
			if (showPanel) ui.close();
			else if (ui.pageBack) ui.pageBack();
			else ui.selectedId = null;
			return;
		}
		if (key === 'g') {
			gPending = true;
			clearTimeout(gTimer);
			gTimer = setTimeout(() => (gPending = false), 1200);
			return;
		}
		if (key === 'c' && !ui.readOnly) {
			e.preventDefault();
			ui.createOpen = { ...ui.createDefaults };
			return;
		}
		if (ui.layout === 'matrix') return; // the matrix walk-through owns j/k/arrows

		// Board: Shift+H / Shift+L move the selected card, like Alt+← / Alt+→.
		if ((key === 'H' || key === 'L') && !ui.readOnly) {
			if (ui.nav?.shift?.(key === 'L' ? 1 : -1)) e.preventDefault();
			return;
		}
		const dirs: Record<string, NavDir> = { j: 'down', ArrowDown: 'down', k: 'up', ArrowUp: 'up' };
		// Sideways only means something on a layout with columns; in a list, L edits labels.
		if (ui.nav) Object.assign(dirs, { h: 'left', ArrowLeft: 'left', l: 'right', ArrowRight: 'right' });
		const dir = e.shiftKey && key.startsWith('Arrow') ? undefined : dirs[key];
		if (dir) {
			e.preventDefault();
			if (ui.nav) ui.nav.move(dir);
			else if (dir === 'down' || dir === 'up') ui.move(dir === 'down' ? 1 : -1);
			return;
		}
		if (!ui.selectedId) return;
		if (key === 'Enter' || key === 'o') {
			// Enter on a button or link is that control's own click (a focused card opens itself).
			if (key === 'Enter' && (e.target as HTMLElement | null)?.closest('button, a, [role="button"]')) return;
			e.preventDefault();
			ui.panelOpen = true;
			return;
		}
		if (ui.readOnly) return;
		if (key === 'i') {
			e.preventDefault();
			const item = board.byId.get(ui.selectedId);
			if (item) assignToMe(item);
			return;
		}
		const edits: Record<string, FieldKey> = {
			s: 'native:status',
			a: 'native:assignees',
			l: 'native:labels',
			w: 'native:weight'
		};
		if (edits[key]) {
			e.preventDefault();
			ui.edit(edits[key]);
		}
	}

	/**
	 * Adds the signed-in user to the item's assignees (I, and the palette's "Assign to me").
	 * Adds rather than replaces: someone already on the issue stays on it.
	 */
	function assignToMe(item: WorkItem) {
		const me = board.reg.currentUserId;
		const f = board.field('native:assignees');
		if (!me || !f?.editable || !appliesTo(f, item.type)) {
			ui.toast("Assignees can't be changed here");
			return;
		}
		const v = item.values['native:assignees'];
		const ids = v?.kind === 'people' ? v.ids : [];
		if (ids.includes(me)) {
			ui.toast(`You're already assigned to ${item.ref}`);
			return;
		}
		board.update(item.id, 'native:assignees', [...ids, me]);
	}

	// ---- Delete ------------------------------------------------------------------------------------
	/** Opens the confirmation. GitLab's permission hint decides whether to offer it at all. */
	function askDelete(item: WorkItem) {
		if (ui.readOnly) return;
		if (!item.canDelete) {
			ui.toast(`GitLab doesn't let you delete ${item.ref}. Usually only project Owners can.`);
			return;
		}
		ui.deleteRequest = item.id;
	}
	const deleteItem = $derived(ui.deleteRequest ? (board.byId.get(ui.deleteRequest) ?? null) : null);
	const deleteWords = $derived(deleteItem ? deleteText(deleteItem, board.items) : null);
	let deleting = $state(false);
	async function confirmDelete() {
		if (!deleteItem || deleting) return;
		deleting = true;
		await board.remove(deleteItem.id);
		deleting = false;
		// Success already closed it (ui.forget); on failure the toast says why and the item stays.
		ui.deleteRequest = null;
	}

	const hasEpicType = $derived(board.reg.types.some((t) => t.name.toLowerCase() === 'epic'));

	// Not for the item whose full page is showing: the page already is its panel.
	const showPanel = $derived(!!selected && ui.panelOpen && selected.id !== ui.pageItemId);

	// ---- ?sidebar=hidden --------------------------------------------------------------------------
	// Only read (see navHiddenByUrl). The side panel isn't in the URL: links go to /issue/<id>.
	let urlReady = $state(false);

	afterNavigate((nav) => {
		if (!nav.to) return;
		// From a link it isn't saved: opening a link doesn't change your own preference.
		if (readSidebarParam(nav.to.url.searchParams)) navHidden = navHiddenByUrl = true;
		else if (nav.type === 'enter') navHidden = storedNavHidden();
		urlReady = true;
	});

	// Keeps ?sidebar=hidden in the address bar while it's what hides the sidebar, so in-app
	// navigation (and kiosk rotation) followed by a reload stays full-width.
	$effect(() => {
		// page.url only to re-run after navigations; shallow replaceState leaves it as it was, so
		// the address bar is what we compare with.
		void page.url;
		const keep = navHiddenByUrl && navHidden;
		if (!urlReady) return;
		const next = withSidebarParam(new URL(location.href), keep);
		if (next) untrack(() => replaceState(next, page.state));
	});

	// ---- Command palette ----------------------------------------------------------------------------
	const epicPath = (id: string) => `/epics/${encodeURIComponent(id.slice(id.lastIndexOf('/') + 1))}`;
	const commands = $derived.by((): Command[] => {
		if (!ui.paletteOpen) return [];
		const out: Command[] = [];
		if (!ui.readOnly)
			out.push({ id: 'act:new', group: 'Actions', label: 'New issue', hint: 'C', run: () => (ui.createOpen = { ...ui.createDefaults }) });
		if (!ui.readOnly && hasEpicType)
			out.push({ id: 'act:new-epic', group: 'Actions', label: 'New epic', run: () => (ui.createOpen = { ...ui.createDefaults, type: 'Epic' }) });
		if (!ui.readOnly)
			out.push({ id: 'act:undo', group: 'Actions', label: 'Undo the last change', hint: isMac ? '⌘ Z' : 'Ctrl Z', run: () => board.undo() });
		out.push(
			{ id: 'act:shortcuts', group: 'Actions', label: 'Keyboard shortcuts', hint: '?', keywords: 'keys help hotkeys', run: () => (ui.shortcutsOpen = true) },
			{ id: 'act:refresh', group: 'Actions', label: 'Refresh from GitLab', run: refresh },
			{ id: 'act:theme', group: 'Actions', label: 'Switch theme (auto / dark / light)', run: cycleTheme },
			{ id: 'go:epics', group: 'Actions', label: 'Go to epics', hint: 'G E', run: () => goto('/epics') }
		);
		// Field actions on the selected item: status, every single-select field, assignees, parent.
		const sel = ui.selectedId ? board.byId.get(ui.selectedId) : null;
		if (sel && !ui.readOnly) {
			const short = sel.ref.replace(/^.*\//, '');
			for (const f of board.reg.fields) {
				if (!f.editable || !appliesTo(f, sel.type)) continue;
				if (f.kind === 'status' || (f.kind === 'singleSelect' && f.options?.length)) {
					for (const o of f.options ?? [])
						out.push({ id: `set:${f.key}:${o.id}`, group: `Selected: ${short}`, label: `Set ${f.name}: ${o.label}`, run: () => board.update(sel.id, f.key, o.id) });
				}
			}
			if (board.reg.currentUserId && board.field('native:assignees'))
				out.push({ id: 'assign:me', group: `Selected: ${short}`, label: 'Assign to me', hint: 'I', run: () => assignToMe(sel) });
			out.push(
				{ id: 'assign:none', group: `Selected: ${short}`, label: 'Unassign', run: () => board.update(sel.id, 'native:assignees', []) },
				{ id: 'edit:labels', group: `Selected: ${short}`, label: 'Edit labels…', hint: 'L', run: () => ui.edit('native:labels') },
				{ id: 'edit:parent', group: `Selected: ${short}`, label: 'Set parent epic…', run: () => ui.edit('native:parent') }
			);
			if (sel.parentId)
				out.push({ id: 'parent:none', group: `Selected: ${short}`, label: 'Remove parent', run: () => board.update(sel.id, 'native:parent', null) });
			if (sel.canDelete)
				out.push({
					id: 'delete',
					group: `Selected: ${short}`,
					label: `Delete ${sel.type.toLowerCase() === 'epic' ? 'epic' : 'issue'}…`,
					hint: isMac ? '⌘ ⌫' : 'Ctrl Backspace',
					keywords: 'delete remove destroy trash',
					run: () => askDelete(sel)
				});
		}
		(kioskViews ?? views.all).forEach((v, i) =>
			out.push({ id: `view:${v.id}`, group: 'Views', label: v.name, hint: i < 9 ? `G ${i + 1}` : v.layout, keywords: v.description, run: () => goto(`/v/${v.id}`) })
		);
		for (const t of tools)
			out.push({ id: `tool:${t.id}`, group: 'Prioritization', label: t.name, hint: toolType(t).name, keywords: t.description, run: () => goto(`/p/${t.id}`) });
		for (const p of board.reg.projects)
			out.push({ id: `team:${p.id}`, group: 'Teams', label: p.name, hint: p.fullPath, run: () => goto(`/team/${p.fullPath}`) });
		for (const e of board.items.filter((i) => i.type.toLowerCase() === 'epic'))
			out.push({ id: `epic:${e.id}`, group: 'Epics', label: e.title, hint: e.ref, run: () => goto(epicPath(e.id)) });
		for (const i of board.items) {
			if (i.type.toLowerCase() === 'epic') continue;
			out.push({
				id: `item:${i.id}`,
				group: 'Issues',
				label: i.title,
				hint: `${i.ref}${closedKind(board.reg, i) ? ' · closed' : ''}`,
				keywords: i.type,
				run: () => ui.open(i.id)
			});
		}
		return out;
	});
</script>

<svelte:window onkeydown={onKey} />

<div class="shell" class:with-panel={showPanel && ui.layout !== 'matrix'} class:nav-open={navOpen} class:nav-hidden={navHidden}>
	<div class="nav" inert={navHidden && !navOpen ? true : undefined}>
		<Sidebar
			viewer={data.viewer}
			kioskViews={kioskViews?.map((v) => v.id) ?? null}
			onnavigate={() => (navOpen = false)}
			oncollapse={() => setNavHidden(true)}
		/>
	</div>
	{#if navHidden}
		<button type="button" class="nav-tab" onclick={() => setNavHidden(false)} aria-label="Show sidebar" title="Show sidebar ([)">»</button>
	{/if}
	{#if navOpen}<button class="scrim" aria-label="Close navigation" onclick={() => (navOpen = false)}></button>{/if}

	<main class="main">
		<div class="topline">
			<button type="button" class="btn ghost small menu-btn" aria-label="Open navigation" onclick={() => (navOpen = true)}>☰</button>
			<span class="muted updated">
				{#if offline}<span class="offline" role="status">Board server unreachable, retrying ·</span>{/if}
				{#if board.data.fetchedAt}Updated {ago(board.data.fetchedAt, now)}{/if}
			</span>
			<button class="btn ghost small" onclick={refresh} disabled={refreshing}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
			<button class="btn ghost small" onclick={cycleTheme} title="Theme: {theme}" aria-label="Theme: {theme}">
				{theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
			</button>
		</div>

		{#if board.data.problem?.kind === 'auth'}
			<section class="notice error page-notice">
				<h2>Please sign in again</h2>
				<p>{board.data.problem.message}</p>
				<form method="POST" action="/auth/logout"><button class="btn">Sign in again</button></form>
			</section>
		{:else if board.data.problem?.kind === 'config'}
			<section class="notice error page-notice">
				<h2>Setup needed</h2>
				<p>{board.data.problem.message}</p>
				<p class="muted">After editing <code>.env</code>, restart the server.</p>
			</section>
		{:else if board.data.problem && board.data.stale}
			<section class="notice warn page-notice" role="status">
				Couldn't reach GitLab ({board.data.problem.status || 'network'}): {board.data.problem.message} Showing the last data we got.
			</section>
		{:else if board.data.problem}
			<section class="notice error page-notice">
				<h2>Couldn't load issues</h2>
				<p>
					{#if board.data.problem.status}<code>HTTP {board.data.problem.status}</code>{/if}
					{board.data.problem.message}
				</p>
				<button class="btn" onclick={refresh}>Try again</button>
			</section>
		{/if}

		{#if !board.data.problem || board.data.stale}
			{@render children()}
		{/if}
	</main>

	{#if showPanel && selected}
		<aside class="detail" class:overlay={ui.layout === 'matrix'} aria-label="Issue details">
			<ItemPanel item={selected} onclose={() => ui.close()} />
		</aside>
	{/if}

	{#if ui.createOpen}
		<CreateDialog prefill={ui.createOpen} onclose={() => (ui.createOpen = null)} />
	{/if}

	{#if ui.paletteOpen}
		<CommandPalette {commands} onclose={() => (ui.paletteOpen = false)} />
	{/if}

	{#if ui.shortcutsOpen}
		<ShortcutSheet readOnly={ui.readOnly} onclose={() => (ui.shortcutsOpen = false)} />
	{/if}

	{#if deleteItem && deleteWords && !ui.readOnly}
		<ConfirmDialog
			heading={deleteWords.heading}
			message={deleteWords.message}
			note={deleteWords.note}
			confirmLabel={deleteWords.confirmLabel}
			busyLabel="Deleting…"
			busy={deleting}
			onconfirm={confirmDelete}
			oncancel={() => (ui.deleteRequest = null)}
		/>
	{/if}

	<div class="toasts" role="status" aria-live="polite">
		{#each ui.toasts as t (t.id)}
			<div class="toast" class:error={t.kind === 'error'}>
				<span>{t.text}</span>
				<button type="button" aria-label="Dismiss" onclick={() => ui.dismiss(t.id)}>×</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.shell {
		display: grid;
		grid-template-columns: 236px minmax(0, 1fr);
		height: 100vh;
		overflow: hidden;
	}
	.shell.with-panel {
		grid-template-columns: 236px minmax(0, 1fr) minmax(360px, 30vw);
	}
	/* Sidebar hidden: the content takes the full width */
	.shell.nav-hidden {
		grid-template-columns: 0 minmax(0, 1fr);
	}
	.shell.nav-hidden.with-panel {
		grid-template-columns: 0 minmax(0, 1fr) minmax(360px, 30vw);
	}
	.nav-hidden .nav {
		visibility: hidden;
		overflow: hidden;
	}
	/* Small tab on the left edge to bring the sidebar back; floats, takes no layout space */
	.nav-tab {
		position: fixed;
		top: 10px;
		left: 0;
		z-index: 20;
		width: 20px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--border);
		border-left: 0;
		border-radius: 0 6px 6px 0;
		background: var(--surface-1);
		color: var(--text-muted);
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
	}
	.nav-tab:hover,
	.nav-tab:focus-visible {
		width: 26px;
		color: var(--text-primary);
		background: var(--surface-2);
	}
	.nav {
		min-height: 0;
	}
	.main {
		min-width: 0;
		min-height: 0;
		overflow-y: auto;
		background: var(--surface-0);
	}
	.topline {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 4px;
		padding: 8px 14px 0;
	}
	.updated {
		font-size: 12px;
		margin-right: 4px;
	}
	.offline {
		color: var(--danger);
	}
	.menu-btn {
		display: none;
		margin-right: auto;
	}
	.page-notice {
		margin: 12px 20px;
	}
	.page-notice h2 {
		margin: 0 0 6px;
		font-size: 16px;
	}
	.detail {
		min-height: 0;
		overflow-y: auto;
		background: var(--surface-1);
		border-left: 1px solid var(--border);
	}
	.detail.overlay {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		width: min(440px, 100vw);
		z-index: 30;
		box-shadow: var(--shadow-pop);
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 25;
		border: 0;
		background: var(--overlay);
	}
	.toasts {
		position: fixed;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 60;
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: min(520px, 92vw);
		padding: 9px 10px 9px 14px;
		border-radius: 8px;
		background: var(--text-primary);
		color: var(--surface-0);
		font-size: 13.5px;
		box-shadow: var(--shadow-pop);
	}
	.toast.error {
		background: var(--danger);
		color: #fff;
	}
	.toast button {
		border: 0;
		background: none;
		color: inherit;
		font-size: 16px;
		cursor: pointer;
		opacity: 0.8;
	}
	@media (max-width: 1100px) {
		.shell.with-panel {
			grid-template-columns: 236px minmax(0, 1fr);
		}
		.shell.nav-hidden.with-panel {
			grid-template-columns: 0 minmax(0, 1fr);
		}
		.detail {
			position: fixed;
			top: 0;
			right: 0;
			bottom: 0;
			width: min(440px, 100vw);
			z-index: 30;
			box-shadow: var(--shadow-pop);
		}
	}
	@media (max-width: 800px) {
		.shell,
		.shell.with-panel,
		.shell.nav-hidden,
		.shell.nav-hidden.with-panel {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Narrow screens keep the slide-in menu (☰); the desktop hide/show doesn't apply */
		.nav-hidden .nav {
			visibility: visible;
		}
		.nav-tab {
			display: none;
		}
		.nav {
			position: fixed;
			top: 0;
			bottom: 0;
			left: 0;
			width: 260px;
			z-index: 26;
			transform: translateX(-100%);
			transition: transform 160ms ease;
		}
		.nav-open .nav {
			transform: none;
		}
		.menu-btn {
			display: inline-flex;
		}
	}
</style>
