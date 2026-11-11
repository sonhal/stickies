<script lang="ts">
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { epicProgress } from '$lib/query/epics';
	import { slotVar } from '$lib/colors';
	import ViewPage from '$lib/components/ViewPage.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import FieldEditor from '$lib/components/FieldEditor.svelte';

	// /epics/<numeric id>: the epic's description, progress, and its children through any view
	// (default: the "team" list; ?view=<id> picks another, e.g. ?view=active for a board).
	const board = getBoard();
	const ui = getUi();
	const id = $derived(`gid://gitlab/WorkItem/${page.params.id}`);
	const epic = $derived(board.byId.get(id) ?? null);
	const progress = $derived(epic ? epicProgress(epic, board.items, board.reg) : null);
	let expanded = $state(false);
</script>

{#if epic}
	<section class="epic">
		<div class="row">
			<span class="dot" style="background: {slotVar(board.colors.slotFor(epic))}"></span>
			<a class="back" href="/epics">Epics</a>
			<span aria-hidden="true">›</span>
			<span class="ref">{epic.ref}</span>
			{#if epic.url}<a class="btn ghost small" href={epic.url} target="_blank" rel="noopener noreferrer">Open in GitLab ↗</a>{/if}
		</div>
		<h1>{epic.title}</h1>
		<div class="facts">
			{#if progress}<ProgressBar p={progress} wide />{/if}
			<span>Start <FieldEditor key="native:startDate" item={epic} /></span>
			<span>Due <FieldEditor key="native:dueDate" item={epic} /></span>
			{#if !ui.readOnly}<button type="button" class="btn small" onclick={() => (ui.createOpen = { ...ui.createDefaults, parentId: epic.id })}>+ Add issue</button>{/if}
		</div>
		{#if epic.description}
			<p class="desc" class:expanded>{epic.description}</p>
			{#if epic.description.length > 280}<button type="button" class="btn ghost small" onclick={() => (expanded = !expanded)}>{expanded ? 'Less' : 'More'}</button>{/if}
		{/if}
	</section>
	{#key id}
		<ViewPage viewId={page.url.searchParams.get('view') ?? 'team'} scope={{ epics: [id] }} heading="Issues" />
	{/key}
{:else}
	<div class="epic">
		<h1>Epic not found</h1>
		<p class="muted">It may have been closed for longer than the board keeps, or you can't see it.</p>
		<a class="btn" href="/epics">All epics</a>
	</div>
{/if}

<style>
	.epic {
		padding: 14px 20px 6px;
		border-bottom: 1px solid var(--grid);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12.5px;
		color: var(--text-muted);
	}
	.back {
		color: var(--text-secondary);
		text-decoration: none;
	}
	.back:hover {
		text-decoration: underline;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.ref {
		font-family: var(--mono);
		margin-right: auto;
	}
	h1 {
		margin: 6px 0 8px;
		font-size: 21px;
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 22px;
		font-size: 13px;
		color: var(--text-muted);
	}
	.facts > span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.facts :global(.pb) {
		width: 240px;
	}
	.desc {
		margin: 10px 0 4px;
		max-width: 80ch;
		white-space: pre-line;
		font-size: 14px;
		color: var(--text-secondary);
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.desc.expanded {
		display: block;
	}
</style>
