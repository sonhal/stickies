<script lang="ts">
	import { slotVar, type EpicSwatch } from '$lib/colors';

	interface Props {
		swatches: EpicSwatch[];
		focused: Set<string>;
		ontoggle: (key: string) => void;
		onclear: () => void;
		onhover: (key: string | null) => void;
	}

	let { swatches, focused, ontoggle, onclear, onhover }: Props = $props();
</script>

<section class="legend" aria-label="Epics">
	<header>
		<h2>Epics</h2>
		{#if focused.size > 0}
			<button class="link" onclick={onclear}>Show all</button>
		{/if}
	</header>
	<p class="help">Click to focus one or more epics. Others fade out.</p>
	<ul>
		{#each swatches as s (s.key)}
			<li>
				<button
					class="item"
					class:off={focused.size > 0 && !focused.has(s.key)}
					aria-pressed={focused.has(s.key)}
					title={s.epicId !== null ? `Epic id ${s.epicId}` : undefined}
					onclick={() => ontoggle(s.key)}
					onmouseenter={() => onhover(s.key)}
					onmouseleave={() => onhover(null)}
					onfocus={() => onhover(s.key)}
					onblur={() => onhover(null)}
				>
					<span class="chip" class:other={s.slot === 'other'} style="background: {slotVar(s.slot)}"></span>
					<span class="name">{s.title}</span>
					<span class="count">{s.count}</span>
				</button>
			</li>
		{/each}
	</ul>
</section>

<style>
	.legend {
		background: var(--surface-1);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 14px 14px 10px;
	}
	header {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	h2 {
		margin: 0;
		font-size: 15px;
	}
	.help {
		margin: 2px 0 10px;
		font-size: 12px;
		color: var(--text-muted);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.item {
		display: grid;
		grid-template-columns: 14px 1fr auto;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 6px 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
	}
	.item:hover,
	.item[aria-pressed='true'] {
		background: var(--surface-2);
	}
	.item.off {
		opacity: 0.45;
	}
	.chip {
		width: 14px;
		height: 14px;
		border-radius: 50%;
	}
	.chip.other {
		outline: 1.5px dashed var(--text-muted);
		outline-offset: 1px;
	}
	.name {
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
		font-size: 13px;
	}
	.link {
		border: 0;
		background: none;
		color: var(--accent);
		cursor: pointer;
		padding: 0;
		font-size: 13px;
	}
</style>
