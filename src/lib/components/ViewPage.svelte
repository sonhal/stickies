<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getViews } from '$lib/client/views-context';
	import { getUi } from '$lib/client/ui.svelte';
	import { decodeView, encodeView } from '$lib/client/share';
	import type { ViewDefinition, ViewScope } from '$lib/query/types';
	import Workspace from './Workspace.svelte';
	import Popover from './ui/Popover.svelte';

	/**
	 * Resolves which view to show: a config or personal view by id, plus unsaved changes from ?v=.
	 * An unknown id with a valid ?v= is a shared link ("Save to my views").
	 */
	interface Props {
		viewId: string | null;
		scope?: ViewScope;
		heading?: string;
		subheading?: string;
	}
	let { viewId, scope, heading, subheading }: Props = $props();
	const views = getViews();
	const ui = getUi();

	const base = $derived(viewId ? views.find(viewId) : (views.all[0] ?? null));
	const draft = $derived(decodeView(page.url.searchParams.get('v')));
	const shared = $derived(!base && !!draft);
	const view = $derived(base ? (draft ? { ...draft, id: base.id } : base) : draft);
	const personal = $derived(!!base && views.isPersonal(base.id));
	const canSave = $derived(views.canSave && !ui.readOnly);

	let renaming = $state(false);
	let newName = $state('');
	let fileInput: HTMLInputElement | undefined = $state();

	const clean = () => goto(page.url.pathname, { replaceState: true, keepFocus: true, noScroll: true });

	function saveNew(v: ViewDefinition, name: string) {
		const saved = views.add({ ...v, scope: v.scope }, name);
		if (!views.writable) ui.toast("Views can't be saved in this browser (storage is blocked or full).", 'error');
		else ui.toast(`Saved "${saved.name}" to your views`);
		goto(`/v/${saved.id}`);
	}

	function save() {
		if (!view || !personal) return;
		views.update(view);
		if (!views.writable) ui.toast("Views can't be saved in this browser (storage is blocked or full).", 'error');
		else ui.toast('View saved');
		clean();
	}

	async function copyLink() {
		if (!view) return;
		const path = personal || shared ? '/v/shared' : `/v/${view.id}`;
		const url = `${page.url.origin}${path}?v=${encodeView(view)}`;
		try {
			await navigator.clipboard.writeText(url);
			ui.toast('Link copied. Anyone with access to the board can open it.');
		} catch {
			window.prompt('Copy this link', url);
		}
	}

	function download(name: string, text: string) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	async function importFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 512_000) {
			ui.toast('That file is too large to be a views export.', 'error');
			return;
		}
		const { added, skipped } = views.importJson(await file.text());
		ui.toast(`Imported ${added} view${added === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} invalid` : ''}`, added ? 'info' : 'error');
		(e.currentTarget as HTMLInputElement).value = '';
	}

	function remove(close: () => void) {
		if (!base || !personal) return;
		if (!confirm(`Delete the view "${base.name}"? This can't be undone.`)) return;
		views.remove(base.id);
		close();
		ui.toast('View deleted');
		goto('/');
	}
</script>

<svelte:head>
	<title>{heading ?? view?.name ?? 'View'} · Board</title>
</svelte:head>

{#snippet actions()}
	{#if canSave && view}
		{#if shared}
			<button type="button" class="btn primary" onclick={() => saveNew(view, view.name)}>Save to my views</button>
		{:else if draft}
			<button type="button" class="btn ghost" onclick={clean}>Reset</button>
			{#if personal}<button type="button" class="btn primary" onclick={save}>Save</button>{/if}
			<button type="button" class={personal ? 'btn' : 'btn primary'} onclick={() => saveNew(view, `${view.name} (copy)`)}>Save as new view</button>
		{/if}
		<Popover label="View actions" triggerClass="btn ghost" triggerTitle="View actions" align="right" width="240px">
			{#snippet trigger()}<span aria-label="View actions">•••</span>{/snippet}
			{#snippet children(close)}
				<div class="menu">
					{#if renaming && base}
						<form
							class="rename"
							onsubmit={(e) => {
								e.preventDefault();
								views.rename(base.id, newName);
								renaming = false;
								close();
							}}
						>
							<!-- svelte-ignore a11y_autofocus -->
							<input class="input" bind:value={newName} maxlength="100" autofocus aria-label="View name" />
							<button class="btn primary small">Rename</button>
						</form>
					{:else}
						<button type="button" class="menu-item" onclick={() => (close(), saveNew(view, `${view.name} (copy)`))}>Duplicate</button>
						{#if personal && base}
							<button type="button" class="menu-item" onclick={() => ((newName = base.name), (renaming = true))}>Rename…</button>
						{/if}
						{#if base}
							<button type="button" class="menu-item" onclick={() => views.move(base.id, -1)}>Move up in sidebar</button>
							<button type="button" class="menu-item" onclick={() => views.move(base.id, 1)}>Move down in sidebar</button>
						{/if}
						<button type="button" class="menu-item" onclick={() => (close(), copyLink())}>Copy share link</button>
						<button type="button" class="menu-item" onclick={() => (close(), download(`view-${view.id}.json`, JSON.stringify({ format: 'board-views', version: 1, views: [view] }, null, 2)))}>Export this view (JSON)</button>
						<button type="button" class="menu-item" onclick={() => (close(), download('board-views.json', views.exportJson()))}>Export all views (JSON)</button>
						<button type="button" class="menu-item" onclick={() => (close(), fileInput?.click())}>Import views…</button>
						{#if personal}
							<button type="button" class="menu-item danger" onclick={() => remove(close)}>Delete view</button>
						{/if}
					{/if}
				</div>
			{/snippet}
		</Popover>
		<input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={importFile} />
	{/if}
{/snippet}

{#if view}
	<Workspace
		{view}
		{scope}
		heading={heading ?? view.name}
		subheading={subheading ?? (shared ? 'shared view' : undefined)}
		dirty={!!draft && !!base}
		{actions}
	/>
{:else if !views.loaded}
	<p class="muted pad">Loading view…</p>
{:else}
	<div class="pad">
		<h1>View not found</h1>
		<p class="muted">It may have been deleted, or it was saved in another browser.</p>
		<a class="btn" href="/">Go to the first view</a>
	</div>
{/if}

<style>
	.pad {
		padding: 24px;
	}
	.rename {
		display: flex;
		gap: 6px;
		padding: 4px;
	}
	.rename .input {
		flex: 1;
	}
	.danger {
		color: var(--danger);
	}
</style>
