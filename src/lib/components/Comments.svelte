<script lang="ts">
	import { getBoard } from '$lib/client/board.svelte';
	import { getUi } from '$lib/client/ui.svelte';
	import { COMMENT_MAX, type Comment, type CommentThread } from '$lib/comments';
	import type { WorkItem } from '$lib/fields/types';
	import Avatar from './ui/Avatar.svelte';

	/**
	 * An issue's or epic's comments (GitLab notes), under the description: threads oldest first,
	 * replies indented, and a box to add a comment or reply. Loaded when shown, from GitLab with the
	 * viewer's own token. Bodies are GitLab Markdown shown as plain text, never as HTML.
	 * Not shown on the read-only kiosk.
	 */
	let { item }: { item: WorkItem } = $props();
	const board = getBoard();
	const ui = getUi();

	type Load = { kind: 'loading' } | { kind: 'error'; error: string } | { kind: 'ready'; threads: CommentThread[]; more: boolean };
	let st = $state<Load>({ kind: 'loading' });
	let text = $state('');
	let saving = $state(false);
	/** The thread a reply is being written to, and its text */
	let replyTo = $state<string | null>(null);
	let replyText = $state('');
	let replyArea: HTMLTextAreaElement | undefined = $state();

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
		saving = true;
		const r = await board.addComment(item.id, body);
		saving = false;
		if (!r.ok) return ui.toast(r.error, 'error');
		text = '';
		added(r.comment, r.discussionId);
	}

	async function submitReply(threadId: string) {
		const body = replyText.trim();
		if (!body || saving) return;
		saving = true;
		const r = await board.addComment(item.id, body, threadId);
		saving = false;
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

	/** ⌘/Ctrl+Enter sends; Esc leaves the box (and closes an empty reply) without closing the panel. */
	function keys(e: KeyboardEvent, send: () => void, reply = false) {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			send();
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			e.preventDefault();
			(e.currentTarget as HTMLElement).blur();
			if (reply && !replyText.trim()) replyTo = null;
		}
	}

	/**
	 * The board escapes quick actions it sends (`\/close`, see neutralizeQuickActions); GitLab's own
	 * Markdown shows them as `/close`, so show them that way here too.
	 */
	const shown = (body: string) => body.replace(/^( {0,3})\\\//gm, '$1/');

	function when(iso: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		const mins = Math.round((Date.now() - d.getTime()) / 60_000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins} min ago`;
		if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
		if (mins < 60 * 24 * 7) return `${Math.round(mins / 1440)} d ago`;
		return iso.slice(0, 10);
	}
</script>

{#snippet one(c: Comment)}
	<div class="comment">
		{#if c.author}<Avatar name={c.author.name} id={c.author.id} size={22} />{:else}<span class="anon" aria-hidden="true"></span>{/if}
		<div class="content">
			<div class="meta">
				<strong>{c.author?.name ?? 'Unknown'}</strong>
				<time datetime={c.createdAt} title={c.createdAt.slice(0, 16).replace('T', ' ') + ' UTC'}>{when(c.createdAt)}</time>
				{#if c.internal}<span class="internal" title="Internal note: only project members with Reporter access or more see it">Internal</span>{/if}
			</div>
			<div class="body">{shown(c.body)}</div>
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
								onkeydown={(e) => keys(e, () => submitReply(t.id), true)}
							></textarea>
							<div class="bar">
								<button type="button" class="btn small" onclick={() => (replyTo = null)} disabled={saving}>Cancel</button>
								<button type="button" class="btn small primary" onclick={() => submitReply(t.id)} disabled={saving || !replyText.trim()}>
									{saving ? 'Sending…' : 'Reply'}
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
				<button type="button" class="btn small primary" onclick={submit} disabled={saving || !text.trim()}>{saving && !replyTo ? 'Sending…' : 'Comment'}</button>
			</div>
		</div>
	{/if}
</section>

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
	}
	.meta time {
		color: var(--text-muted);
	}
	.internal {
		font-size: 11px;
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
		color: var(--text-secondary);
	}
	.body {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font-size: 13.5px;
		line-height: 1.5;
		margin-top: 2px;
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
