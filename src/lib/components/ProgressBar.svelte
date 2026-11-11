<script lang="ts">
	import { pct, type Progress } from '$lib/query/epics';
	let { p, wide = false }: { p: Progress; wide?: boolean } = $props();
	const v = $derived(pct(p));
	const title = $derived(
		`${p.closed} of ${p.total} closed (${p.source === 'gitlab' ? 'all child items, from GitLab' : 'children on this board'})`
	);
</script>

<span class="pb" class:wide {title}>
	<span class="track" role="progressbar" aria-valuenow={v} aria-valuemin="0" aria-valuemax="100" aria-label={title}><span class="fill" style="width: {v}%"></span></span>
	<span class="txt">{v}%</span>
</span>

<style>
	.pb {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 120px;
	}
	.track {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--grid);
		overflow: hidden;
		min-width: 60px;
	}
	.wide .track {
		height: 8px;
	}
	.fill {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	.txt {
		font-size: 12px;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
		min-width: 34px;
		text-align: right;
	}
</style>
