<script lang="ts">
	import { matchCommands, type Command } from '$lib/client/commands';

	let { commands, onclose }: { commands: Command[]; onclose: () => void } = $props();

	let q = $state('');
	let active = $state(0);
	let input: HTMLInputElement | undefined = $state();
	let listEl: HTMLElement | undefined = $state();
	const shown = $derived(matchCommands(commands, q));
	const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

	$effect(() => {
		input?.focus();
		return () => opener?.focus?.();
	});
	$effect(() => {
		void q;
		active = 0;
	});
	$effect(() => {
		listEl?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
	});

	function run(c: Command | undefined) {
		if (!c) return;
		onclose();
		c.run();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
			e.preventDefault();
			active = Math.min(shown.length - 1, active + 1);
		} else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
			e.preventDefault();
			active = Math.max(0, active - 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			run(shown[active]);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
	<input
		bind:this={input}
		bind:value={q}
		class="q"
		type="text"
		placeholder="Type a command, or search views, teams, epics and issues…"
		role="combobox"
		aria-expanded="true"
		aria-controls="palette-list"
		aria-activedescendant={shown[active] ? `pal-${active}` : undefined}
		onkeydown={onKey}
	/>
	<div class="list" id="palette-list" role="listbox" bind:this={listEl}>
		{#each shown as c, i (c.id)}
			{#if i === 0 || shown[i - 1].group !== c.group}<div class="menu-label">{c.group}</div>{/if}
			<button
				type="button"
				id="pal-{i}"
				data-i={i}
				role="option"
				aria-selected={i === active}
				class="menu-item"
				class:active={i === active}
				onmouseenter={() => (active = i)}
				onclick={() => run(c)}
			>
				<span class="lbl">{c.label}</span>
				{#if c.hint}<span class="hint">{c.hint}</span>{/if}
			</button>
		{:else}
			<p class="empty">No matches</p>
		{/each}
	</div>
	<footer><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to run · <kbd>Esc</kbd> to close</footer>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: var(--overlay);
		z-index: 50;
	}
	.palette {
		position: fixed;
		top: 12vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(640px, calc(100vw - 24px));
		z-index: 51;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.q {
		border: 0;
		border-bottom: 1px solid var(--border);
		background: transparent;
		padding: 16px 18px;
		font-size: 16px;
		outline: none;
	}
	.list {
		max-height: 52vh;
		overflow-y: auto;
		padding: 6px;
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		padding: 14px;
		margin: 0;
		color: var(--text-muted);
	}
	footer {
		padding: 8px 14px;
		border-top: 1px solid var(--grid);
		font-size: 12px;
		color: var(--text-muted);
		display: flex;
		gap: 4px;
		align-items: center;
	}
</style>
