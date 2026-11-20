<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { renderMarkdown } from '$lib/client/markdown';
	import { COMMENT_MAX, type Comment, type CommentThread } from '$lib/comments';
	import type { WorkItem } from '$lib/fields/types';
	import Avatar from './ui/Avatar.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';

	/**
	 * An issue's or epic's comments (GitLab notes), under the description: threads oldest first,
	 * replies indented, and a box to add a comment or reply. Comments GitLab lets the viewer change
	 * (their own, or as a maintainer) can be edited and deleted. Loaded when shown, from GitLab with
	 * the viewer's own token. Bodies are GitLab Markdown, rendered through a sanitizer
	 * (src/lib/client/markdown.ts). The kiosk only reads, and never sees internal notes.
	 */
	let { item }: { item: WorkItem } = $props();
	const board = getBoard();
	const ui = getUi();

	type Load = { kind: 'loading' } | { kind: 'error'; error: string } | { kind: 'ready'; threads: CommentThread[]; more: boolean };
	let st = $state<Load>({ kind: 'loading' });
	let text = $state('');
	/** What is being saved: the new comment box, a reply, or a comment's edit */
	let saving = $state<'new' | 'reply' | 'edit' | null>(null);
	/** The thread a reply is being written to, and its text */
	let replyTo = $state<string | null>(null);
	let replyText = $state('');
	let replyArea: HTMLTextAreaElement | undefined = $state();
	/** The comment being edited, and its text */
	let editing = $state<string | null>(null);
	let editText = $state('');
	let editArea: HTMLTextAreaElement | undefined = $state();
	/** The comment waiting for "Delete?" to be confirmed */
	let deleting = $state<Comment | null>(null);
	let deleteBusy = $state(false);

	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
	const count = $derived(st.kind === 'ready' ? st.threads.reduce((n, t) => n + t.comments.length, 0) : 0);

	async function load() {
		const id = item.id;
		st = { kind: 'loading' };
		const r = await board.loadComments(id);
		if (id !== item.id) return;
		st = r.ok ? { kind: 'ready', threads: r.threads, more: r.more } : { kind: 'error', error: r.error };
	}
	$effect(() => {
		void item.id;
		load();
	});

	function added(comment: Comment, discussionId: string) {
		if (st.kind !== 'ready') return;
		const t = st.threads.find((x) => x.id === discussionId);
		if (t) t.comments.push(comment);
		else st.threads.push({ id: discussionId, comments: [comment] });
	}

	async function submit() {
		const body = text.trim();
		if (!body || saving) return;
		saving = 'new';
		const r = await board.addComment(item.id, body);
		saving = null;
		if (!r.ok) return ui.toast(r.error, 'error');
		text = '';
		added(r.comment, r.discussionId);
	}

	async function submitReply(threadId: string) {
		const body = replyText.trim();
		if (!body || saving) return;
		saving = 'reply';
		const r = await board.addComment(item.id, body, threadId);
		saving = null;
		if (!r.ok) return ui.toast(r.error, 'error');
		replyText = '';
		replyTo = null;
		added(r.comment, r.discussionId);
	}

	function startReply(threadId: string) {
		if (replyTo !== threadId) replyText = '';
		replyTo = threadId;
		queueMicrotask(() => replyArea?.focus());
	}

	/** The text as the editor shows it: the board's own "\/" escapes (quick actions) come back as "/" */
	const editable = (body: string) => body.replace(/^( {0,3})\\\//gm, '$1/');

	function startEdit(c: Comment) {
		editing = c.id;
		editText = editable(c.body);
		queueMicrotask(() => editArea?.focus());
	}

	async function saveEdit(c: Comment) {
		const body = editText.trim();
		if (!body || saving) return;
		if (body === editable(c.body).trim()) {
			editing = null;
			return;
		}
		saving = 'edit';
		const r = await board.editComment(item.id, c.id, body);
		saving = null;
		if (!r.ok) return ui.toast(r.error, 'error');
		if (st.kind === 'ready') {
			for (const t of st.threads) {
				const i = t.comments.findIndex((x) => x.id === c.id);
				if (i !== -1) t.comments[i] = r.comment;
			}
		}
		editing = null;
		ui.toast('Comment saved');
	}

	async function confirmDelete() {
		const c = deleting;
		if (!c || deleteBusy) return;
		deleteBusy = true;
		const r = await board.deleteComment(item.id, c.id);
		deleteBusy = false;
		deleting = null;
		if (!r.ok) return ui.toast(r.error, 'error');
		if (st.kind === 'ready') {
			for (const t of st.threads) t.comments = t.comments.filter((x) => x.id !== c.id);
			st.threads = st.threads.filter((t) => t.comments.length);
		}
		ui.toast('Comment deleted');
	}

	/** ⌘/Ctrl+Enter sends; Esc leaves the box (and closes an empty reply or an edit) without closing the panel. */
	function keys(e: KeyboardEvent, send: () => void, onEscape?: () => void) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			e.preventDefault();
			(e.currentTarget as HTMLElement).blur();
			onEscape?.();
		}
	}

	function when(iso: string): string {
		if (!iso) return '';
		const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min ago`;
		if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
		if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} d ago`;
		return iso.slice(0, 10);
	}
	const utc = (iso: string) => iso.slice(0, 16).replace('T', ' ') + ' UTC';
</script>

{#snippet one(c: Comment)}
	<div class="comment">
		{#if c.author}<Avatar name={c.author.name} id={c.author.id} size={22} />{:else}<span class="anon" aria-hidden="true"></span>{/if}
		<div class="content">
			<div class="meta">
				<strong>{c.author?.name ?? 'Unknown'}</strong>
				<time datetime={c.createdAt} title={utc(c.createdAt)}>{when(c.createdAt)}</time>
				{#if c.editedAt}<span class="edited" title="Edited {utc(c.editedAt)}">(edited)</span>{/if}
				{#if c.internal}<span class="internal" title="Internal note: only project members with Reporter access or more see it">Internal</span>{/if}
				{#if !ui.readOnly && c.canEdit && editing !== c.id}
					<span class="tools">
						<button type="button" class="btn ghost small" onclick={() => startEdit(c)} aria-label="Edit comment">Edit</button>
						<button type="button" class="btn ghost small danger" onclick={() => (deleting = c)} aria-label="Delete comment">Delete</button>
					</span>
				{/if}
			</div>
			{#if editing === c.id}
				<div class="compose">
					<textarea
						bind:this={editArea}
						bind:value={editText}
						rows={Math.min(16, Math.max(3, editText.split('\n').length + 1))}
						maxlength={COMMENT_MAX}
						aria-label="Edit comment"
						onkeydown={(e) => keys(e, () => saveEdit(c), () => (editing = null))}
					></textarea>
					<div class="bar">
						<button type="button" class="btn small" onclick={() => (editing = null)} disabled={saving === 'edit'}>Cancel</button>
						<button type="button" class="btn small primary" onclick={() => saveEdit(c)} disabled={!!saving || !editText.trim()}>
							{saving === 'edit' ? 'Saving…' : 'Save'}
						</button>
					</div>
				</div>
			{:else}
				<!-- The board's only {@html}: renderMarkdown sanitizes with DOMPurify (allowlisted tags, safe links only) -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="body md">{@html renderMarkdown(c.body, item.url)}</div>
			{/if}
		</div>
	</div>
{/snippet}

<section class="comments" aria-label="Comments">
	<h3>Comments {#if count}<span class="muted">{count}</span>{/if}</h3>

	{#if st.kind === 'loading'}
		<p class="muted">Loading comments…</p>
	{:else if st.kind === 'error'}
		<p class="muted">{st.error} <button type="button" class="btn ghost small" onclick={load}>Try again</button></p>
	{:else}
		{#each st.threads as t (t.id)}
			<div class="thread">
				{@render one(t.comments[0])}
				{#if t.comments.length > 1}
					<div class="replies">
						{#each t.comments.slice(1) as c (c.id)}{@render one(c)}{/each}
					</div>
				{/if}
				{#if !ui.readOnly}
					{#if replyTo === t.id}
						<div class="compose reply">
							<textarea
								bind:this={replyArea}
								bind:value={replyText}
								rows="2"
								maxlength={COMMENT_MAX}
								placeholder="Reply…"
								aria-label="Reply"
								onkeydown={(e) => keys(e, () => submitReply(t.id), () => !replyText.trim() && (replyTo = null))}
							></textarea>
							<div class="bar">
								<button type="button" class="btn small" onclick={() => (replyTo = null)} disabled={saving === 'reply'}>Cancel</button>
								<button type="button" class="btn small primary" onclick={() => submitReply(t.id)} disabled={!!saving || !replyText.trim()}>
									{saving === 'reply' ? 'Sending…' : 'Reply'}
								</button>
							</div>
						</div>
					{:else}
						<button type="button" class="btn ghost small reply-btn" onclick={() => startReply(t.id)}>Reply</button>
					{/if}
				{/if}
			</div>
		{:else}
			<p class="muted empty">No comments yet.</p>
		{/each}
		{#if st.more && item.url}
			<a class="more" href={item.url} target="_blank" rel="noopener noreferrer">Older comments in GitLab ↗</a>
		{/if}
	{/if}

	{#if !ui.readOnly}
		<div class="compose">
			<textarea
				bind:value={text}
				rows="3"
				maxlength={COMMENT_MAX}
				placeholder="Leave a comment…"
				aria-label="New comment"
				onkeydown={(e) => keys(e, submit)}
			></textarea>
			<div class="bar">
				<span class="hint">Markdown · <kbd>{mac ? '⌘' : 'Ctrl'}</kbd> <kbd>Enter</kbd> sends</span>
				<button type="button" class="btn small primary" onclick={submit} disabled={!!saving || !text.trim()}>{saving === 'new' ? 'Sending…' : 'Comment'}</button>
			</div>
		</div>
	{/if}
</section>

{#if deleting}
	<ConfirmDialog
		heading="Delete comment?"
		message="This deletes the comment in GitLab for everyone. It can't be undone."
		note={st.kind === 'ready' && st.threads.some((t) => t.comments[0].id === deleting?.id && t.comments.length > 1)
			? 'The replies to it stay.'
			: null}
		confirmLabel="Delete comment"
		busyLabel="Deleting…"
		busy={deleteBusy}
		onconfirm={confirmDelete}
		oncancel={() => (deleting = null)}
	/>
{/if}

<style>
	.comments {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 6px;
		padding-top: 12px;
		border-top: 1px solid var(--grid);
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		display: flex;
		gap: 6px;
		align-items: baseline;
	}
	.muted {
		color: var(--text-muted);
		font-size: 13px;
		margin: 0;
	}
	.thread {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-1);
	}
	.replies {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-left: 30px;
		padding-left: 10px;
		border-left: 2px solid var(--grid);
	}
	.comment {
		display: flex;
		gap: 8px;
		min-width: 0;
	}
	.anon {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--grid);
		flex: none;
	}
	.content {
		min-width: 0;
		flex: 1;
	}
	.meta {
		display: flex;
		gap: 8px;
		align-items: baseline;
		font-size: 12.5px;
		min-height: 24px;
	}
	.meta time,
	.edited {
		color: var(--text-muted);
	}
	.internal {
		font-size: 11px;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
		color: var(--text-secondary);
	}
	/* Like Linear: a comment's actions show on hover or keyboard focus */
	.tools {
		margin-left: auto;
		display: flex;
		gap: 2px;
		opacity: 0;
	}
	.comment:hover .tools,
	.tools:focus-within {
		opacity: 1;
	}
	@media (hover: none) {
		.tools {
			opacity: 1;
		}
	}
	.body {
		overflow-wrap: anywhere;
		font-size: 13.5px;
		line-height: 1.5;
		margin-top: 2px;
	}
	/* Rendered Markdown */
	.md :global(:is(p, ul, ol, pre, blockquote, table)) {
		margin: 0 0 6px;
	}
	.md :global(:last-child) {
		margin-bottom: 0;
	}
	.md :global(:is(ul, ol)) {
		padding-left: 20px;
	}
	.md :global(:is(h1, h2, h3, h4, h5, h6)) {
		font-size: 14px;
		margin: 8px 0 4px;
	}
	.md :global(code) {
		font-family: var(--mono);
		font-size: 12.5px;
		background: var(--surface-2);
		border: 1px solid var(--grid);
		border-radius: 4px;
		padding: 0 3px;
	}
	.md :global(pre) {
		background: var(--surface-2);
		border: 1px solid var(--grid);
		border-radius: 6px;
		padding: 8px 10px;
		overflow-x: auto;
	}
	.md :global(pre code) {
		border: 0;
		padding: 0;
		background: none;
	}
	.md :global(blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 10px;
		color: var(--text-secondary);
	}
	.md :global(table) {
		border-collapse: collapse;
		display: block;
		overflow-x: auto;
	}
	.md :global(:is(th, td)) {
		border: 1px solid var(--border);
		padding: 3px 8px;
	}
	.md :global(li:has(> input[type='checkbox'])) {
		list-style: none;
		margin-left: -18px;
	}
	.reply-btn {
		align-self: flex-start;
	}
	.compose {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.compose.reply {
		margin-left: 30px;
	}
	textarea {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-1);
		padding: 8px 10px;
		resize: vertical;
		font: inherit;
		font-size: 13.5px;
		color: var(--text-primary);
	}
	.bar {
		display: flex;
		gap: 8px;
		align-items: center;
		justify-content: flex-end;
	}
	.hint {
		flex: 1;
		font-size: 12px;
		color: var(--text-muted);
	}
	.more {
		font-size: 12.5px;
	}
</style>
