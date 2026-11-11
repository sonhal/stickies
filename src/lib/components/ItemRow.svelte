<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { closedKind, personName } from '$lib/fields/registry';
	import type { FieldDef, WorkItem } from '$lib/fields/types';
	import { slotVar } from '$lib/colors';
	import Avatar from './ui/Avatar.svelte';
	import StatusIcon from './ui/StatusIcon.svelte';
	import ValueChip from './ui/ValueChip.svelte';

	let { item, depth = 0, properties }: { item: WorkItem; depth?: number; properties: FieldDef[] } = $props();
	const board = getBoard();
	const ui = getUi();

	const closed = $derived(closedKind(board.reg, item));
	const assignees = $derived(item.values['native:assignees']);
	const pending = $derived(board.pending.has(item.id));
</script>

<div
	class="row"
	class:selected={ui.selectedId === item.id}
	class:closed={!!closed}
	class:pending
	style="--depth: {depth}"
	data-item={item.id}
	role="row"
	aria-selected={ui.selectedId === item.id}
>
	<button class="hit" type="button" onclick={() => ui.open(item.id)} aria-label="Open {item.ref}: {item.title}"></button>
	<span class="epic" style="background: {slotVar(board.colors.slotFor(item))}" title={board.epicTitle(item)}></span>
	<StatusIcon status={board.status(item)} />
	<span class="ref">{item.ref.replace(/^.*\//, '')}</span>
	<span class="title">{item.title}</span>
	{#if item.type !== 'Issue'}<span class="type">{item.type}</span>{/if}
	<span class="props">
		{#each properties as f (f.key)}
			{#if f.key !== 'native:assignees' && f.key !== 'native:status'}<ValueChip field={f} {item} />{/if}
		{/each}
	</span>
	<span class="who">
		{#if assignees?.kind === 'people' && assignees.ids.length}
			{#each assignees.ids.slice(0, 2) as id (id)}<Avatar {id} name={personName(board.reg, id)} />{/each}
		{:else}
			<span class="nobody" title="Unassigned"></span>
		{/if}
	</span>
</div>

<style>
	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 38px;
		padding: 0 16px 0 calc(16px + var(--depth) * 22px);
		border-bottom: 1px solid var(--grid);
		font-size: 13.5px;
	}
	.row:hover {
		background: var(--hover);
	}
	.row.selected {
		background: var(--selected);
	}
	.row.selected::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--accent);
	}
	.row.pending {
		opacity: 0.7;
	}
	.hit {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
		z-index: 0;
	}
	.hit:focus-visible {
		outline-offset: -2px;
	}
	.epic {
		width: 4px;
		height: 16px;
		border-radius: 2px;
		flex: none;
	}
	.ref {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text-muted);
		flex: none;
		min-width: 44px;
	}
	.title {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text-primary);
	}
	.closed .title {
		color: var(--text-muted);
	}
	.type {
		font-size: 11px;
		color: var(--text-muted);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 4px;
		flex: none;
	}
	/* Chips that don't fit wrap onto a hidden second line, so a chip is never cut in half. */
	.props {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 55%;
		height: 22px;
		overflow: hidden;
		justify-content: flex-end;
	}
	.who {
		display: flex;
		gap: 2px;
		flex: none;
		width: 40px;
		justify-content: flex-end;
	}
	.nobody {
		width: 18px;
		height: 18px;
		border-radius: 50%;
		border: 1.5px dashed var(--border);
	}
	.row > :not(.hit) {
		position: relative;
		z-index: 1;
		pointer-events: none;
	}
	@media (max-width: 720px) {
		.props {
			display: none;
		}
	}
</style>
