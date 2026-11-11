<script lang="ts" module>
	export interface PickOption {
		id: string;
		label: string;
		hint?: string;
		color?: string;
		/** Disabled with a reason, e.g. "Only one area:: label" */
		note?: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		options: PickOption[];
		selected?: string[];
		multi?: boolean;
		placeholder?: string;
		/** Called for each pick; for multi the picker stays open */
		onpick: (id: string) => void;
		icon?: Snippet<[PickOption]>;
		autofocus?: boolean;
	}

	let { options, selected = [], multi = false, placeholder = 'Search…', onpick, icon, autofocus = true }: Props = $props();

	let q = $state('');
	let active = $state(0);
	let input: HTMLInputElement | undefined = $state();
	const listId = `opts-${Math.random().toString(36).slice(2, 8)}`;

	const shown = $derived(
		options.filter((o) => !q.trim() || `${o.label} ${o.hint ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 200)
	);

	$effect(() => {
		if (autofocus) input?.focus();
	});
	$effect(() => {
		void q;
		active = 0;
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = Math.min(shown.length - 1, active + 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = Math.max(0, active - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const o = shown[active];
			if (o) onpick(o.id);
		}
	}
</script>

<div class="picker">
	<input
		bind:this={input}
		class="input search"
		type="text"
		bind:value={q}
		{placeholder}
		aria-label={placeholder}
		role="combobox"
		aria-expanded="true"
		aria-controls={listId}
		aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
		onkeydown={onKey}
	/>
	<div class="menu list" id={listId} role="listbox" aria-multiselectable={multi}>
		{#each shown as o, i (o.id)}
			<button
				type="button"
				id="{listId}-{i}"
				class="menu-item"
				class:active={i === active}
				role="option"
				aria-selected={selected.includes(o.id)}
				onmouseenter={() => (active = i)}
				onclick={() => onpick(o.id)}
			>
				{#if multi}<span class="check" aria-hidden="true">{selected.includes(o.id) ? '✓' : ''}</span>{/if}
				{#if icon}{@render icon(o)}{:else if o.color}<span class="dot" style="background: {o.color}"></span>{/if}
				<span class="label">{o.label}</span>
				{#if o.note}<span class="hint">{o.note}</span>{:else if o.hint}<span class="hint">{o.hint}</span>{/if}
				{#if !multi && selected.includes(o.id)}<span class="hint" aria-hidden="true">✓</span>{/if}
			</button>
		{:else}
			<p class="empty">No matches</p>
		{/each}
	</div>
</div>

<style>
	.picker {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.search {
		width: 100%;
	}
	.list {
		max-height: 300px;
		overflow-y: auto;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.check {
		width: 12px;
		color: var(--accent);
		font-weight: 700;
		flex: none;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
	}
	.empty {
		margin: 6px 8px;
		color: var(--text-muted);
		font-size: 13px;
	}
</style>
