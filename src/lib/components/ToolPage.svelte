<script lang="ts">
	import { getTools } from '$lib/client/tools-context';
	import { getUi } from '$lib/client/ui.svelte';
	import { toolType, toView } from '$lib/prioritization/tools';
	import type { FilterGroup } from '$lib/query/types';
	import type { WorkItem } from '$lib/fields/types';
	import Workspace from './Workspace.svelte';

	/**
	 * A prioritization tool instance (src/lib/prioritization.config.ts), drawn by its type's renderer.
	 * The filter bar works as on views, but changes stay on this page (they aren't saved or put in
	 * the URL): instances are defined in config only.
	 */
	let { toolId }: { toolId: string } = $props();
	const tools = getTools();
	const ui = getUi();

	const instance = $derived(tools.list.find((t) => t.id === toolId) ?? null);
	let filter = $state<FilterGroup | null>(null);
	const view = $derived.by(() => {
		if (!instance) return null;
		const base = toView(instance);
		return filter ? { ...base, filter } : base;
	});
</script>

<svelte:head>
	<title>{instance?.name ?? 'Prioritization'} · Board</title>
</svelte:head>

{#snippet actions()}
	{#if filter}
		<button type="button" class="btn ghost" onclick={() => (filter = null)} title="Back to the filter from the config">Reset filter</button>
	{/if}
{/snippet}

{#snippet details(item: WorkItem)}
	<div class="quick">
		<button type="button" class="btn small" onclick={() => ui.open(item.id)}>All fields</button>
	</div>
{/snippet}

{#if instance && view}
	{@const type = toolType(instance)}
	{#if type.renderer === 'quadrants'}
		<Workspace
			{view}
			heading={instance.name}
			subheading={type.name}
			{actions}
			matrixDetails={details}
			showDisplay={false}
			onchange={(next) => (filter = next.filter)}
		/>
	{/if}
{:else}
	<div class="pad">
		<h1>Not found</h1>
		<p class="muted">There's no prioritization tool called “{toolId}”. Tools are defined in <code>prioritization.config.ts</code>.</p>
		<a class="btn" href="/">Go to the first view</a>
	</div>
{/if}

<style>
	.pad {
		padding: 24px;
	}
	.quick {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: -4px 0 12px;
	}
</style>
