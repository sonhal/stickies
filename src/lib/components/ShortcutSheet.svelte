<script lang="ts">
	import { keyCaps, shortcutGroups } from '$lib/client/shortcuts';

	let { readOnly, onclose }: { readOnly: boolean; onclose: () => void } = $props();

	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const groups = $derived(shortcutGroups(readOnly));
	let dialog: HTMLElement | undefined = $state();
	const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;

	$effect(() => {
		dialog?.focus();
		return () => opener?.focus?.();
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' || e.key === '?') {
			e.preventDefault();
			e.stopPropagation();
			onclose();
		} else if (e.key === 'Tab') {
			// Keep focus inside while the sheet is open: the close button is the only control.
			e.preventDefault();
			dialog?.querySelector<HTMLElement>('.close')?.focus();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="shortcut-title" tabindex="-1" bind:this={dialog} onkeydown={onKey}>
	<header>
		<h2 id="shortcut-title">Keyboard shortcuts</h2>
		<button type="button" class="close" aria-label="Close" onclick={onclose}>×</button>
	</header>
	<div class="body">
		{#each groups as g (g.group)}
			<section>
				<h3 class="menu-label">{g.group}</h3>
				<dl>
					{#each g.items as s (s.label)}
						<div class="row">
							<dt>{s.label}{#if s.note}<span class="note">{s.note}</span>{/if}</dt>
							<dd>
								{#each s.keys as combo, ci (combo)}
									{#if ci > 0}<span class="or">or</span>{/if}
									<span class="combo">
										{#each keyCaps(combo, mac) as chord, i (i)}
											{#if i > 0}<span class="then">then</span>{/if}
											{#each chord as k, j (j)}<kbd>{k}</kbd>{/each}
										{/each}
									</span>
								{/each}
							</dd>
						</div>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
	<footer>Shortcuts don't fire while you type in a field. <kbd>Esc</kbd> to close</footer>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		background: var(--overlay);
		z-index: 50;
	}
	.sheet {
		position: fixed;
		top: 8vh;
		left: 50%;
		transform: translateX(-50%);
		width: min(820px, calc(100vw - 24px));
		max-height: 84vh;
		z-index: 51;
		display: flex;
		flex-direction: column;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: 12px;
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		outline: none;
	}
	header {
		display: flex;
		align-items: center;
		padding: 12px 12px 12px 18px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}
	.close {
		margin-left: auto;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: var(--text-muted);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
	}
	.close:hover,
	.close:focus-visible {
		background: var(--hover);
		color: var(--text-primary);
	}
	.body {
		overflow-y: auto;
		padding: 6px 18px 14px;
		columns: 2 340px;
		column-gap: 28px;
	}
	section {
		break-inside: avoid;
		padding-top: 8px;
	}
	h3 {
		margin: 0;
		padding-left: 0;
	}
	dl {
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 28px;
		padding: 3px 0;
		border-bottom: 1px solid var(--grid);
		font-size: 13px;
	}
	.row:last-child {
		border-bottom: 0;
	}
	dt {
		color: var(--text-primary);
	}
	.note {
		margin-left: 6px;
		font-size: 12px;
		color: var(--text-muted);
	}
	dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: 4px;
		flex: none;
		max-width: 55%;
	}
	.combo {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		white-space: nowrap;
	}
	.or,
	.then {
		font-size: 11px;
		color: var(--text-muted);
	}
	.then {
		margin: 0 2px;
	}
	footer {
		padding: 8px 18px;
		border-top: 1px solid var(--grid);
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
