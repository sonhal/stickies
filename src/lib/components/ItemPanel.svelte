<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import type { WorkItem } from '$lib/fields/types';
	import { ISSUE_PARAM, itemParam } from '$lib/client/urlState';
	import DetailPanel from './DetailPanel.svelte';
	import FieldEditor from './FieldEditor.svelte';
	import DescriptionEditor from './DescriptionEditor.svelte';

	/** The detail panel with inline editing and a conflict notice. */
	let { item, onclose }: { item: WorkItem; onclose: () => void } = $props();
	const board = getBoard();
	const ui = getUi();
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

	// "Updated by someone else": the item changed after the panel opened, and not by our own write.
	let baseline = $state<{ id: string; at: string } | null>(null);
	$effect(() => {
		if (!baseline || baseline.id !== item.id) baseline = { id: item.id, at: item.updatedAt };
	});
	const changedElsewhere = $derived(
		!!baseline &&
			baseline.id === item.id &&
			item.updatedAt > baseline.at &&
			board.ownWrites.get(item.id) !== item.updatedAt &&
			!board.pending.has(item.id)
	);

	let editingTitle = $state(false);
	let titleDraft = $state('');
	function startTitle() {
		if (ui.readOnly) return;
		titleDraft = item.title;
		editingTitle = true;
	}
	function saveTitle() {
		// Escape closes the editor first; removing the focused textarea then fires blur, which
		// must not save (review M1). Enter also reaches here twice (submit, then blur).
		if (!editingTitle) return;
		editingTitle = false;
		const t = titleDraft.trim();
		if (t && t !== item.title) board.update(item.id, 'title', t);
	}

	/** A link to this page with this item open (and the sidebar as it is now). */
	async function copyLink(i: WorkItem) {
		const url = new URL(location.href);
		url.searchParams.set(ISSUE_PARAM, itemParam(i.id));
		try {
			await navigator.clipboard.writeText(url.href);
			ui.toast(`Link to ${i.ref} copied`);
		} catch {
			window.prompt('Copy this link', url.href);
		}
	}
</script>

{#if changedElsewhere}
	<div class="conflict" role="status">
		Updated by someone else since you opened it. You're seeing the latest version.
		<button type="button" class="btn small" onclick={() => (baseline = { id: item.id, at: item.updatedAt })}>OK</button>
	</div>
{/if}

<DetailPanel {item} {onclose} onopen={(id) => ui.open(id)}>
	{#snippet title(i)}
		{#if editingTitle}
			<form
				onsubmit={(e) => {
					e.preventDefault();
					saveTitle();
				}}
			>
				<!-- svelte-ignore a11y_autofocus -->
				<textarea
					class="title-input"
					bind:value={titleDraft}
					maxlength="255"
					rows="2"
					autofocus
					aria-label="Title"
					onblur={saveTitle}
					onkeydown={(e) => {
						if (e.key === 'Enter') {
							e.preventDefault();
							saveTitle();
						} else if (e.key === 'Escape') {
							e.stopPropagation();
							editingTitle = false;
						}
					}}
				></textarea>
			</form>
		{:else if ui.readOnly}
			<h2 class="title">{i.title}</h2>
		{:else}
			<h2 class="title"><button type="button" class="title-btn" title="Edit title" onclick={startTitle}>{i.title}</button></h2>
		{/if}
	{/snippet}
	{#snippet value(f, i)}<FieldEditor key={f.key} item={i} />{/snippet}
	{#snippet description(i, read)}{#key i.id}<DescriptionEditor item={i} {read} />{/key}{/snippet}
	{#snippet actions(i)}
		<div class="item-actions">
			<button type="button" class="btn ghost small" title="Copy a link that opens this page with this {i.type.toLowerCase()} open" onclick={() => copyLink(i)}>Copy link</button>
			<!-- Only when GitLab says this viewer may delete it: no dead button for everyone else. -->
			{#if !ui.readOnly && i.canDelete}
				<button
					type="button"
					class="btn ghost small danger"
					title="Delete in GitLab ({mac ? '⌘' : 'Ctrl'}+Backspace)"
					disabled={board.pending.has(i.id)}
					onclick={() => (ui.deleteRequest = i.id)}>Delete {i.type.toLowerCase() === 'epic' ? 'epic' : 'issue'}…</button
				>
			{/if}
		</div>
	{/snippet}
</DetailPanel>

<style>
	.item-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		border-top: 1px solid var(--grid);
		padding-top: 10px;
	}
	/* Line the first label up with the panel's text, not the button's padding */
	.item-actions .btn:first-child {
		margin-left: -7px;
	}
	.conflict {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 12px 18px 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: var(--warning-bg);
		font-size: 13px;
	}
	.title {
		margin: 0;
		font-size: 19px;
		line-height: 1.3;
	}
	.title-btn {
		all: unset;
		cursor: text;
		overflow-wrap: anywhere;
		border-radius: 4px;
	}
	.title-btn:hover {
		background: var(--hover);
	}
	.title-btn:focus-visible {
		outline: 2px solid var(--accent);
	}
	.title-input {
		width: 100%;
		font-size: 18px;
		font-weight: 650;
		line-height: 1.3;
		padding: 4px 6px;
		border: 1px solid var(--accent);
		border-radius: 6px;
		background: var(--surface-2);
		resize: vertical;
	}
</style>
