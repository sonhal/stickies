<script lang="ts">
	import type { Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { getBoard } from '$lib/client/board.svelte';
	import {
		groupByQuadrant,
		placeItems,
		quadrantsOf,
		walkOrderOf,
		resolveAxis
	} from '$lib/query/matrix';
	import type { MatrixConfig, ViewDefinition } from '$lib/query/types';
	import type { WorkItem } from '$lib/fields/types';
	import QuadrantBoard from '$lib/components/QuadrantBoard.svelte';
	import Legend from '$lib/components/Legend.svelte';
	import IssueDetails from '$lib/components/IssueDetails.svelte';
	import IssueTable from '$lib/components/IssueTable.svelte';
	import FieldEditor from '$lib/components/FieldEditor.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import type { FieldKey } from '$lib/fields/types';

	interface Props {
		view: ViewDefinition;
		items: WorkItem[];
		selectedId: string | null;
		onselect: (id: string | null) => void;
		/** Rendered inside the walk panel under the facts, e.g. editors */
		details?: Snippet<[WorkItem]>;
		/** Kiosk: no keyboard capture needed for other things */
		walkKeys?: boolean;
	}

	let { view, items, selectedId, onselect, details, walkKeys = true }: Props = $props();
	const board = getBoard();
	const ui = getUi();

	const DEFAULT_MATRIX: MatrixConfig = { x: { field: { field: 'native:weight' } }, y: { field: { field: 'native:status' } } };
	const matrix = $derived(view.matrix ?? DEFAULT_MATRIX);
	const ctx = $derived(board.rankContext(view));
	const x = $derived(resolveAxis(matrix.x, ctx, items));
	const y = $derived(resolveAxis(matrix.y, ctx, items));
	const quadrants = $derived(quadrantsOf(matrix));
	const walkOrder = $derived(walkOrderOf(matrix));
	const placement = $derived(placeItems(items, x, y));
	const byQuadrant = $derived(groupByQuadrant(placement.placed));
	const notices = $derived([x.problem, y.problem, x.warning, y.warning].filter((n): n is string => !!n));

	// ---- Epic focus (legend) ---------------------------------------------------------------
	const focused = new SvelteSet<string>();
	let hoverKey = $state<string | null>(null);
	const swatches = $derived(board.colors.swatches(items));
	const slotFor = (i: WorkItem) => board.colors.slotFor(i);
	const epicTitle = (i: WorkItem) => board.epicTitle(i);
	const statusOf = (i: WorkItem) => board.status(i);

	function passesFocus(i: WorkItem) {
		return focused.size === 0 || focused.has(board.colors.swatchKey(i));
	}
	function isActive(i: WorkItem) {
		if (hoverKey !== null && board.colors.swatchKey(i) !== hoverKey) return false;
		return passesFocus(i);
	}
	function toggleEpic(key: string) {
		if (focused.has(key)) focused.delete(key);
		else focused.add(key);
	}

	const describe = (i: WorkItem) => ({
		x: x.text(i),
		y: y.text(i),
		status: board.status(i)?.label ?? '—',
		assignees: board.text(i, 'native:assignees')
	});

	const missingNote = (i: WorkItem) => {
		const u = placement.unplaced.find((p) => p.item.id === i.id);
		if (!u) return '';
		return u.missing.map((m) => `No ${(m === 'x' ? x : y).field?.name ?? (m === 'x' ? x : y).title}`).join(', ');
	};

	// ---- Standup walk-through: Do → Schedule → Delegate → Drop, then triage ------------------
	const walk = $derived(
		[...walkOrder.flatMap((q) => byQuadrant[q].map((p) => p.item)), ...placement.unplaced.map((u) => u.item)].filter(
			passesFocus
		)
	);
	const walkIndex = $derived(walk.findIndex((i) => i.id === selectedId));
	const selected = $derived(selectedId ? (board.byId.get(selectedId) ?? null) : null);
	const selectedQuadrant = $derived.by(() => {
		const p = placement.placed.find((pl) => pl.item.id === selectedId);
		return p ? quadrants[p.quadrant].name : null;
	});

	function step(delta: 1 | -1) {
		if (walk.length === 0) return;
		const next =
			walkIndex === -1 ? (delta === 1 ? 0 : walk.length - 1) : (walkIndex + delta + walk.length) % walk.length;
		onselect(walk[next].id);
	}

	function onWindowKey(e: KeyboardEvent) {
		if (!walkKeys) return;
		const el = e.target as HTMLElement | null;
		if (el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable)) return;
		if (el?.closest('[role="dialog"]')) return;
		if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
		if (e.key === 'ArrowRight' || e.key === 'j') {
			e.preventDefault();
			step(1);
		} else if (e.key === 'ArrowLeft' || e.key === 'k') {
			e.preventDefault();
			step(-1);
		}
	}

	/** Fields edited inline in the walk panel: status, both axes, assignees, due date. */
	const editKeys = $derived(
		[...new Set(['native:status', x.field?.key, y.field?.key, 'native:assignees', 'native:dueDate'].filter((k): k is FieldKey => !!k))]
	);

	const facts = $derived(
		selected && !ui.readOnly
			? []
			: selected
			? [
					{ label: 'Status', value: board.status(selected)?.label ?? '' },
					{ label: x.title, value: x.text(selected) },
					{ label: y.title, value: y.text(selected) },
					{ label: 'Assignee', value: board.text(selected, 'native:assignees') || 'Unassigned' },
					...(selected.values['native:dueDate'] ? [{ label: 'Due', value: board.text(selected, 'native:dueDate') }] : [])
				]
			: []
	);
</script>

<svelte:window onkeydown={onWindowKey} />

{#each notices as n (n)}
	<p class="notice warn" role="status">{n}</p>
{/each}

<div class="matrix">
	<div class="primary">
		<QuadrantBoard
			label={matrix.label}
			placed={placement.placed}
			{x}
			{y}
			{quadrants}
			{slotFor}
			{epicTitle}
			{statusOf}
			{isActive}
			{selectedId}
			onselect={(i) => onselect(i.id)}
		/>
	</div>

	<aside class="side">
		<IssueDetails
			issue={selected}
			slot={selected ? slotFor(selected) : 'none'}
			epicTitle={selected ? epicTitle(selected) : ''}
			quadrantName={selectedQuadrant}
			firstQuadrant={quadrants[walkOrder[0]].name}
			{facts}
			position={walkIndex + 1}
			total={walk.length}
			onprev={() => step(-1)}
			onnext={() => step(1)}
			onclose={() => onselect(null)}
		>
			{#if selected && !ui.readOnly}
				<dl class="edit-facts">
					{#each editKeys as k (k)}
						<dt>{board.field(k)?.name ?? k}</dt>
						<dd><FieldEditor key={k} item={selected} /></dd>
					{/each}
				</dl>
			{/if}
			{#if selected && details}{@render details(selected)}{/if}
		</IssueDetails>
		<Legend
			{swatches}
			{focused}
			ontoggle={toggleEpic}
			onclear={() => focused.clear()}
			onhover={(k) => (hoverKey = k)}
		/>
	</aside>
</div>

{#if placement.unplaced.length}
	<section id="triage" class="triage">
		<IssueTable
			caption="Needs triage: can't be placed until these are set"
			items={placement.unplaced.map((u) => u.item)}
			xTitle={x.title}
			yTitle={y.title}
			{slotFor}
			{epicTitle}
			{describe}
			{isActive}
			note={missingNote}
			noteTitle="Missing"
			onselect={(i) => onselect(i.id)}
		/>
	</section>
{/if}

<style>
	.matrix {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(260px, 24%);
		gap: 16px;
		align-items: start;
	}
	.side {
		display: grid;
		gap: 16px;
		position: sticky;
		top: 16px;
	}
	.triage {
		margin-top: 28px;
	}
	.edit-facts {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0 14px;
		margin: 0 0 12px;
		font-size: 13px;
	}
	.edit-facts dt {
		color: var(--text-muted);
		padding: 6px 0;
	}
	.edit-facts dd {
		margin: 0;
		display: flex;
		align-items: center;
	}
	.notice {
		border-radius: var(--radius);
		padding: 10px 14px;
		margin: 0 0 12px;
		border: 1px solid var(--border);
		background: var(--warning-bg);
		font-size: 14px;
	}
	@media (max-width: 1100px) {
		.matrix {
			grid-template-columns: 1fr;
		}
		.side {
			position: static;
		}
	}
</style>
