<script lang="ts">
	import { groupByQuadrant, screenLayout, type Placed, type ResolvedAxis } from '$lib/query/matrix';
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

				<div class="notes">
					{#each notes as p (p.item.id)}
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
							aria-label="{p.item.title}. Status: {status?.label ?? 'none'}. Epic: {epicTitle(p.item)}."
							aria-pressed={selectedId === p.item.id}
							onclick={() => onselect(p.item)}
						>
							<span class="title">{p.item.title}</span>
							<span class="status" class:none={!status}>
								{#if status?.color}<span class="dot" style="background: {status.color}" aria-hidden="true"></span>{/if}{status?.label ??
									'no status'}
							</span>
						</button>
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
		padding: 12px 12px 10px;
	}
	.quadrant.do {
		background: var(--quadrant-do-solid);
		border-color: var(--quadrant-do-border);
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 10px;
	}
	h2 {
		margin: 0;
		font-size: 19px;
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
		grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
		grid-auto-rows: minmax(104px, auto);
		gap: 12px;
		align-content: start;
		padding: 4px 4px 8px;
	}

	/* ---- The sticky note ---------------------------------------------------- */
	.note {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: 10px;
		padding: 12px 12px 10px;
		text-align: left;
		cursor: pointer;
		/* Paper tinted with the epic color; a solid band of the same color on top. */
		background: color-mix(in srgb, var(--note) 24%, var(--surface-2));
		border: 0;
		border-top: 6px solid var(--note);
		border-radius: 3px 3px 10px 3px;
		box-shadow:
			0 1px 1px rgba(0, 0, 0, 0.08),
			0 3px 8px rgba(0, 0, 0, 0.08);
		transition:
			transform 120ms ease,
			opacity 150ms ease,
			box-shadow 120ms ease;
	}
	/* A slight, deterministic tilt so it reads as paper, not as a table cell. */
	.note:nth-child(3n + 1) {
		transform: rotate(-0.6deg);
	}
	.note:nth-child(3n + 2) {
		transform: rotate(0.5deg);
	}
	.note:hover,
	.note:focus-visible {
		transform: translateY(-2px) rotate(0deg);
		box-shadow:
			0 2px 2px rgba(0, 0, 0, 0.1),
			0 8px 18px rgba(0, 0, 0, 0.14);
	}
	.note.selected {
		transform: scale(1.03);
		outline: 3px solid var(--text-primary);
		outline-offset: 2px;
		z-index: 1;
	}
	.note.other {
		outline: 1.5px dashed var(--text-muted);
		outline-offset: -4px;
	}
	.note.dim {
		opacity: 0.18;
	}

	.title {
		color: var(--text-primary);
		font-size: 15px;
		font-weight: 600;
		line-height: 1.3;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.status {
		align-self: flex-start;
		font-size: 12px;
		font-weight: 600;
		line-height: 1;
		padding: 4px 8px;
		border-radius: 999px;
		color: var(--text-primary);
		background: var(--surface-2);
		border: 1px solid color-mix(in srgb, var(--note) 55%, var(--border));
	}
	.status.none {
		color: var(--text-muted);
		font-weight: 500;
		font-style: italic;
	}
	.dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		margin-right: 5px;
		vertical-align: 0;
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
