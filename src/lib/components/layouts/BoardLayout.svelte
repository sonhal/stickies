<script lang="ts">
	import { tick } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { closedKind, optionById, personName } from '$lib/fields/registry';
	import type { FieldDef, WorkItem } from '$lib/fields/types';
	import { groupItems, type EngineContext, type ItemGroup, type ViewResult } from '$lib/query/engine';
	import { dropWrite } from '$lib/query/board';
	import type { ViewDefinition } from '$lib/query/types';
	import { slotVar } from '$lib/colors';
	import { boardNext, locate } from '$lib/client/boardNav';
	import StatusIcon from '../ui/StatusIcon.svelte';
	import Avatar from '../ui/Avatar.svelte';
	import ValueChip from '../ui/ValueChip.svelte';

	interface Props {
		view: ViewDefinition;
		result: ViewResult;
		properties: FieldDef[];
		ctx: EngineContext;
		oncreate?: (g: ItemGroup) => void;
	}
	let { result, properties, ctx, oncreate }: Props = $props();
	const board = getBoard();
	const ui = getUi();

	const colField = $derived(result.groupField);
	const laneField = $derived(result.subGroupField);
	const columns = $derived(result.groups);
	const lanes = $derived(laneField ? groupItems(result.items, laneField, ctx, false) : null);
	const canDrag = $derived(!ui.readOnly && !!colField?.editable);

	/** Items in a column (and lane), keeping the column's sort order. */
	function cell(col: ItemGroup, lane: ItemGroup | null): WorkItem[] {
		if (!lane) return col.items;
		const ids = new Set(lane.items.map((i) => i.id));
		return col.items.filter((i) => ids.has(i.id));
	}

	$effect(() => {
		const ids: string[] = [];
		for (const c of columns) for (const i of c.items) if (!ids.includes(i.id)) ids.push(i.id);
		ui.navOrder = ids;
	});

	// ---- Keyboard navigation -------------------------------------------------------------------------
	/** Card ids as drawn: cells[lane][column], top to bottom. A board without rows is one lane. */
	const cells = $derived(
		(lanes ?? [null]).map((lane) => columns.map((col) => cell(col, lane).map((i) => i.id)))
	);
	/**
	 * The cell the selection was last taken to. A card can be in two columns at once (a board by
	 * labels), and this keeps j/k walking the column the user is looking at.
	 */
	let lastCell: { lane: number; col: number } | null = null;
	/** Set by keyboard moves: the effect below focuses the card once it is drawn */
	let focusNext = false;
	/** Bumped to scroll to the selection again after it moved to another column */
	let reveal = $state(0);

	// The shell's key handler calls these instead of its linear j/k (see UiState.nav).
	$effect(() => {
		ui.nav = {
			move: (dir) => {
				const next = boardNext(cells, ui.selectedId, dir, lastCell);
				if (!next) return;
				lastCell = { lane: next.pos.lane, col: next.pos.col };
				focusNext = true;
				ui.selectedId = next.id;
				reveal++;
			},
			shift: (delta) => {
				const item = ui.selectedId ? board.byId.get(ui.selectedId) : null;
				const at = item ? locate(cells, item.id, lastCell) : null;
				if (!item || !at || !canDrag) return false;
				shiftCard(item, at.col, at.lane, delta);
				return true;
			}
		};
		return () => (ui.nav = null);
	});

	// Keep the selected card in view (both ways: the board scrolls sideways) and, after a key, focused.
	$effect(() => {
		const id = ui.selectedId;
		void reveal;
		if (!id) return;
		// After tick(): a card that just changed column is only drawn there once the board updates.
		tick().then(() => {
			const sel = `.board [data-item="${CSS.escape(id)}"]`;
			const el =
				(lastCell && document.querySelector<HTMLElement>(`${sel}[data-cell="${lastCell.lane}:${lastCell.col}"]`)) ||
				document.querySelector<HTMLElement>(sel);
			if (!el || ui.selectedId !== id) return;
			el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
			if (focusNext) el.focus({ preventScroll: true });
			focusNext = false;
		});
	});

	// ---- Moving cards ------------------------------------------------------------------------------
	let announce = $state('');
	let dragging = $state<{ id: string; col: string; lane: string | null } | null>(null);
	let over = $state<string | null>(null);

	const colValue = (key: string) => (key === '__none' ? null : key);

	/** Move a card one column (Alt+←/→, Shift+H/L); the selection and focus go with it. */
	function shiftCard(item: WorkItem, colIndex: number, laneIndex: number, delta: 1 | -1) {
		const to = columns[colIndex + delta];
		if (!to) return;
		const lane = lanes?.[laneIndex]?.key ?? null;
		ui.selectedId = item.id;
		lastCell = { lane: laneIndex, col: colIndex + delta };
		focusNext = true;
		move(item, columns[colIndex].key, to.key, lane, lane).then(() => {
			// GitLab's answer can re-sort the column, and moving a card in the page drops its focus.
			if (ui.selectedId !== item.id || (document.activeElement && document.activeElement !== document.body)) return;
			focusNext = true;
			reveal++;
		});
		// move() shows the card in its new column at once (optimistic); scroll to it there.
		reveal++;
	}

	async function move(item: WorkItem, fromCol: string, toCol: string, fromLane: string | null, toLane: string | null) {
		const writes = [];
		if (colField && fromCol !== toCol) writes.push({ field: colField, w: dropWrite(item, colField, colValue(fromCol), colValue(toCol)) });
		if (laneField && fromLane !== null && toLane !== null && fromLane !== toLane)
			writes.push({ field: laneField, w: dropWrite(item, laneField, colValue(fromLane), colValue(toLane)) });
		for (const { w } of writes) {
			if (!w) continue;
			if ('error' in w) {
				ui.toast(w.error, 'error');
				return;
			}
		}
		for (const { field, w } of writes) {
			if (!w || 'error' in w) continue;
			const ok = await board.update(item.id, w.key, w.value);
			if (ok) {
				const label = columns.find((c) => c.key === toCol)?.label ?? '';
				announce = `Moved ${item.ref} to ${field === colField ? label : 'another row'}`;
			}
		}
	}

	function onDragStart(e: DragEvent, item: WorkItem, col: string, lane: string | null) {
		if (!canDrag || !e.dataTransfer) return;
		dragging = { id: item.id, col, lane };
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', item.ref);
	}

	function onDrop(e: DragEvent, col: string, lane: string | null) {
		e.preventDefault();
		over = null;
		const d = dragging;
		dragging = null;
		if (!d) return;
		const item = board.byId.get(d.id);
		if (item) move(item, d.col, col, d.lane, lane);
	}

	/**
	 * Keyboard alternative to drag: Alt+← / Alt+→ moves the focused card one column (the selected
	 * card when focus is elsewhere is handled through ui.nav.shift).
	 */
	function onCardKey(e: KeyboardEvent, item: WorkItem, colIndex: number, laneIndex: number) {
		if (e.key === 'Enter') {
			lastCell = { lane: laneIndex, col: colIndex };
			ui.open(item.id);
			return;
		}
		if (!e.altKey || e.ctrlKey || e.metaKey || !canDrag || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
		e.preventDefault();
		e.stopPropagation();
		shiftCard(item, colIndex, laneIndex, e.key === 'ArrowRight' ? 1 : -1);
	}

	const statusOf = (g: ItemGroup) => (colField?.kind === 'status' && g.value ? optionById(colField, g.value) : null);
</script>

{#snippet card(item: WorkItem, colIndex: number, colKey: string, lane: string | null, laneIndex: number)}
	{@const a = item.values['native:assignees']}
	{@const closed = closedKind(board.reg, item)}
	<div
		class="card"
		class:selected={ui.selectedId === item.id}
		class:closed={!!closed}
		class:pending={board.pending.has(item.id)}
		class:dragging={dragging?.id === item.id}
		draggable={canDrag}
		role="button"
		tabindex="0"
		aria-label="{item.ref}: {item.title}{canDrag ? '. Alt+arrow keys move it between columns.' : ''}"
		data-item={item.id}
		data-cell="{laneIndex}:{colIndex}"
		style="--epic: {slotVar(board.colors.slotFor(item))}"
		ondragstart={(e) => onDragStart(e, item, colKey, lane)}
		ondragend={() => ((dragging = null), (over = null))}
		onclick={() => {
			lastCell = { lane: laneIndex, col: colIndex };
			ui.open(item.id);
		}}
		onkeydown={(e) => onCardKey(e, item, colIndex, laneIndex)}
	>
		<div class="top">
			<span class="ref">{item.ref.replace(/^.*\//, '')}</span>
			{#if a?.kind === 'people' && a.ids.length}<Avatar id={a.ids[0]} name={personName(board.reg, a.ids[0])} size={18} />{/if}
		</div>
		<div class="title">
			{#if colField?.key !== 'native:status'}<StatusIcon status={board.status(item)} size={13} />{/if}
			<span>{item.title}</span>
		</div>
		{#if properties.length}
			<div class="props">
				{#each properties as f (f.key)}
					{#if f.key !== colField?.key && f.key !== 'native:assignees'}<ValueChip field={f} {item} />{/if}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet column(col: ItemGroup, ci: number, lane: ItemGroup | null, li: number)}
	{@const items = cell(col, lane)}
	{@const cellKey = `${col.key}|${lane?.key ?? ''}`}
	<div
		class="cell"
		class:over={over === cellKey}
		role="list"
		aria-label="{col.label}{lane ? `, ${lane.label}` : ''}"
		ondragover={(e) => {
			if (!dragging) return;
			e.preventDefault();
			over = cellKey;
		}}
		ondragleave={(e) => {
			if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) over = null;
		}}
		ondrop={(e) => onDrop(e, col.key, lane?.key ?? null)}
	>
		{#each items as item (item.id)}
			<div role="listitem">{@render card(item, ci, col.key, lane?.key ?? null, li)}</div>
		{/each}
	</div>
{/snippet}

<div class="board" style="--cols: {columns.length}">
	<div class="heads">
		{#each columns as col (col.key)}
			{@const s = statusOf(col)}
			<div class="head">
				{#if s}<StatusIcon status={s} />
				{:else if colField?.kind === 'people' && col.value}<Avatar id={col.value} name={col.label} size={16} />
				{:else if col.option?.color}<span class="dot" style="background: {col.option.color}"></span>{/if}
				<span class="lbl">{col.label}</span>
				<span class="n">{col.items.length}</span>
				{#if oncreate && !ui.readOnly}
					<button type="button" class="add" aria-label="Create an issue in {col.label}" onclick={() => oncreate(col)}>+</button>
				{/if}
			</div>
		{/each}
	</div>

	{#if lanes}
		{#each lanes as lane, li (lane.key)}
			<div class="lane-head"><span>{lane.label}</span> <span class="n">{lane.items.length}</span></div>
			<div class="row">
				{#each columns as col, ci (col.key)}{@render column(col, ci, lane, li)}{/each}
			</div>
		{/each}
	{:else}
		<div class="row">
			{#each columns as col, ci (col.key)}{@render column(col, ci, null, 0)}{/each}
		</div>
	{/if}
	<p class="visually-hidden" aria-live="polite">{announce}</p>
</div>

{#if !canDrag && !ui.readOnly && colField}
	<p class="hint muted">{colField.name} can't be changed from the board, so cards can't be dragged here.</p>
{:else if canDrag}
	<p class="hint muted">Drag cards between columns, or select one and press <kbd>Alt</kbd>+<kbd>←</kbd>/<kbd>→</kbd>. <kbd>?</kbd> lists every shortcut.</p>
{/if}

<style>
	.board {
		overflow-x: auto;
		padding-bottom: 8px;
	}
	.heads,
	.row {
		display: grid;
		grid-template-columns: repeat(var(--cols), minmax(250px, 1fr));
		gap: 10px;
		min-width: min-content;
	}
	.heads {
		position: sticky;
		top: 0;
		z-index: 3;
		background: var(--surface-0);
		padding-bottom: 6px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 8px;
		font-size: 13px;
		font-weight: 600;
	}
	.lbl {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.n {
		color: var(--text-muted);
		font-weight: 500;
		font-size: 12.5px;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.add {
		margin-left: auto;
		width: 22px;
		height: 22px;
		border: 0;
		border-radius: 5px;
		background: transparent;
		color: var(--text-muted);
		font-size: 16px;
		cursor: pointer;
	}
	.add:hover {
		background: var(--hover);
	}
	.lane-head {
		display: flex;
		gap: 6px;
		align-items: baseline;
		margin: 14px 0 6px;
		padding: 0 4px;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-secondary);
		border-bottom: 1px solid var(--grid);
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 80px;
		padding: 6px;
		border-radius: var(--radius);
		background: color-mix(in srgb, var(--surface-1) 55%, var(--surface-0));
		border: 1px dashed transparent;
		transition: background 100ms ease;
	}
	.cell.over {
		border-color: var(--accent);
		background: var(--selected);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 9px 10px 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.04);
		cursor: pointer;
		font-size: 13.5px;
		/* Room for the sticky column heads (and a little air below) when a key scrolls a card into view */
		scroll-margin: 44px 0 12px;
	}
	.card::before {
		content: '';
		position: absolute;
		left: 0;
		top: 8px;
		bottom: 8px;
		width: 3px;
		border-radius: 0 2px 2px 0;
		background: var(--epic);
	}
	.card[draggable='true'] {
		cursor: grab;
	}
	.card:hover {
		border-color: color-mix(in srgb, var(--text-muted) 50%, var(--border));
	}
	.card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
	}
	.card.dragging {
		opacity: 0.4;
	}
	.card.pending {
		opacity: 0.7;
	}
	.card.closed .title span {
		color: var(--text-muted);
	}
	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 18px;
	}
	.ref {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.title {
		display: flex;
		gap: 7px;
		align-items: flex-start;
		line-height: 1.35;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.title :global(svg) {
		margin-top: 2px;
	}
	.props {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.hint {
		font-size: 12px;
		margin: 6px 2px 0;
	}
</style>
