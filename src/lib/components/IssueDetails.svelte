<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slotVar, type ColorSlot } from '$lib/colors';
	import type { WorkItem } from '$lib/fields/types';

	interface Props {
		/** null = nothing selected yet: show the "start walking" prompt */
		issue: WorkItem | null;
		slot: ColorSlot;
		epicTitle: string;
		quadrantName: string | null;
		firstQuadrant: string;
		facts: { label: string; value: string }[];
		/** 1-based position in the walk order, and the walk length */
		position: number;
		total: number;
		onprev: () => void;
		onnext: () => void;
		onclose: () => void;
		/** Optional extra content below the facts (e.g. inline editors) */
		children?: Snippet;
	}

	let { issue, slot, epicTitle, quadrantName, firstQuadrant, facts, position, total, onprev, onnext, onclose, children }: Props =
		$props();

	const paragraphs = $derived(issue?.description ? issue.description.split(/\n{2,}/) : []);
</script>

<section class="panel" aria-label="Now discussing" aria-live="polite">
	<nav class="walk">
		<button onclick={onprev} disabled={total === 0} aria-label="Previous issue (left arrow)">←</button>
		<span class="pos">
			{#if issue && position > 0}{position} of {total}{:else}{total} to discuss{/if}
		</span>
		<button onclick={onnext} disabled={total === 0} aria-label="Next issue (right arrow)">→</button>
		{#if issue}
			<button class="close" onclick={onclose} aria-label="Close (Escape)">×</button>
		{/if}
	</nav>

	{#if issue}
		<div class="meta">
			<span class="chip" style="background: {slotVar(slot)}"></span>
			<span class="epic">{epicTitle}</span>
			{#if quadrantName}<span class="quadrant">{quadrantName}</span>{/if}
		</div>

		<h2>{issue.title}</h2>
		<p class="ref">{issue.ref}</p>

		<dl class="facts">
			{#each facts as f (f.label)}
				<div><dt>{f.label}</dt><dd>{f.value || '—'}</dd></div>
			{/each}
		</dl>
		{@render children?.()}

		<div class="desc">
			{#each paragraphs as p, i (i)}
				<p>{p}</p>
			{:else}
				<p class="empty">No description.</p>
			{/each}
		</div>

		{#if issue.url}
			<a class="open" href={issue.url} target="_blank" rel="noopener noreferrer">
				{issue.descriptionTruncated ? 'Read the rest in GitLab ↗' : 'Open in GitLab ↗'}
			</a>
		{/if}
	{:else}
		<div class="start">
			<p>Walk through the board one issue at a time, starting with <strong>{firstQuadrant}</strong>.</p>
			<button class="primary" onclick={onnext} disabled={total === 0}>Start</button>
			<p class="hint">Use ← → to move, Esc to close. Or click any dot.</p>
		</div>
	{/if}
</section>

<style>
	.panel {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px 18px 18px;
		display: flex;
		flex-direction: column;
		/* Fits beside the matrix; long descriptions scroll inside the panel. */
		max-height: calc(100vh - 120px);
		min-height: 320px;
	}
	.walk {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 10px;
		margin-bottom: 12px;
		border-bottom: 1px solid var(--grid);
	}
	.walk button {
		width: 34px;
		height: 30px;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--surface-2);
		cursor: pointer;
	}
	.walk button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.walk .close {
		margin-left: auto;
		border: 0;
		background: none;
		font-size: 20px;
		color: var(--text-muted);
	}
	.pos {
		font-size: 13px;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		min-width: 70px;
		text-align: center;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.chip {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex: none;
	}
	.quadrant {
		margin-left: auto;
		padding: 1px 8px;
		border-radius: 999px;
		border: 1px solid var(--border);
		font-size: 12px;
	}
	h2 {
		font-size: 22px;
		line-height: 1.25;
		margin: 8px 0 2px;
	}
	.ref {
		margin: 0 0 12px;
		font-family: var(--mono);
		font-size: 12px;
		color: var(--text-muted);
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		margin: 0 0 14px;
		font-size: 13px;
	}
	.facts dt {
		color: var(--text-muted);
	}
	.facts dd {
		margin: 0;
		color: var(--text-primary);
	}
	.desc {
		flex: 1;
		overflow-y: auto;
		font-size: 16px;
		line-height: 1.55;
		color: var(--text-primary);
		padding-right: 4px;
	}
	.desc p {
		margin: 0 0 0.8em;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.desc .empty {
		color: var(--text-muted);
		font-style: italic;
	}
	.open {
		margin-top: 12px;
		font-weight: 600;
		text-decoration: none;
	}
	.start {
		color: var(--text-secondary);
	}
	.primary {
		padding: 8px 18px;
		border: 0;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		font-weight: 600;
		cursor: pointer;
	}
	.hint {
		font-size: 13px;
		color: var(--text-muted);
	}
</style>
