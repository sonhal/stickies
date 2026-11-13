<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import type { WorkItem } from '$lib/fields/types';
	import { issuePath, issueUrl } from '$lib/client/urlState';
	import { childTypesOf } from '$lib/fields/registry';
	import Popover from './ui/Popover.svelte';
	import DetailPanel from './DetailPanel.svelte';
	import FieldEditor from './FieldEditor.svelte';
	import DescriptionEditor from './DescriptionEditor.svelte';

	/**
	 * The detail panel with inline editing and a conflict notice. `page` draws it as the full
	 * issue page (/issue/<id>): parents and sub-issues are links there, and it has no close button.
	 */
	interface Props {
		item: WorkItem;
		onclose?: () => void;
		page?: boolean;
		/** Page only: the breadcrumb bar (see DetailPanel) */
		bar?: Snippet<[WorkItem]>;
		/** Page only: show the Properties column */
		showProps?: boolean;
	}
	let { item, onclose, page = false, bar, showProps = true }: Props = $props();
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

	/**
	 * Create a child of `type` under `parent`. An epic lives in the group (no project); an issue
	 * under an epic needs a project picked; a task goes in its issue's project.
	 */
	function addChild(parent: WorkItem, type: string) {
		const groupLevel = type.toLowerCase() === 'epic' || parent.type.toLowerCase() === 'epic';
		ui.createOpen = { parentId: parent.id, type, projectId: groupLevel ? undefined : (parent.projectId ?? undefined) };
	}

	/** A link to the item's full page (keeping ?sidebar=hidden when it's in the URL). */
	const copyLink = (i: WorkItem) => ui.copy(issueUrl(i.id, new URL(location.href)), `Link to ${i.ref} copied`);
</script>

{#if changedElsewhere}
	<div class="conflict" role="status">
		Updated by someone else since you opened it. You're seeing the latest version.
		<button type="button" class="btn small" onclick={() => (baseline = { id: item.id, at: item.updatedAt })}>OK</button>
	</div>
{/if}

<DetailPanel
	{item}
	{onclose}
	{page}
	onopen={(id) => ui.open(id)}
	hrefFor={page ? issuePath : undefined}
	pageHref={page ? undefined : issuePath(item.id)}
	onpage={() => ui.close()}
	{bar}
	{showProps}
>
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
			<h2 class="title" class:big={page}>{i.title}</h2>
		{:else}
			<h2 class="title" class:big={page}><button type="button" class="title-btn" title="Edit title" onclick={startTitle}>{i.title}</button></h2>
		{/if}
	{/snippet}
	{#snippet childAction(i)}
		<!-- What GitLab allows under this type: an epic holds epics and issues, an issue holds tasks, a task nothing -->
		{@const allowed = childTypesOf(board.reg, i.type)}
		{#if !ui.readOnly && allowed.length === 1}
			<button type="button" class="btn ghost small" onclick={() => addChild(i, allowed[0])}>+ Add {allowed[0].toLowerCase()}</button>
		{:else if !ui.readOnly && allowed.length > 1}
			<Popover label="Add child item" triggerClass="btn ghost small" width="180px">
				{#snippet trigger()}+ Add child item{/snippet}
				{#snippet children(close)}
					<div class="menu">
						{#each allowed as t (t)}
							<button type="button" class="menu-item" onclick={() => (close(), addChild(i, t))}>{t}</button>
						{/each}
					</div>
				{/snippet}
			</Popover>
		{/if}
	{/snippet}
	{#snippet value(f, i)}<FieldEditor key={f.key} item={i} />{/snippet}
	{#snippet description(i, read)}{#key i.id}<DescriptionEditor item={i} {read} />{/key}{/snippet}
	{#snippet propsActions(i)}
		<!-- As in Linear's Properties header: copy the link, copy the ID -->
		<button type="button" class="btn ghost small icon" onclick={() => copyLink(i)} title="Copy link" aria-label="Copy link">
			<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"
				><path d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.8 2.8 0 014 4L11 8.5M9 11.5l-1.2 1.2a2.8 2.8 0 01-4-4L5 7.5" /></svg
			>
		</button>
		<button type="button" class="btn ghost small icon" onclick={() => ui.copy(i.ref, `Copied ${i.ref}`)} title="Copy ID ({i.ref})" aria-label="Copy ID">
			<span class="mono-id" aria-hidden="true">#</span>
		</button>
	{/snippet}
	{#snippet actions(i)}
		{#if !page}
		<div class="item-actions">
			<button type="button" class="btn ghost small" title="Copy a link to the full page for this {i.type.toLowerCase()}" onclick={() => copyLink(i)}>Copy link</button>
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
		{/if}
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
	.icon {
		width: 28px;
		padding: 0;
		justify-content: center;
	}
	.mono-id {
		font-family: var(--mono);
		font-size: 13px;
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
	/* Full page: a larger title, like Linear's issue view */
	.title.big {
		font-size: 24px;
		line-height: 1.25;
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
