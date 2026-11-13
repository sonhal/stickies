<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { findItemByParam, itemParam } from '$lib/client/urlState';
	import { closedKind } from '$lib/fields/registry';
	import { slotVar } from '$lib/colors';
	import ItemPanel from '$lib/components/ItemPanel.svelte';

	/**
	 * /issue/<id>: an issue's or epic's full page, the link target for "Copy link". Laid out like
	 * Linear's issue view: a bar with where it lives, then title, description and sub-issues, with
	 * the properties on the right. Everything edits in place, as in the side panel.
	 */
	const board = getBoard();
	const ui = getUi();

	const item = $derived(findItemByParam(board.items, page.params.id));
	const isEpic = $derived(item?.type.toLowerCase() === 'epic');
	const project = $derived(item?.projectId ? (board.reg.projects.find((p) => p.id === item.projectId) ?? null) : null);
	const closed = $derived(item ? closedKind(board.reg, item) : null);

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

{#if item}
	<div class="issue-page">
		<header class="bar">
			<button type="button" class="btn ghost small" onclick={back} title="Back (Esc)" aria-label="Back">←</button>
			<nav class="where" aria-label="Breadcrumb">
				<span class="dot" style="background: {slotVar(board.colors.slotFor(item))}"></span>
				{#if isEpic}
					<a href="/epics">Epics</a>
				{:else if project}
					<a href="/team/{project.fullPath}">{project.name}</a>
				{/if}
				<span aria-hidden="true">›</span>
				<span class="ref">{item.ref.replace(/^.*\//, '')}</span>
			</nav>
			<span class="chip">{item.type}</span>
			{#if closed}<span class="chip closed">{closed === 'done' ? 'Completed' : 'Canceled'}</span>{/if}
			<span class="spacer"></span>
			{#if isEpic}
				<a class="btn ghost small" href="/epics/{encodeURIComponent(itemParam(item.id))}" title="This epic's issues as a list or board">Issues in a view</a>
			{/if}
			{#if item.url}
				<a class="btn ghost small" href={item.url} target="_blank" rel="noopener noreferrer">Open in GitLab ↗</a>
			{/if}
		</header>
		{#key item.id}
			<ItemPanel {item} page />
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
		min-height: calc(100vh - 40px);
	}
	.bar {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 8px;
		padding: 6px 14px 8px;
		border-bottom: 1px solid var(--grid);
		font-size: 13px;
		min-width: 0;
	}
	.where {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 0 1 auto;
		color: var(--text-muted);
	}
	.where > * {
		flex: none;
	}
	.where a {
		color: var(--text-secondary);
		text-decoration: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.where a:hover {
		text-decoration: underline;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
	.ref {
		font-family: var(--mono);
		color: var(--text-primary);
		white-space: nowrap;
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
	.missing {
		padding: 24px;
	}
</style>
