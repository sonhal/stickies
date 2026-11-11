<script lang="ts">
	import type { OptionDef } from '$lib/fields/types';

	/** A Linear-like status glyph drawn from the status *category*, tinted with GitLab's color. */
	let { status, size = 14 }: { status: OptionDef | null; size?: number } = $props();
	const cat = $derived(status?.category ?? (status ? 'toDo' : null));
	const color = $derived(status?.color ?? 'var(--text-muted)');
</script>

<svg
	class="status-icon"
	width={size}
	height={size}
	viewBox="0 0 14 14"
	role="img"
	aria-label={status?.label ?? 'No status'}
	style="color: {color}"
>
	{#if !cat}
		<circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="2 2" />
	{:else if cat === 'triage'}
		<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="1.5 1.8" />
	{:else if cat === 'toDo'}
		<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" />
	{:else if cat === 'inProgress'}
		<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5" />
		<path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill="currentColor" />
	{:else if cat === 'done'}
		<circle cx="7" cy="7" r="6" fill="currentColor" />
		<path d="M4.3 7.2 6.2 9 9.8 5.2" fill="none" stroke="var(--surface-2)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
	{:else}
		<circle cx="7" cy="7" r="6" fill="currentColor" />
		<path d="M5 5 9 9 M9 5 5 9" fill="none" stroke="var(--surface-2)" stroke-width="1.6" stroke-linecap="round" />
	{/if}
</svg>

<style>
	.status-icon {
		flex: none;
		display: block;
	}
</style>
