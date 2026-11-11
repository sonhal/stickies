<script lang="ts">
	import { groupByQuadrant, quadrantCells, screenLayout, type Placed, type ResolvedAxis } from '$lib/query/matrix';
	import type { QuadrantKey } from '$lib/query/types';
	import { slotVar, type ColorSlot } from '$lib/colors';
	import type { OptionDef, WorkItem } from '$lib/fields/types';

	interface Props {
		/** Accessible name of the grid */
		label?: string;
		placed: Placed[];
		x: ResolvedAxis;
		y: ResolvedAxis;
		quadrants: Record<QuadrantKey, { name: string; hint: string }>;
		slotFor: (item: WorkItem) => ColorSlot;
		epicTitle: (item: WorkItem) => string;
		statusOf: (item: WorkItem) => OptionDef | null;
		isActive: (item: WorkItem) => boolean;
		selectedId: string | null;
		onselect: (item: WorkItem) => void;
	}

	let { label = 'Quadrant matrix', placed, x, y, quadrants, slotFor, epicTitle, statusOf, isActive, selectedId, onselect }: Props = $props();

	const groups = $derived(groupByQuadrant(placed));
	const layout = $derived(screenLayout(x, y));

	// Scroll the selected note into view when the walk-through moves to it.
	let root: HTMLElement | undefined = $state();
	$effect(() => {
		if (selectedId === null || !root) return;
		root
			.querySelector<HTMLElement>(`[data-item="${CSS.escape(selectedId)}"]`)
			?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
	});
</script>

<div class="board" bind:this={root} role="region" aria-label={label}>
	<!-- Row captions on the left, column captions along the bottom -->
	{#each layout.cells as row, r (r)}
		<div class="y-cap" style="grid-row: {r + 1}">
			<span>{layout.yCaptions[r]}</span>
		</div>
		{#each row as key, c (key)}
			{@const q = quadrants[key]}
			{@const notes = groups[key]}
			<!-- Cards sit on a grid by their scores: higher x further right, higher y further up -->
			{@const grid = quadrantCells(notes, { invertX: x.config.invert, invertY: y.config.invert })}
			<section
				class="quadrant"
				class:do={key === 'highHigh'}
				style="grid-row: {r + 1}; grid-column: {c + 2}"
				aria-label="{q.name}: {q.hint}, {notes.length} issues"
			>
				<header>
					<h2>{q.name}</h2>
					<span class="count">{notes.length}</span>
					<span class="hint">{q.hint}</span>
				</header>

				<div class="notes" style="--cols: {grid.cols}; --rows: {grid.rows}">
					{#each grid.cells as cell (`${cell.row}:${cell.col}`)}
						<div class="cell" style="grid-row: {cell.row}; grid-column: {cell.col}">
							{#each cell.items as p (p.item.id)}
								{@const slot = slotFor(p.item)}
								{@const status = statusOf(p.item)}
								<button
									class="note"
									class:dim={!isActive(p.item)}
									class:selected={selectedId === p.item.id}
									class:other={slot === 'other'}
									style="--note: {slotVar(slot)}"
									data-item={p.item.id}
									tabindex={isActive(p.item) ? 0 : -1}
									title="{p.item.title}
{x.title}: {x.text(p.item)} · {y.title}: {y.text(p.item)} · {status?.label ?? 'no status'}"
									aria-label="{p.item.title}. Status: {status?.label ?? 'none'}. Epic: {epicTitle(p.item)}."
									aria-pressed={selectedId === p.item.id}
									onclick={() => onselect(p.item)}
								>
									<span class="title">{p.item.title}</span>
									<span class="status" class:none={!status}>
										<span class="dot" style:background={status?.color ?? 'transparent'} aria-hidden="true"></span>
										<span class="status-label">{status?.label ?? 'no status'}</span>
									</span>
								</button>
							{/each}
						</div>
					{:else}
						<p class="empty">Nothing here</p>
					{/each}
				</div>
			</section>
		{/each}
	{/each}

	{#each layout.xCaptions as cap, c (c)}
		<div class="x-cap" style="grid-row: 3; grid-column: {c + 2}">{cap}</div>
	{/each}
</div>

<style>
	.board {
		display: grid;
		grid-template-columns: 26px minmax(0, 1fr) minmax(0, 1fr);
		/* Fill the screen below the header; each quadrant scrolls if it overflows. */
		grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) auto;
		gap: 10px;
		height: calc(100vh - 170px);
		min-height: 520px;
	}

	.y-cap {
		grid-column: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.y-cap span {
		writing-mode: vertical-rl;
		transform: rotate(180deg);
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.04em;
	}
	.x-cap {
		text-align: center;
		font-size: 13px;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.04em;
	}

	.quadrant {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 10px 10px 8px;
	}
	.quadrant.do {
		background: var(--quadrant-do-solid);
		border-color: var(--quadrant-do-border);
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 6px;
	}
	h2 {
		margin: 0;
		font-size: 17px;
	}
	.count {
		font-size: 15px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		margin-left: auto;
		font-size: 12px;
		color: var(--text-muted);
	}

	.notes {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: grid;
		grid-template-columns: repeat(var(--cols, 1), minmax(0, 1fr));
		grid-template-rows: repeat(var(--rows, 1), auto);
		/* Wider gaps between positions than between cards, so the placement reads */
		gap: 8px 12px;
		align-content: start;
		padding: 2px;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	/* ---- The card: one line, epic color bar, status dot ------------------------ */
	.note {
		container-type: inline-size;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 22px;
		min-width: 0;
		padding: 0 8px 0 7px;
		text-align: left;
		cursor: pointer;
		background: color-mix(in srgb, var(--note) 16%, var(--surface-2));
		border: 0;
		border-left: 4px solid var(--note);
		border-radius: 4px;
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.06);
		transition:
			opacity 150ms ease,
			box-shadow 120ms ease;
	}
	.note:hover,
	.note:focus-visible {
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 3px 8px rgba(0, 0, 0, 0.1);
	}
	.note.selected {
		outline: 2px solid var(--text-primary);
		outline-offset: 1px;
		z-index: 1;
	}
	.note.other {
		outline: 1.5px dashed var(--text-muted);
		outline-offset: -2px;
	}
	.note.dim {
		opacity: 0.18;
	}

	.title {
		flex: 1;
		min-width: 0;
		color: var(--text-primary);
		font-size: 12.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 45%;
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
	}
	.status-label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status.none {
		font-style: italic;
	}
	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-muted) 50%, transparent);
	}
	/* Narrow cards (several positions side by side): keep the dot, drop the status text */
	@container (max-width: 190px) {
		.status-label {
			display: none;
		}
	}
	.empty {
		margin: 0;
		color: var(--text-muted);
		font-size: 13px;
	}

	@media (max-width: 900px) {
		.board {
			grid-template-columns: 22px minmax(0, 1fr);
			grid-template-rows: none;
			height: auto;
		}
		.quadrant {
			grid-column: 2 !important;
			grid-row: auto !important;
			max-height: none;
		}
		.y-cap,
		.x-cap {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.note {
			transition: none;
		}
	}
</style>
