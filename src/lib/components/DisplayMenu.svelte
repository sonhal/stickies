<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { resolveField } from '$lib/fields/registry';
	import { canBeAxis, canBeColumns, canGroupBy, canSortBy, menuFields, refOf } from '$lib/query/edit';
	import type { AxisConfig, CompletedWindow, FieldRef, Layout, SubIssues, ViewDefinition } from '$lib/query/types';
	import Popover from './ui/Popover.svelte';

	let { view, onchange }: { view: ViewDefinition; onchange: (v: ViewDefinition) => void } = $props();
	const board = getBoard();

	const keyOf = (ref: FieldRef | null | undefined) => (ref ? (resolveField(board.reg, ref)?.key ?? '__missing') : '');
	const refFor = (key: string): FieldRef | null => {
		const f = board.reg.fields.find((x) => x.key === key);
		return f ? refOf(f) : null;
	};

	const groupFields = $derived(menuFields(board.reg, view.layout === 'board' ? canBeColumns : canGroupBy));
	const sortFields = $derived(menuFields(board.reg, canSortBy));
	const axisFields = $derived(menuFields(board.reg, canBeAxis));
	const propFields = $derived(menuFields(board.reg, (f) => f.key !== 'native:type'));

	const order = $derived(view.orderBy[0]);
	const orderKey = $derived(order ? (order.field === 'manual' ? '' : keyOf(order.field)) : '');

	function set<K extends keyof ViewDefinition>(k: K, value: ViewDefinition[K]) {
		onchange({ ...view, [k]: value });
	}
	function setDisplay<K extends keyof ViewDefinition['display']>(k: K, value: ViewDefinition['display'][K]) {
		onchange({ ...view, display: { ...view.display, [k]: value } });
	}
	function setLayout(layout: Layout) {
		let next: ViewDefinition = { ...view, layout };
		if (layout === 'board' && !view.groupBy) next = { ...next, groupBy: { field: 'native:status', name: 'Status' } };
		if (layout === 'matrix' && !view.matrix) {
			const y = axisFields.find((f) => f.key.startsWith('custom:')) ?? axisFields[0];
			const x = axisFields.find((f) => f.key === 'native:weight') ?? axisFields[1] ?? axisFields[0];
			if (x && y) next = { ...next, matrix: { x: { field: refOf(x) }, y: { field: refOf(y) } } };
		}
		onchange(next);
	}
	function setAxis(which: 'x' | 'y', key: string) {
		if (!view.matrix) return;
		const ref = refFor(key);
		if (!ref) return;
		const axis: AxisConfig = { field: ref };
		onchange({ ...view, matrix: { ...view.matrix, [which]: axis } });
	}
	function toggleProp(key: string) {
		const has = view.display.properties.some((p) => keyOf(p) === key);
		const ref = refFor(key);
		const properties = has ? view.display.properties.filter((p) => keyOf(p) !== key) : ref ? [...view.display.properties, ref] : view.display.properties;
		setDisplay('properties', properties);
	}

	const LAYOUTS: [Layout, string][] = [
		['list', 'List'],
		['board', 'Board'],
		['matrix', 'Matrix']
	];
	const COMPLETED: [CompletedWindow, string][] = [
		['all', 'All'],
		['day', 'Past day'],
		['week', 'Past week'],
		['month', 'Past month'],
		['none', 'None']
	];
	const SUBS: [SubIssues, string][] = [
		['nested', 'Nested'],
		['flat', 'Flat'],
		['hidden', 'Hidden']
	];
</script>

<Popover label="Display options" triggerClass="btn" align="right" width="320px">
	{#snippet trigger()}
		<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
			><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg
		>
		Display
	{/snippet}
	{#snippet children()}
		<div class="display">
			<div class="seg" role="group" aria-label="Layout">
				{#each LAYOUTS as [k, label] (k)}
					<button type="button" aria-pressed={view.layout === k} onclick={() => setLayout(k)}>{label}</button>
				{/each}
			</div>

			{#if view.layout === 'matrix' && view.matrix}
				<label class="line"
					><span>Horizontal axis</span>
					<select class="input" value={keyOf(view.matrix.x.field)} onchange={(e) => setAxis('x', e.currentTarget.value)}>
						{#if keyOf(view.matrix.x.field) === '__missing'}<option value="__missing">(field removed)</option>{/if}
						{#each axisFields as f (f.key)}<option value={f.key}>{f.name}</option>{/each}
					</select>
				</label>
				<label class="line"
					><span>Vertical axis</span>
					<select class="input" value={keyOf(view.matrix.y.field)} onchange={(e) => setAxis('y', e.currentTarget.value)}>
						{#if keyOf(view.matrix.y.field) === '__missing'}<option value="__missing">(field removed)</option>{/if}
						{#each axisFields as f (f.key)}<option value={f.key}>{f.name}</option>{/each}
					</select>
				</label>
			{:else}
				<label class="line"
					><span>{view.layout === 'board' ? 'Columns' : 'Grouping'}</span>
					<select class="input" value={keyOf(view.groupBy)} onchange={(e) => set('groupBy', refFor(e.currentTarget.value))}>
						{#if view.layout !== 'board'}<option value="">No grouping</option>{/if}
						{#if keyOf(view.groupBy) === '__missing'}<option value="__missing">(field removed)</option>{/if}
						{#each groupFields as f (f.key)}<option value={f.key}>{f.name}</option>{/each}
					</select>
				</label>
				<label class="line"
					><span>{view.layout === 'board' ? 'Rows' : 'Sub-grouping'}</span>
					<select class="input" value={keyOf(view.subGroupBy)} onchange={(e) => set('subGroupBy', refFor(e.currentTarget.value))}>
						<option value="">None</option>
						{#if keyOf(view.subGroupBy) === '__missing'}<option value="__missing">(field removed)</option>{/if}
						{#each menuFields(board.reg, canGroupBy) as f (f.key)}<option value={f.key}>{f.name}</option>{/each}
					</select>
				</label>
			{/if}
			<div class="line">
				<label for="order-by">Ordering</label>
				<div class="pair">
					<select
						id="order-by"
						class="input"
						value={orderKey}
						onchange={(e) => {
							const ref = refFor(e.currentTarget.value);
							set('orderBy', ref ? [{ field: ref, dir: order?.dir ?? 'desc' }] : []);
						}}
					>
						<option value="">Last updated</option>
						{#each sortFields as f (f.key)}<option value={f.key}>{f.name}</option>{/each}
					</select>
					<button
						type="button"
						class="btn small"
						disabled={!order}
						title="Sort direction"
						aria-label="Sort direction: {order?.dir === 'asc' ? 'ascending' : 'descending'}"
						onclick={() => order && set('orderBy', [{ ...order, dir: order.dir === 'asc' ? 'desc' : 'asc' }])}
						>{order?.dir === 'asc' ? '↑' : '↓'}</button
					>
				</div>
			</div>
			<label class="line"
				><span>Completed issues</span>
				<select class="input" value={view.display.completed} onchange={(e) => setDisplay('completed', e.currentTarget.value as CompletedWindow)}>
					{#each COMPLETED as [k, label] (k)}<option value={k}>{label}</option>{/each}
				</select>
			</label>
			{#if view.layout !== 'matrix'}
				<label class="line"
					><span>Sub-issues</span>
					<select class="input" value={view.display.subIssues} onchange={(e) => setDisplay('subIssues', e.currentTarget.value as SubIssues)}>
						{#each SUBS as [k, label] (k)}<option value={k}>{label}</option>{/each}
					</select>
				</label>
				<label class="check"
					><input type="checkbox" checked={view.display.showEmptyGroups} onchange={(e) => setDisplay('showEmptyGroups', e.currentTarget.checked)} />
					Show empty groups</label
				>
				<div class="menu-label">Properties</div>
				<div class="props">
					{#each propFields as f (f.key)}
						{@const on = view.display.properties.some((p) => keyOf(p) === f.key)}
						<button type="button" class="prop" aria-pressed={on} onclick={() => toggleProp(f.key)}>{f.name}</button>
					{/each}
				</div>
			{/if}
		</div>
	{/snippet}
</Popover>

<style>
	.display {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 6px;
	}
	.seg {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.seg button {
		border: 0;
		background: transparent;
		height: 30px;
		font-size: 13px;
		cursor: pointer;
		color: var(--text-secondary);
	}
	.seg button + button {
		border-left: 1px solid var(--border);
	}
	.seg button[aria-pressed='true'] {
		background: var(--selected);
		color: var(--text-primary);
		font-weight: 600;
	}
	.line {
		display: grid;
		grid-template-columns: 120px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.line select {
		width: 100%;
	}
	.pair {
		display: flex;
		gap: 4px;
	}
	.pair select {
		flex: 1;
		min-width: 0;
	}
	.check {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.props {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.prop {
		height: 24px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: transparent;
		font-size: 12px;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.prop[aria-pressed='true'] {
		background: var(--selected);
		border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
		color: var(--text-primary);
	}
</style>
