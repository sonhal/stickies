<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import type { ItemGroup } from '$lib/query/engine';
	import type { FieldDef } from '$lib/fields/types';
	import { optionById } from '$lib/fields/registry';
	import ItemRow from '../ItemRow.svelte';
	import StatusIcon from '../ui/StatusIcon.svelte';
	import Avatar from '../ui/Avatar.svelte';

	let { groups, properties, oncreate }: { groups: ItemGroup[]; properties: FieldDef[]; oncreate?: (g: ItemGroup) => void } = $props();
	const board = getBoard();
	const ui = getUi();
	const collapsed = new SvelteSet<string>();

	$effect(() => {
		const ids: string[] = [];
		for (const g of groups) {
			if (collapsed.has(g.key)) continue;
			for (const s of g.sub ?? [g]) for (const r of s.rows) ids.push(r.item.id);
		}
		ui.navOrder = ids;
	});

	// Keep the keyboard selection in view.
	$effect(() => {
		const id = ui.selectedId;
		if (!id) return;
		document.querySelector(`.list [data-item="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	const single = $derived(groups.length === 1 && groups[0].key === 'all');
</script>

{#snippet header(g: ItemGroup, level: number)}
	{@const statusOpt = g.field?.kind === 'status' && g.value ? optionById(g.field, g.value) : null}
	<div class="ghead" class:sub={level > 0}>
		{#if level === 0}
			<button type="button" class="tw" aria-expanded={!collapsed.has(g.key)} aria-label="{collapsed.has(g.key) ? 'Expand' : 'Collapse'} {g.label}" onclick={() => (collapsed.has(g.key) ? collapsed.delete(g.key) : collapsed.add(g.key))}>
				<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" class:closed={collapsed.has(g.key)}><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" /></svg>
			</button>
		{/if}
		{#if statusOpt}<StatusIcon status={statusOpt} />
		{:else if g.field?.kind === 'people' && g.value}<Avatar id={g.value} name={g.label} size={16} />
		{:else if g.option?.color}<span class="dot" style="background: {g.option.color}"></span>{/if}
		<span class="glabel">{g.label}</span>
		<span class="count">{g.items.length}</span>
		{#if oncreate && level === 0 && !ui.readOnly}
			<button type="button" class="add" title="Create an issue in {g.label}" aria-label="Create an issue in {g.label}" onclick={() => oncreate(g)}>+</button>
		{/if}
	</div>
{/snippet}

<div class="list" role="grid" aria-label="Issues">
	{#each groups as g (g.key)}
		<section class="group" aria-label={g.label}>
			{#if !single}{@render header(g, 0)}{/if}
			{#if !collapsed.has(g.key)}
				{#if g.sub}
					{#each g.sub as s (s.key)}
						{@render header(s, 1)}
						{#each s.rows as r (r.item.id)}<ItemRow item={r.item} depth={r.depth} {properties} />{/each}
					{/each}
				{:else}
					{#each g.rows as r (r.item.id)}<ItemRow item={r.item} depth={r.depth} {properties} />{/each}
				{/if}
				{#if g.items.length === 0}<p class="empty">No issues</p>{/if}
			{/if}
		</section>
	{:else}
		<p class="empty big">No issues match this view.</p>
	{/each}
</div>

<style>
	.list {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.ghead {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		padding: 0 12px 0 8px;
		background: color-mix(in srgb, var(--surface-0) 70%, var(--surface-1));
		border-bottom: 1px solid var(--grid);
		font-size: 13px;
		font-weight: 600;
	}
	.ghead.sub {
		position: static;
		height: 30px;
		padding-left: 34px;
		background: var(--surface-1);
		font-weight: 500;
		color: var(--text-secondary);
	}
	.tw {
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border: 0;
		background: transparent;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
	}
	.tw:hover {
		background: var(--hover);
	}
	.tw svg.closed {
		transform: rotate(-90deg);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.count {
		color: var(--text-muted);
		font-weight: 500;
	}
	.add {
		margin-left: auto;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
		font-size: 16px;
		cursor: pointer;
	}
	.add:hover {
		background: var(--hover);
		color: var(--text-primary);
	}
	.empty {
		margin: 0;
		padding: 10px 40px;
		font-size: 13px;
		color: var(--text-muted);
		border-bottom: 1px solid var(--grid);
	}
	.empty.big {
		padding: 40px;
		text-align: center;
	}
</style>
