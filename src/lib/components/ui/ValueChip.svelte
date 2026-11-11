<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { optionById, personName } from '$lib/fields/registry';
	import type { FieldDef, WorkItem } from '$lib/fields/types';
	import Avatar from './Avatar.svelte';
	import StatusIcon from './StatusIcon.svelte';

	/** One field value rendered compactly, as text (never HTML). Nothing if the item has no value. */
	let { field, item, showName = false }: { field: FieldDef; item: WorkItem; showName?: boolean } = $props();
	const board = getBoard();
	const v = $derived(item.values[field.key]);
	const text = $derived(board.text(item, field.key));
	const overdue = $derived(
		field.key === 'native:dueDate' && v?.kind === 'date' && v.value.slice(0, 10) < new Date().toISOString().slice(0, 10) && item.state === 'open'
	);
</script>

{#if v && text}
	{#if field.kind === 'people' && v.kind === 'people'}
		<span class="people" title="{field.name}: {text}">
			{#each v.ids.slice(0, 3) as id (id)}<Avatar {id} name={personName(board.reg, id)} size={18} />{/each}
		</span>
	{:else if field.kind === 'status' && v.kind === 'option'}
		{@const s = optionById(field, v.id)}
		<span class="chip" title="{field.name}: {text}"><StatusIcon status={s} size={12} />{text}</span>
	{:else if field.key === 'native:labels' && v.kind === 'options'}
		{#each v.ids.slice(0, 4) as id (id)}
			{@const o = optionById(field, id)}
			<span class="chip" title="Label: {o?.label ?? 'removed'}"
				><span class="dot" style="background: {o?.color ?? 'var(--text-muted)'}"></span>{o?.label ?? '(removed)'}</span
			>
		{/each}
	{:else}
		<span class="chip" class:overdue title="{field.name}: {text}"
			>{#if showName}<span class="name">{field.name}</span>{/if}{text}</span
		>
	{/if}
{/if}

<style>
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		max-width: 180px;
		height: 22px;
		padding: 0 7px;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 12px;
		color: var(--text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex: none;
	}
	.chip.overdue {
		color: var(--danger);
		border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
	}
	.name {
		color: var(--text-muted);
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex: none;
	}
	.people {
		display: inline-flex;
		gap: 2px;
		flex: none;
	}
</style>
