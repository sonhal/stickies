<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getBoard } from '$lib/client/board.svelte';
	import { appliesTo, closedKind } from '$lib/fields/registry';
	import type { FieldDef, WorkItem } from '$lib/fields/types';
	import { slotVar } from '$lib/colors';
	import StatusIcon from './ui/StatusIcon.svelte';

	interface Props {
		item: WorkItem;
		onclose?: () => void;
		onopen?: (id: string) => void;
		/** Renders a field's value (read-only text by default; the editor in Phase 4) */
		value?: Snippet<[FieldDef, WorkItem]>;
		/** Title area (an inline editor in Phase 4) */
		title?: Snippet<[WorkItem]>;
		/**
		 * Item actions drawn at the foot of the panel (e.g. Delete…). Not in the header: at 30vw the
		 * header is already full with the reference and "Open in GitLab".
		 */
		actions?: Snippet<[WorkItem]>;
		compact?: boolean;
	}

	let { item, onclose, onopen, value, title, actions, compact = false }: Props = $props();
	const board = getBoard();

	/** Every field that applies to this item's type, plus any other field it has a value for. */
	const fields = $derived(
		board.reg.fields.filter(
			(f) =>
				!['native:type', 'native:createdAt', 'native:updatedAt'].includes(f.key) &&
				(appliesTo(f, item.type) || item.values[f.key] !== undefined)
		)
	);

	const crumbs = $derived.by(() => {
		const out: WorkItem[] = [];
		let cur = item.parentId ? board.byId.get(item.parentId) : undefined;
		for (let d = 0; cur && d < 6; d++) {
			out.unshift(cur);
			cur = cur.parentId ? board.byId.get(cur.parentId) : undefined;
		}
		return out;
	});
	const children = $derived(board.items.filter((i) => i.parentId === item.id));
	const paragraphs = $derived(item.description ? item.description.split(/\n{2,}/) : []);
	const closed = $derived(closedKind(board.reg, item));
	const updatedLocally = $derived(item.updatedAt);
</script>

<article class="panel" class:compact aria-label="Issue details: {item.title}">
	<header>
		<span class="epic" style="background: {slotVar(board.colors.slotFor(item))}"></span>
		<span class="ref">{item.ref}</span>
		<span class="type">{item.type}</span>
		{#if closed}<span class="closed">{closed === 'done' ? 'Completed' : 'Canceled'}</span>{/if}
		<span class="spacer"></span>
		{#if item.url}
			<a class="btn ghost small" href={item.url} target="_blank" rel="noopener noreferrer">Open in GitLab ↗</a>
		{/if}
		{#if onclose}<button type="button" class="btn ghost small x" onclick={onclose} aria-label="Close panel (Esc)">×</button>{/if}
	</header>

	{#if crumbs.length}
		<nav class="crumbs" aria-label="Parents">
			{#each crumbs as c (c.id)}
				<button type="button" class="crumb" onclick={() => onopen?.(c.id)}>{c.title}</button><span aria-hidden="true">›</span>
			{/each}
		</nav>
	{:else if item.parentId}
		<p class="crumbs muted">Parent: {board.text(item, 'native:parent') || 'not on the board'}</p>
	{/if}

	{#if title}{@render title(item)}{:else}<h2>{item.title}</h2>{/if}

	<dl class="fields">
		{#each fields as f (f.key)}
			<div class="f">
				<dt title={f.rawType ? `Custom field of type ${f.rawType} (shown read-only)` : f.name}>{f.name}</dt>
				<dd>
					{#if value}{@render value(f, item)}{:else}{board.text(item, f.key) || '—'}{/if}
				</dd>
			</div>
		{/each}
	</dl>

	{#if item.progress && item.progress.total > 0}
		{@const pct = Math.round((item.progress.closed / item.progress.total) * 100)}
		<div class="progress" title="{item.progress.closed} of {item.progress.total} child items closed (from GitLab)">
			<div class="bar"><span style="width: {pct}%"></span></div>
			<span>{pct}% · {item.progress.closed}/{item.progress.total}</span>
		</div>
	{/if}

	<div class="desc">
		{#each paragraphs as p, i (i)}
			<p>{p}</p>
		{:else}
			<p class="muted"><em>No description.</em></p>
		{/each}
		{#if item.descriptionTruncated && item.url}
			<a href={item.url} target="_blank" rel="noopener noreferrer">Read the rest in GitLab ↗</a>
		{/if}
	</div>

	{#if children.length}
		<section class="children">
			<h3>Sub-items <span class="muted">{children.length}</span></h3>
			{#each children as c (c.id)}
				<button type="button" class="child" onclick={() => onopen?.(c.id)}>
					<StatusIcon status={board.status(c)} size={12} />
					<span class="cref">{c.ref.replace(/^.*\//, '')}</span>
					<span class="ctitle">{c.title}</span>
				</button>
			{/each}
		</section>
	{/if}
	<p class="updated muted">Updated {updatedLocally.slice(0, 16).replace('T', ' ')} UTC</p>
	{#if actions}{@render actions(item)}{/if}
</article>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px 18px;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-muted);
	}
	.epic {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex: none;
	}
	.ref {
		font-family: var(--mono);
	}
	.type,
	.closed {
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0 5px;
	}
	.closed {
		color: var(--ok);
	}
	.spacer {
		flex: 1;
	}
	.x {
		font-size: 18px;
	}
	.crumbs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
		font-size: 12.5px;
		color: var(--text-muted);
		margin: 0;
	}
	.crumb {
		border: 0;
		background: none;
		padding: 0;
		color: var(--text-secondary);
		cursor: pointer;
		max-width: 260px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.crumb:hover {
		text-decoration: underline;
	}
	h2 {
		margin: 0;
		font-size: 19px;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.fields {
		display: grid;
		grid-template-columns: minmax(90px, max-content) minmax(0, 1fr);
		gap: 2px 14px;
		margin: 4px 0 0;
		font-size: 13px;
	}
	.f {
		display: contents;
	}
	dt {
		color: var(--text-muted);
		padding: 5px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	dd {
		margin: 0;
		min-width: 0;
		padding: 1px 0;
		display: flex;
		align-items: center;
		min-height: 30px;
		color: var(--text-primary);
		overflow-wrap: anywhere;
	}
	.progress {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.bar {
		flex: 1;
		height: 6px;
		border-radius: 3px;
		background: var(--grid);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--ok);
	}
	.desc {
		border-top: 1px solid var(--grid);
		padding-top: 10px;
		font-size: 14px;
		line-height: 1.55;
	}
	.desc p {
		margin: 0 0 0.7em;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.children h3 {
		font-size: 13px;
		margin: 4px 0 6px;
	}
	.child {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 6px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		text-align: left;
		cursor: pointer;
		font-size: 13px;
	}
	.child:hover {
		background: var(--hover);
	}
	.cref {
		font-family: var(--mono);
		font-size: 11.5px;
		color: var(--text-muted);
	}
	.ctitle {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.updated {
		font-size: 11.5px;
		margin: 0;
	}
	.compact {
		padding: 0;
	}
</style>
