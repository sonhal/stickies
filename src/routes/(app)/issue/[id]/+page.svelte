<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { findItemByParam, issueUrl, itemParam } from '$lib/client/urlState';
	import { closedKind } from '$lib/fields/registry';
	import { slotVar } from '$lib/colors';
	import ItemPanel from '$lib/components/ItemPanel.svelte';
	import Popover from '$lib/components/ui/Popover.svelte';
	import type { WorkItem } from '$lib/fields/types';

	/**
	 * /issue/<id>: an issue's or epic's full page, the link target for "Copy link". Laid out like
	 * Linear's issue view: a breadcrumb bar with a ⋯ menu over title, description and sub-issues,
	 * and a Properties column on the right (which can be hidden). Everything edits in place.
	 */
	const board = getBoard();
	const ui = getUi();

	const item = $derived(findItemByParam(board.items, page.params.id));
	const isEpic = $derived(item?.type.toLowerCase() === 'epic');
	const project = $derived(item?.projectId ? (board.reg.projects.find((p) => p.id === item.projectId) ?? null) : null);
	const closed = $derived(item ? closedKind(board.reg, item) : null);

	/** The Properties column, shown unless hidden; remembered per browser (a convenience only). */
	const PROPS_KEY = 'board-issue-props-hidden';
	let showProps = $state(true);
	$effect(() => {
		try {
			showProps = localStorage.getItem(PROPS_KEY) !== '1';
		} catch {
			/* storage blocked */
		}
	});
	function toggleProps() {
		showProps = !showProps;
		try {
			if (showProps) localStorage.removeItem(PROPS_KEY);
			else localStorage.setItem(PROPS_KEY, '1');
		} catch {
			/* storage blocked: the choice just isn't remembered */
		}
	}

	// Back (button and Esc): to where you came from in the board, or home for a link opened fresh.
	let cameFromBoard = false;
	afterNavigate((nav) => {
		cameFromBoard = !!nav.from;
	});
	function back() {
		if (cameFromBoard) history.back();
		else goto('/');
	}

	// The page is this item's panel: shortcuts (s, a, l, w, i, ⌘⌫) act on it, the side panel
	// stays closed for it, and Esc goes back.
	$effect(() => {
		const id = item?.id ?? null;
		untrack(() => {
			ui.pageItemId = id;
			if (!id || !item) return;
			ui.selectedId = id;
			ui.navOrder = [];
			ui.layout = 'list';
			ui.createDefaults = { projectId: isEpic ? undefined : (item.projectId ?? undefined) };
		});
	});
	$effect(() => {
		ui.pageBack = back;
		return () => {
			ui.pageBack = null;
			ui.pageItemId = null;
			// Shortcuts here (s, a, l, w) mark the side panel open for this item, hidden while the page
			// shows it. Leaving shouldn't pop that panel, with an editor, up on the next page.
			ui.panelOpen = false;
			ui.editRequest = null;
		};
	});

	// Deleted from this page: there's nothing left to show, so go back.
	let seen: string | null = null;
	$effect(() => {
		if (item) seen = item.id;
		else if (seen && seen === `gid://gitlab/WorkItem/${page.params.id}`) {
			seen = null;
			untrack(back);
		}
	});
</script>

<svelte:head>
	<title>{item ? `${item.ref.replace(/^.*\//, '')} ${item.title}` : 'Issue not found'} · Board</title>
</svelte:head>

{#snippet bar(i: WorkItem)}
	<button type="button" class="btn ghost small" onclick={back} title="Back (Esc)" aria-label="Back">←</button>
	<nav class="where" aria-label="Breadcrumb">
		<span class="dot" style="background: {slotVar(board.colors.slotFor(i))}"></span>
		{#if isEpic}
			<a href="/epics">Epics</a>
		{:else if project}
			<a href="/team/{project.fullPath}">{project.name}</a>
		{/if}
		<span aria-hidden="true">›</span>
		<span class="ref">{i.ref.replace(/^.*\//, '')}</span>
	</nav>
	{#if closed}<span class="chip closed">{closed === 'done' ? 'Completed' : 'Canceled'}</span>{/if}
	<Popover label="{i.type} actions" triggerClass="btn ghost small" triggerTitle="More actions" width="220px">
		{#snippet trigger()}<span aria-label="More actions">•••</span>{/snippet}
		{#snippet children(close)}
			<div class="menu">
				{#if i.url}
					<a class="menu-item" href={i.url} target="_blank" rel="noopener noreferrer" onclick={close}>Open in GitLab ↗</a>
				{/if}
				{#if isEpic}
					<a class="menu-item" href="/epics/{encodeURIComponent(itemParam(i.id))}" onclick={close}>Issues in a view</a>
				{/if}
				<button type="button" class="menu-item" onclick={() => (close(), ui.copy(issueUrl(i.id, new URL(location.href)), `Link to ${i.ref} copied`))}>Copy link</button>
				<button type="button" class="menu-item" onclick={() => (close(), ui.copy(i.ref, `Copied ${i.ref}`))}>Copy ID</button>
				{#if !ui.readOnly && i.canDelete}
					<button type="button" class="menu-item danger" onclick={() => (close(), (ui.deleteRequest = i.id))}>Delete {isEpic ? 'epic' : 'issue'}…</button>
				{/if}
			</div>
		{/snippet}
	</Popover>
	<span class="spacer"></span>
	<button
		type="button"
		class="btn ghost small"
		class:on={showProps}
		onclick={toggleProps}
		aria-pressed={showProps}
		aria-label={showProps ? 'Hide properties' : 'Show properties'}
		title={showProps ? 'Hide properties' : 'Show properties'}
	>
		<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4"
			><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M10 3v10" /></svg
		>
	</button>
{/snippet}

{#if item}
	<div class="issue-page">
		{#key item.id}
			<ItemPanel {item} page {bar} {showProps} />
		{/key}
	</div>
{:else}
	<div class="missing">
		<h1>Issue not found</h1>
		<p class="muted">
			There's no item <code>{page.params.id}</code> on the board. It may have been deleted, closed more than
			{board.data.closedDaysMax} days ago, or you may not have access to it in GitLab.
		</p>
		<a class="btn" href="/">Go to the board</a>
	</div>
{/if}

<style>
	.issue-page {
		display: flex;
		flex-direction: column;
		min-height: calc(100vh - 36px);
	}
	.where {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		font-size: 13px;
		color: var(--text-muted);
	}
	.where > * {
		flex: none;
	}
	.where a {
		color: var(--text-secondary);
		text-decoration: none;
	}
	.where a:hover {
		text-decoration: underline;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
	}
	.ref {
		font-family: var(--mono);
		color: var(--text-primary);
	}
	.chip {
		font-size: 11.5px;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
		white-space: nowrap;
	}
	.chip.closed {
		color: var(--ok);
	}
	.spacer {
		flex: 1;
	}
	.on {
		color: var(--text-primary);
	}
	.danger {
		color: var(--danger);
	}
	a.menu-item {
		color: inherit;
		text-decoration: none;
	}
	.missing {
		padding: 24px;
	}
</style>
