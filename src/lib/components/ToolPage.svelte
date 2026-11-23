<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getTools } from '$lib/client/tools-context';
	import { getUi } from '$lib/client/ui.svelte';
	import { FILTER_PARAM, decodeFilter, encodeFilter } from '$lib/client/share';
	import { STATUS_PARAM, readStatusParam, withStatusSelection } from '$lib/client/statusParam';
	import { toolType, toView } from '$lib/prioritization/tools';
	import type { FilterGroup } from '$lib/query/types';
	import type { WorkItem } from '$lib/fields/types';
	import Workspace from './Workspace.svelte';

	/**
	 * A prioritization tool instance (src/lib/prioritization.config.ts), drawn by its type's renderer.
	 * The filter bar works as on views, and the filter lives in the URL, so reload, back/forward and
	 * links keep it:
	 *  - `?f=`: the whole filter, compressed like a view's `?v=` (written by the filter bar)
	 *  - `?status=`: a hand-written shorthand for its Status rules, applied on top ($lib/client/statusParam)
	 * Neither param: the filter from the config. The instance itself is config only.
	 */
	let { toolId }: { toolId: string } = $props();
	const tools = getTools();
	const ui = getUi();

	const instance = $derived(tools.list.find((t) => t.id === toolId) ?? null);
	const base = $derived(instance ? toView(instance) : null);
	const rawFilter = $derived(page.url.searchParams.get(FILTER_PARAM));
	const urlFilter = $derived(decodeFilter(rawFilter));
	const statusParam = $derived(readStatusParam(page.url.searchParams));
	const filter = $derived.by(() => {
		if (!base) return null;
		const f = urlFilter ?? base.filter;
		return statusParam ? withStatusSelection(f, statusParam) : f;
	});
	const view = $derived(base && filter ? { ...base, filter } : null);
	const customized = $derived(rawFilter !== null || statusParam !== null);

	/** Sets or removes params, keeping the others (?cycle, ?sidebar) as they are. */
	function writeParams(set: Record<string, string | null>) {
		const url = new URL(location.href);
		for (const [k, v] of Object.entries(set)) {
			if (v === null) url.searchParams.delete(k);
			else url.searchParams.set(k, v);
		}
		const next = url.pathname + url.search + url.hash;
		if (next === location.pathname + location.search + location.hash) return;
		goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	/** A filter bar edit: the whole filter goes into ?f= (none when it's the config's again). */
	function change(next: FilterGroup) {
		const same = base && JSON.stringify(next) === JSON.stringify(base.filter);
		writeParams({ [FILTER_PARAM]: same ? null : encodeFilter(next), [STATUS_PARAM]: null });
	}

	function reset() {
		writeParams({ [FILTER_PARAM]: null, [STATUS_PARAM]: null });
	}
</script>

<svelte:head>
	<title>{instance?.name ?? 'Prioritization'} · Board</title>
</svelte:head>

{#snippet actions()}
	{#if customized}
		<button type="button" class="btn ghost" onclick={reset} title="Back to the filter from the config">Reset filter</button>
	{/if}
{/snippet}

{#snippet details(item: WorkItem)}
	<div class="quick">
		<button type="button" class="btn small" onclick={() => ui.open(item.id)}>All fields</button>
	</div>
{/snippet}

{#if instance && view}
	{@const type = toolType(instance)}
	{#if rawFilter !== null && !urlFilter}
		<p class="notice warn link-problem" role="status">The filter in this link couldn't be read. Showing the board's own filter.</p>
	{/if}
	{#if type.renderer === 'quadrants'}
		<Workspace
			{view}
			heading={instance.name}
			subheading={type.name}
			{actions}
			matrixDetails={details}
			showDisplay={false}
			onchange={(next) => change(next.filter)}
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
	.link-problem {
		margin: 10px 20px 0;
	}
	.quick {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: -4px 0 12px;
	}
</style>
