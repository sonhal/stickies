<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { closedKind } from '$lib/fields/registry';
	import { epicProgress, epicSlug, isEpic, childrenOf } from '$lib/query/epics';
	import { slotVar } from '$lib/colors';
	import ProgressBar from '$lib/components/ProgressBar.svelte';

	const board = getBoard();
	let showClosed = $state(false);

	const epics = $derived(
		board.items
			.filter(isEpic)
			.filter((e) => showClosed || !closedKind(board.reg, e))
			.map((e) => {
				const kids = childrenOf(e, board.items);
				return {
					e,
					progress: epicProgress(e, board.items, board.reg),
					open: kids.filter((k) => !closedKind(board.reg, k)).length,
					start: board.text(e, 'native:startDate'),
					due: board.text(e, 'native:dueDate'),
					closed: closedKind(board.reg, e)
				};
			})
			.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.e.title.localeCompare(b.e.title))
	);
	const noEpic = $derived(board.items.filter((i) => !isEpic(i) && !i.parentId && !closedKind(board.reg, i)).length);
</script>

<svelte:head><title>Epics · Board</title></svelte:head>

<div class="page">
	<header>
		<h1>Epics <span class="n">{epics.length}</span></h1>
		<label class="toggle"><input type="checkbox" bind:checked={showClosed} /> Show recently closed</label>
	</header>

	<div class="table" role="table" aria-label="Epics">
		<div class="tr th" role="row">
			<span role="columnheader">Epic</span>
			<span role="columnheader">Progress</span>
			<span role="columnheader">Open on board</span>
			<span role="columnheader">Start</span>
			<span role="columnheader">Due</span>
		</div>
		{#each epics as x (x.e.id)}
			<a class="tr" role="row" href="/epics/{epicSlug(x.e.id)}" class:closed={!!x.closed}>
				<span class="name" role="cell">
					<span class="dot" style="background: {slotVar(board.colors.slotFor(x.e))}"></span>
					<span class="title">{x.e.title}</span>
					<span class="ref">{x.e.ref}</span>
				</span>
				<span role="cell"><ProgressBar p={x.progress} /></span>
				<span role="cell" class="num">{x.open}</span>
				<span role="cell" class="date">{x.start || '—'}</span>
				<span role="cell" class="date">{x.due || '—'}</span>
			</a>
		{:else}
			<p class="empty">No epics on this board.</p>
		{/each}
	</div>
	<p class="muted foot">
		{noEpic} open item{noEpic === 1 ? ' has' : 's have'} no epic. See <a href="/v/epics">Open issues by epic</a>.
		Progress uses GitLab's rolled-up counts (all child items) when available.
	</p>
</div>

<style>
	.page {
		padding: 16px 20px 32px;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 16px;
		margin-bottom: 12px;
	}
	h1 {
		margin: 0;
		font-size: 17px;
	}
	.n {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 14px;
	}
	.toggle {
		font-size: 13px;
		color: var(--text-secondary);
		display: inline-flex;
		gap: 6px;
		align-items: center;
	}
	.table {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.tr {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 200px 110px 100px 100px;
		gap: 16px;
		align-items: center;
		padding: 0 16px;
		min-height: 44px;
		border-bottom: 1px solid var(--grid);
		color: var(--text-primary);
		text-decoration: none;
		font-size: 13.5px;
	}
	a.tr:hover {
		background: var(--hover);
	}
	.tr.closed .title {
		color: var(--text-muted);
	}
	.th {
		min-height: 34px;
		font-size: 12px;
		color: var(--text-muted);
		font-weight: 600;
		background: color-mix(in srgb, var(--surface-0) 60%, var(--surface-1));
	}
	.name {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.title {
		font-weight: 550;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ref {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.num,
	.date {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.empty {
		padding: 24px;
		margin: 0;
		color: var(--text-muted);
	}
	.foot {
		font-size: 12.5px;
		margin-top: 10px;
	}
	@media (max-width: 860px) {
		.tr {
			grid-template-columns: minmax(0, 1fr) 140px;
		}
		.tr > :nth-child(n + 3) {
			display: none;
		}
	}
</style>
