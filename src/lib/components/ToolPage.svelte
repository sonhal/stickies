<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import { getTools } from '$lib/client/tools-context';
	import { getUi } from '$lib/client/ui.svelte';
	import {
		STATUS_PARAM,
		readStatusParam,
		statusParamFor,
		statusSelectionOf,
		withStatusSelection
	} from '$lib/client/statusParam';
	import { optionById } from '$lib/fields/registry';
	import { toolType, toView } from '$lib/prioritization/tools';
	import type { FilterGroup } from '$lib/query/types';
	import type { WorkItem } from '$lib/fields/types';
	import Workspace from './Workspace.svelte';

	/**
	 * A prioritization tool instance (src/lib/prioritization.config.ts), drawn by its type's renderer.
	 * The filter bar works as on views. Its Status rules live in the URL (`?status=`, see
	 * $lib/client/statusParam.ts), so a board can be linked to or put on a wall screen with any set of
	 * statuses; other filter changes stay on this page (instances are defined in config only).
	 */
	let { toolId }: { toolId: string } = $props();
	const tools = getTools();
	const board = getBoard();
	const ui = getUi();

	const instance = $derived(tools.list.find((t) => t.id === toolId) ?? null);
	const base = $derived(instance ? toView(instance) : null);
	/** The filter as last edited in the filter bar (null: the config's) */
	let edited = $state<FilterGroup | null>(null);
	const statusParam = $derived(readStatusParam(page.url.searchParams));
	const filter = $derived.by(() => {
		if (!base) return null;
		const f = edited ?? base.filter;
		// "Match any": the Status rules are alternatives, which the param can't express. Use as edited.
		if (f.op === 'or') return f;
		return withStatusSelection(f, statusParam ?? statusSelectionOf(base.filter));
	});
	const view = $derived(base && filter ? { ...base, filter } : null);

	/** Status option id → its name, so the URL reads `?status=In review`, not an id. */
	function statusLabel(id: string): string | null {
		const f = board.reg.fields.find((x) => x.key === 'native:status');
		return f ? (optionById(f, id)?.label ?? null) : null;
	}

	/** Writes `?status=` (null: removes it), keeping the other params (cycle, sidebar). */
	function writeStatusParam(value: string | null) {
		const url = new URL(location.href);
		url.searchParams.delete(STATUS_PARAM);
		const rest = url.searchParams.toString();
		// Commas and ! stay readable: ?status=!toDo,!done
		const own = value === null ? '' : `${STATUS_PARAM}=${encodeURIComponent(value).replace(/%2C/gi, ',')}`;
		const qs = [rest, own].filter(Boolean).join('&');
		const next = url.pathname + (qs ? `?${qs}` : '') + url.hash;
		if (next === location.pathname + location.search + location.hash) return;
		goto(next, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function change(next: FilterGroup) {
		edited = next;
		if (!base) return;
		writeStatusParam(next.op === 'or' ? null : statusParamFor(next, base.filter, statusLabel));
	}

	function reset() {
		edited = null;
		writeStatusParam(null);
	}
</script>

<svelte:head>
	<title>{instance?.name ?? 'Prioritization'} · Board</title>
</svelte:head>

{#snippet actions()}
	{#if edited || statusParam}
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
	.quick {
		display: flex;
		gap: 8px;
		align-items: center;
		margin: -4px 0 12px;
	}
</style>
