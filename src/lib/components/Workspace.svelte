<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { encodeView } from '$lib/client/share';
	import { runView, type ItemGroup } from '$lib/query/engine';
	import { impliedValues, withFilter } from '$lib/query/edit';
	import type { ViewDefinition, ViewScope } from '$lib/query/types';
	import { resolveField } from '$lib/fields/registry';
	import type { FieldDef, FieldKey } from '$lib/fields/types';
	import FilterBar from './FilterBar.svelte';
	import DisplayMenu from './DisplayMenu.svelte';
	import ListLayout from './layouts/ListLayout.svelte';
	import BoardLayout from './layouts/BoardLayout.svelte';
	import MatrixLayout from './layouts/MatrixLayout.svelte';

	interface Props {
		/** The view as shown (base view, or the unsaved draft from ?v=) */
		view: ViewDefinition;
		/** Extra scope from the route (team page, epic page) */
		scope?: ViewScope;
		heading: string;
		subheading?: string;
		/** True when the URL holds unsaved changes */
		dirty?: boolean;
		/** View actions (save, duplicate, share…) */
		actions?: Snippet;
		/** Editors for the matrix walk panel */
		matrixDetails?: Snippet<[import('$lib/fields/types').WorkItem]>;
	}

	let { view, scope, heading, subheading, dirty = false, actions, matrixDetails }: Props = $props();
	const board = getBoard();
	const ui = getUi();

	let search = $state('');
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60_000);
		return () => clearInterval(t);
	});

	const effective = $derived<ViewDefinition>(
		scope ? { ...view, scope: { ...view.scope, ...scope } } : view
	);
	const ctx = $derived({ rank: board.rankContext(effective), now, closedDaysMax: board.data.closedDaysMax });
	/** On a board, status and select columns are always shown (even empty), so cards can be dropped there. */
	const runDef = $derived.by(() => {
		if (effective.layout !== 'board') return effective;
		const f = effective.groupBy ? resolveField(board.reg, effective.groupBy) : null;
		const force = f?.kind === 'status' || f?.kind === 'singleSelect';
		return force ? { ...effective, display: { ...effective.display, showEmptyGroups: true } } : effective;
	});
	const result = $derived(runView(board.items, runDef, ctx, { search, byId: board.byId }));
	const properties = $derived(
		effective.display.properties.map((p) => resolveField(board.reg, p)).filter((f): f is FieldDef => !!f)
	);
	const missingProps = $derived(effective.display.properties.filter((p) => !resolveField(board.reg, p)).length);

	$effect(() => {
		ui.layout = effective.layout;
	});

	// Prefill for "create issue" (c) from the view's filters and scope, like Linear.
	$effect(() => {
		const values = impliedValues(effective, board.reg);
		ui.createDefaults = {
			projectId: effective.scope?.projects?.length === 1 ? effective.scope.projects[0] : undefined,
			parentId: effective.scope?.epics?.length === 1 ? effective.scope.epics[0] : values['native:parent'],
			values
		};
	});

	/** Every change to the view goes into the URL (?v=), so reload and back/forward keep it. */
	function change(next: ViewDefinition) {
		const url = new URL(page.url);
		url.searchParams.set('v', encodeView(next));
		goto(url.pathname + url.search, { replaceState: true, keepFocus: true, noScroll: true });
	}

	function createIn(g: ItemGroup) {
		const values: Partial<Record<FieldKey, string>> = { ...(ui.createDefaults.values ?? {}) };
		let parentId = ui.createDefaults.parentId;
		let projectId = ui.createDefaults.projectId;
		if (g.field && g.value) {
			if (g.field.key === 'native:parent' || g.field.key === 'native:epic') parentId = g.value;
			else if (g.field.key === 'native:project') projectId = g.value;
			else values[g.field.key] = g.value;
		}
		ui.createOpen = { ...ui.createDefaults, parentId, projectId, values };
	}
</script>

<div class="ws">
	<header class="head">
		<div class="title">
			<h1>{heading}</h1>
			{#if subheading}<span class="sub">{subheading}</span>{/if}
			{#if dirty}<span class="dirty" title="This view has unsaved changes (kept in the URL)">Edited</span>{/if}
			<span class="count">{result.items.length}</span>
		</div>
		<div class="tools">
			{@render actions?.()}
			<DisplayMenu view={effective} onchange={(v) => change({ ...v, scope: view.scope })} />
		</div>
	</header>

	<div class="bar">
		<FilterBar
			filter={effective.filter}
			reports={result.reports}
			{search}
			readOnly={false}
			onchange={(f) => change(withFilter(view, f))}
			onsearch={(q) => (search = q)}
		/>
	</div>

	{#if result.groupProblem}<p class="notice warn" role="status">{result.groupProblem}. Showing the view without it.</p>{/if}
	{#if missingProps}<p class="notice warn" role="status">{missingProps} display propert{missingProps === 1 ? 'y refers to a field' : 'ies refer to fields'} that no longer exist.</p>{/if}
	{#each board.reg.warnings as w (w)}<p class="notice warn" role="status">{w}</p>{/each}

	<div class="content">
		{#if effective.layout === 'matrix'}
			<MatrixLayout
				view={effective}
				items={result.items}
				selectedId={ui.selectedId}
				onselect={(id) => (ui.selectedId = id)}
				details={matrixDetails}
			/>
		{:else if effective.layout === 'board'}
			<BoardLayout view={effective} {result} {properties} {ctx} oncreate={createIn} />
		{:else}
			<ListLayout groups={result.groups} {properties} oncreate={createIn} />
		{/if}
	</div>
</div>

<style>
	.ws {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		padding: 12px 20px 8px;
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}
	h1 {
		margin: 0;
		font-size: 17px;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sub {
		font-size: 12.5px;
		color: var(--text-muted);
		font-family: var(--mono);
		white-space: nowrap;
	}
	.count {
		font-size: 13px;
		color: var(--text-muted);
	}
	.dirty {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--warning-bg);
		color: var(--text-secondary);
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.bar {
		padding: 0 20px 10px;
		border-bottom: 1px solid var(--grid);
	}
	.content {
		padding: 14px 20px 32px;
		min-width: 0;
	}
	.notice {
		margin: 10px 20px 0;
	}
</style>
