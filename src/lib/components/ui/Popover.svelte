<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		/** Accessible name for the popup */
		label: string;
		trigger: Snippet;
		children: Snippet<[() => void]>;
		triggerClass?: string;
		triggerTitle?: string;
		align?: 'left' | 'right';
		disabled?: boolean;
		width?: string;
	}

	let {
		open = $bindable(false),
		label,
		trigger,
		children,
		triggerClass = 'btn',
		triggerTitle,
		align = 'left',
		disabled = false,
		width = '280px'
	}: Props = $props();

	let root: HTMLElement | undefined = $state();
	let button: HTMLButtonElement | undefined = $state();

	const close = () => {
		open = false;
		button?.focus();
	};

	function onWindowPointer(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointer} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="pop" bind:this={root} onkeydown={onKey}>
	<button
		bind:this={button}
		type="button"
		class={triggerClass}
		title={triggerTitle}
		aria-haspopup="dialog"
		aria-expanded={open}
		{disabled}
		onclick={() => (open = !open)}>{@render trigger()}</button
	>
	{#if open}
		<div class="panel" class:right={align === 'right'} role="dialog" aria-label={label} style="width: {width}">
			{@render children(close)}
		</div>
	{/if}
</div>

<style>
	.pop {
		position: relative;
		display: inline-block;
		min-width: 0;
		max-width: 100%;
	}
	.panel {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 40;
		max-width: calc(100vw - 24px);
		max-height: min(70vh, 560px);
		overflow: auto;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 10px;
		box-shadow: var(--shadow-pop);
		padding: 6px;
	}
	.panel.right {
		left: auto;
		right: 0;
	}
</style>
