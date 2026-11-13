<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { descriptionDrafts } from '$lib/client/drafts';
	import type { WorkItem } from '$lib/fields/types';

	/**
	 * The side panel's description: the read view (from DetailPanel) plus an editor for the full
	 * Markdown. The board only holds a shortened plain-text copy, so editing first loads the real
	 * text from GitLab. Saving is explicit (button or ⌘/Ctrl+Enter), never on blur: a long text
	 * shouldn't be saved by a stray click. A draft survives switching issues (see drafts.ts).
	 */
	let { item, read }: { item: WorkItem; read: Snippet } = $props();
	const board = getBoard();
	const ui = getUi();

	type State =
		| { kind: 'view' }
		| { kind: 'loading' }
		| { kind: 'editing'; original: string; version: string; saving: boolean; error: string | null; conflict: boolean; note: string | null };
	let st = $state<State>({ kind: 'view' });
	let text = $state('');
	let area: HTMLTextAreaElement | undefined = $state();

	const draft = $derived(descriptionDrafts.get(item.id));
	const dirty = $derived(st.kind === 'editing' && text !== st.original);
	const rows = $derived(Math.min(24, Math.max(6, text.split('\n').length + 1)));
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

	async function start() {
		if (ui.readOnly || st.kind !== 'view') return;
		st = { kind: 'loading' };
		const r = await board.loadDescription(item.id);
		if (!r.ok) {
			st = { kind: 'view' };
			ui.toast(r.error, 'error');
			return;
		}
		if (!r.editable) {
			st = { kind: 'view' };
			ui.toast('This description is too long to edit on the board. Edit it in GitLab.', 'error');
			return;
		}
		const d = descriptionDrafts.get(item.id);
		let note: string | null = null;
		if (d && d.text !== r.description) {
			text = d.text;
			note =
				d.version === r.version
					? 'Restored your unsaved changes.'
					: 'Restored your unsaved changes. The description has changed in GitLab since you started: check them before saving.';
		} else {
			text = r.description;
		}
		// After a restore over a newer GitLab text, the user has been told: saving goes against the new version.
		st = { kind: 'editing', original: r.description, version: r.version, saving: false, error: null, conflict: false, note };
		queueMicrotask(() => area?.focus());
	}

	function onInput() {
		if (st.kind !== 'editing') return;
		if (text === st.original) descriptionDrafts.delete(item.id);
		else descriptionDrafts.set(item.id, { text, version: st.version });
	}

	function cancel() {
		if (st.kind !== 'editing') return;
		if (dirty && !confirm('Discard your changes to the description?')) return;
		descriptionDrafts.delete(item.id);
		st = { kind: 'view' };
	}

	async function save() {
		if (st.kind !== 'editing' || st.saving) return;
		if (!dirty) {
			descriptionDrafts.delete(item.id);
			st = { kind: 'view' };
			return;
		}
		const cur = st;
		st = { ...cur, saving: true, error: null };
		const r = await board.updateDescription(item.id, text, cur.version);
		if (r.ok) {
			descriptionDrafts.delete(item.id);
			st = { kind: 'view' };
			ui.toast('Description saved');
			return;
		}
		st = { ...cur, saving: false, error: r.error, conflict: r.conflict };
	}

	/** After a conflict: take GitLab's current text and drop what was typed (asked first). */
	async function loadLatest() {
		if (!confirm("Replace your text with the description that's in GitLab now? Your changes will be lost.")) return;
		descriptionDrafts.delete(item.id);
		st = { kind: 'view' };
		await start();
	}

	async function copyText() {
		try {
			await navigator.clipboard.writeText(text);
			ui.toast('Your text is copied');
		} catch {
			area?.select();
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Never let Escape close the panel from here
			e.preventDefault();
			e.stopPropagation();
			cancel();
		} else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			save();
		}
	}

	// A reload or closing the tab would lose the text: let the browser ask first
	$effect(() => {
		if (!dirty) return;
		const warn = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});
</script>

{#if st.kind === 'editing'}
	<div class="editor">
		{#if st.note}<p class="note" role="status">{st.note}</p>{/if}
		<textarea
			bind:this={area}
			bind:value={text}
			oninput={onInput}
			onkeydown={onKey}
			{rows}
			class="input"
			aria-label="Description (Markdown)"
			spellcheck="true"
			disabled={st.saving}
		></textarea>
		{#if st.error}
			<div class="error" role="alert">
				<p>{st.error}</p>
				{#if st.conflict}
					<div class="row">
						<button type="button" class="btn small" onclick={copyText}>Copy my text</button>
						<button type="button" class="btn small" onclick={loadLatest}>Load the latest from GitLab</button>
						{#if item.url}<a class="btn small ghost" href={item.url} target="_blank" rel="noopener noreferrer">Open in GitLab ↗</a>{/if}
					</div>
				{/if}
			</div>
		{/if}
		<div class="bar">
			<span class="hint">Markdown · <kbd>{mac ? '⌘' : 'Ctrl'}</kbd> <kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels</span>
			<button type="button" class="btn small" onclick={cancel} disabled={st.saving}>Cancel</button>
			<button type="button" class="btn small primary" onclick={save} disabled={st.saving || st.conflict}>
				{st.saving ? 'Saving…' : 'Save'}
			</button>
		</div>
	</div>
{:else}
	<div class="viewer">
		{@render read()}
		{#if !ui.readOnly}
			<div class="actions">
				<button type="button" class="btn small ghost" onclick={start} disabled={st.kind === 'loading'}>
					{st.kind === 'loading' ? 'Loading…' : item.description ? 'Edit description' : 'Add a description'}
				</button>
				{#if draft}<span class="draft" title="You have unsaved changes to this description">Unsaved draft</span>{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.editor {
		border-top: 1px solid var(--grid);
		padding-top: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		resize: vertical;
		min-height: 120px;
		font-family: var(--mono);
		font-size: 13px;
		line-height: 1.5;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.hint {
		margin-right: auto;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.note {
		margin: 0;
		font-size: 12.5px;
		color: var(--text-secondary);
	}
	.error {
		font-size: 13px;
		color: var(--danger);
	}
	.error p {
		margin: 0 0 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: -2px;
	}
	.draft {
		font-size: 12px;
		color: var(--text-muted);
	}
</style>
