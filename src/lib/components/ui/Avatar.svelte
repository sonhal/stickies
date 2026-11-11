<script lang="ts">
	/** Initials, never a remote image (CSP: img-src self). Color from the id, stable. */
	let { name, id, size = 20 }: { name: string; id: string; size?: number } = $props();
	const initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((p) => p[0]?.toUpperCase() ?? '')
			.join('') || '?'
	);
	const slot = $derived(([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 8) + 1);
</script>

<span
	class="avatar"
	title={name}
	style="--a: var(--series-{slot}); --a-ink: var(--series-{slot}-ink); width: {size}px; height: {size}px; font-size: {Math.round(size * 0.45)}px"
	>{initials}</span
>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		border-radius: 50%;
		background: var(--a);
		color: var(--a-ink);
		font-weight: 650;
		letter-spacing: 0.02em;
		flex: none;
		line-height: 1;
	}
</style>
